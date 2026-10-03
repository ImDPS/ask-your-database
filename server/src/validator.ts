// Select-only SQL validator. Pure function, no database access.
//
// This is the friendly, early layer. The hard guarantees come from the
// read-only database role and the read-only transaction (see executor.ts).
// The role can still read pg_catalog and information_schema by default, so
// this validator is the only layer that keeps generated SQL off them.
//
// Everything here fails closed: anything the parser cannot read is rejected.
// Known limit: pgsql-ast-parser cannot parse INTERSECT, EXCEPT, SELECT INTO,
// EXPLAIN, COPY or dollar-quoted strings, so those are rejected as parse
// errors (INTERSECT and EXCEPT are valid read-only SQL we turn away).
import { parse, astVisitor, type Statement } from 'pgsql-ast-parser';

export type ValidationResult = { ok: true; sql: string } | { ok: false; reason: string };

export const ALLOWED_VIEWS = [
  'artists', 'albums', 'genres', 'media_types', 'tracks', 'customers',
  'employees', 'invoices', 'invoice_lines', 'playlists', 'playlist_tracks',
] as const;

const MAX_LEN = 2000;
// Raw input cap before any work is done (leaves room for surrounding whitespace).
const MAX_RAW_LEN = 10_000;

// Statement node types that read data. A `with` is only as safe as every
// statement bound inside it, which the `statement` visitor hook checks.
const READ_TYPES = new Set(['select', 'union', 'union all', 'with', 'with recursive', 'values']);

const BLOCKED_FUNCTIONS = new Set([
  'dblink', 'set_config', 'current_setting', 'query_to_xml', 'xpath',
  'txid_current', 'lastval', 'nextval', 'setval',
  // Beyond the brief: functions that run SQL text or read large objects
  // without going through a table reference the validator can see.
  'ts_stat', 'loread', 'lowrite',
]);

// Prefix and pattern blocks, applied to the lower-cased function name.
// `*_to_xml*` covers table_to_xml, query_to_xml_and_xmlschema, cursor_to_xml, etc.
const BLOCKED_FUNCTION_PATTERNS: readonly RegExp[] = [/^pg_/, /^lo_/, /^dblink/, /_to_xml/];

// Function schema other than these is rejected (a bare name or pg_catalog only).
const ALLOWED_FUNCTION_SCHEMAS = new Set(['pg_catalog']);

const fail = (reason: string): ValidationResult => ({ ok: false, reason });
const short = (s: string) => (s.length > 60 ? s.slice(0, 60) + '...' : s);

function stripTrailingSemicolon(s: string): string {
  const t = s.trim();
  return t.endsWith(';') ? t.slice(0, -1).trim() : t;
}

