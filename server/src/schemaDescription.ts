import type pg from 'pg';

// One block per view in the `app` schema: the view comment, then each column
// with its type and comment. This text is the only schema the model sees.
export async function loadSchemaDescription(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query(`
    SELECT c.relname AS view, obj_description(c.oid, 'pg_class') AS view_comment,
           a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type,
           col_description(c.oid, a.attnum) AS col_comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'app'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'v' ORDER BY c.relname, a.attnum`);
  const out: string[] = []; let current = '';
  for (const r of rows) {
    if (r.view !== current) {
      current = r.view;
      out.push(`\nVIEW ${r.view}: ${r.view_comment ?? ''}`);
    }
    out.push(`  ${r.col} ${r.type}${r.col_comment ? ' - ' + r.col_comment : ''}`);
  }
  return out.join('\n').trim();
}