export function validateSql(input: string): ValidationResult {
  if (typeof input !== 'string') return fail('Query must be text.');
  if (input.length > MAX_RAW_LEN) return fail('Query is too long.');
  if (input.includes('\u0000')) return fail('Query contains a null character.');

  const sql = stripTrailingSemicolon(input);
  if (!sql) return fail('Empty query.');
  if (sql.length > MAX_LEN) return fail('Query is too long.');
  // A second trailing semicolon means an empty second statement. Reject it so
  // the returned text never ends in a semicolon.
  if (sql.endsWith(';')) return fail('Only one statement is allowed.');

  // Postgres decodes U&"..." (unicode escapes) into an identifier, but the
  // parser keeps the raw text: U&"pg\005fsleep"(1) calls pg_sleep in Postgres
  // while the parser sees a function named `pg\005fsleep`. Reject the syntax.
  if (/u&\s*["']/i.test(sql)) return fail('Unicode escape syntax (U&"...") is not allowed.');

  let statements: Statement[];
  try {
    statements = parse(sql);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : '';
    return fail(`Could not read that as one SQL query. ${short(msg)}`.trim());
  }
  if (statements.length !== 1) return fail('Only one statement is allowed.');
  const st = statements[0];

  // The executor runs the query as a subquery: SELECT * FROM (<sql>) AS q.
  // Parse that shape too. It rejects what the plain parse tolerates but would
  // swallow the closing bracket or break out of the wrapper: an unterminated
  // block comment, a stray or leading semicolon, unbalanced brackets. The
  // newline lets a trailing line comment through (the executor must add one too).
  try {
    if (parse(`SELECT * FROM (${sql}\n) AS q`).length !== 1) return fail('Only one statement is allowed.');
  } catch {
    return fail('Could not read that as one SQL query.');
  }

  let problem: string | null = null;
  const reject = (reason: string) => {
    problem ??= reason;
  };

  // Every CTE name defined anywhere in the statement. Scope is not tracked, so
  // a name defined anywhere is accepted everywhere (loose but safe: the role
  // and the read-only transaction still apply).
  const cteNames = new Set<string>();

  const checkTable = (schema: string | undefined, name: string) => {
    const label = `${schema ? schema + '.' : ''}${name}`;
    // Quoted identifiers keep their case, unquoted ones are already lower-cased
    // by the parser, so an exact match is right: app."Tracks" names no view.
    if (name.toLowerCase().startsWith('pg_')) return reject(`Table not allowed: ${short(label)}`);
    if (schema !== undefined) {
      if (schema !== 'app' || !(ALLOWED_VIEWS as readonly string[]).includes(name)) {
        return reject(`Table not allowed: ${short(label)}`);
      }
      return;
    }
    if (!(ALLOWED_VIEWS as readonly string[]).includes(name) && !cteNames.has(name)) {
      reject(`Table not allowed: ${short(label)}`);
    }
  };

  const checkFunction = (schema: string | undefined, rawName: string) => {
    const name = rawName.toLowerCase();
    if (schema !== undefined && !ALLOWED_FUNCTION_SCHEMAS.has(schema.toLowerCase())) {
      return reject(`Function not allowed: ${short(schema)}.${short(name)}`);
    }
    if (BLOCKED_FUNCTIONS.has(name) || BLOCKED_FUNCTION_PATTERNS.some((re) => re.test(name))) {
      reject(`Function not allowed: ${short(name)}`);
    }
  };

  const checkSelect = (s: { for?: unknown; into?: unknown }) => {
    if (s.for) reject('Row locking (FOR UPDATE/SHARE) is not allowed.');
    if (s.into) reject('SELECT INTO is not allowed.');
  };

  try {
    // Pass 1: collect CTE names (set declared above), before any table
    // reference is checked.
    collectCteNames(st, cteNames);

    // Pass 2a: the parser's visitor, using the hooks recorded in the spike.
    astVisitor((v) => ({
      // Fires for every statement node, including CTE bodies and subqueries,
      // so a write hidden in a WITH (top-level type `with`) is seen here.
      statement: (s) => {
        if (!READ_TYPES.has(s.type)) reject('Only SELECT queries are allowed.');
        v.super().statement(s);
      },
      // Belt and braces: reject writes on their own hooks as well.
      insert: (s) => {
        reject('Only SELECT queries are allowed.');
        v.super().insert(s);
      },
      update: (s) => {
        reject('Only SELECT queries are allowed.');
        v.super().update(s);
      },
      delete: (s) => {
        reject('Only SELECT queries are allowed.');
        v.super().delete(s);
      },
      selection: (s) => {
        checkSelect(s);
        v.super().selection(s);
      },
      tableRef: (t) => {
        checkTable(t.schema, t.name);
        v.super().tableRef(t);
      },
      fromTable: (t) => {
        checkTable(t.name.schema, t.name.name);
        v.super().fromTable(t);
      },
      call: (c) => {
        checkFunction(c.function.schema, c.function.name);
        v.super().call(c);
      },
      fromCall: (c) => {
        checkFunction(c.function.schema, c.function.name);
        v.super().fromCall(c);
      },
    })).statement(st);

    // Pass 2b: a plain walk over every node. The visitor has gaps (it does not
    // descend into a window function's OVER clause, for example, so
    // `rank() OVER (ORDER BY pg_sleep(1))` is invisible to it). The walk does
    // not depend on the parser's traversal, so it is the fail-closed backstop.
    walk(st, (n) => {
      switch (n.type) {
        case 'call':
          checkFunction(qname(n.function)?.schema, qname(n.function)?.name ?? '');
          break;
        case 'table':
          checkTable(qname(n.name)?.schema, qname(n.name)?.name ?? '');
          break;
        case 'select':
          checkSelect(n as { for?: unknown; into?: unknown });
          break;
        default:
          if (typeof n.type === 'string' && WRITE_OR_DDL_TYPES.test(n.type)) {
            reject('Only SELECT queries are allowed.');
          }
      }
    });
  } catch {
    // A traversal failure must never turn into an accept.
    return fail('Could not check that query.');
  }

  if (problem) return fail(problem);
  return { ok: true, sql };
}

type Node = { type?: unknown; [k: string]: unknown };
type QNameLike = { schema?: string; name: string };

const qname = (x: unknown): QNameLike | null =>
  x && typeof x === 'object' && typeof (x as QNameLike).name === 'string' ? (x as QNameLike) : null;

// Statement node types other than the read ones, matched in the generic walk.
const WRITE_OR_DDL_TYPES =
  /^(insert|update|delete|create|drop|alter|truncate|set|do|show|prepare|deallocate|begin|start|commit|rollback|comment|raise|refresh|tablespace|merge|copy|call|explain|grant|revoke|lock|listen|notify|vacuum|analyze|execute)/;

// Visit every object in the tree, whatever the parser's own visitor covers.
function walk(root: unknown, visit: (n: Node) => void): void {
  const seen = new WeakSet<object>();
  const go = (x: unknown): void => {
    if (!x || typeof x !== 'object') return;
    if (seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) {
      x.forEach(go);
      return;
    }
    const n = x as Node;
    visit(n);
    for (const k of Object.keys(n)) if (k !== '_location') go(n[k]);
  };
  go(root);
}

function collectCteNames(root: unknown, out: Set<string>): void {
  walk(root, (n) => {
    if (n.type === 'with' && Array.isArray(n.bind)) {
      for (const b of n.bind as { alias?: { name?: string } }[]) {
        if (b?.alias?.name) out.add(b.alias.name);
      }
    } else if (n.type === 'with recursive') {
      const a = (n.alias as { name?: string } | undefined)?.name;
      if (a) out.add(a);
    }
  });
}
