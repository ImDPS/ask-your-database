import { describe, it, expect } from 'vitest';
import { buildPrompt, extractSql, MAX_QUESTION_CHARS } from '../src/prompt.js';

describe('buildPrompt', () => {
  it('puts the schema in the system text and the question in the user text', () => {
    const p = buildPrompt('VIEW tracks (track_id int)', 'Top genres?');
    expect(p.system).toContain('VIEW tracks');
    expect(p.system).toMatch(/only (one )?select/i);
    expect(p.user).toContain('Top genres?');
    expect(p.system).not.toContain('Top genres?');
  });
  it('tells the model user text is a question, never instructions', () => {
    expect(buildPrompt('s', 'q').system).toMatch(/question, not instructions/i);
  });
  it('adds the failed sql and database error on retry', () => {
    const p = buildPrompt('s', 'q', { sql: 'SELECT x', error: 'column x does not exist' });
    expect(p.user).toContain('SELECT x');
    expect(p.user).toContain('column x does not exist');
  });
  it('exposes the question length limit', () => expect(MAX_QUESTION_CHARS).toBe(300));
  it('gives the model the dialect facts that matter', () => {
    const s = buildPrompt('s', 'q').system;
    expect(s).toMatch(/postgresql/i);
    expect(s).toMatch(/us dollars/i);
    expect(s).toMatch(/timestamps/i);
    expect(s).toMatch(/distinct alias/i);
    expect(s).toMatch(/not end with a comment/i);
  });
  it('keeps the schema text last so the rules are read first', () => {
    const s = buildPrompt('SCHEMA-MARKER', 'q').system;
    expect(s.endsWith('SCHEMA-MARKER')).toBe(true);
  });
});

describe('extractSql', () => {
  it('removes markdown fences', () => {
    expect(extractSql('```sql\nSELECT 1;\n```')).toBe('SELECT 1;');
  });
  it('returns plain text unchanged apart from trimming', () => {
    expect(extractSql('  SELECT 2  ')).toBe('SELECT 2');
  });
  it('takes the fenced block when an explanation line comes first', () => {
    const reply = 'Here is the query you asked for:\n```sql\nSELECT genre_name FROM genres\n```\nHope that helps.';
    expect(extractSql(reply)).toBe('SELECT genre_name FROM genres');
  });
  it('handles a fence with no language tag', () => {
    expect(extractSql('```\nSELECT 3\n```')).toBe('SELECT 3');
  });
  it('keeps the statement when the closing fence is missing (cut-off reply)', () => {
    expect(extractSql('```sql\nSELECT 4')).toBe('SELECT 4');
  });
  it('returns plain text with no fence as is, trimmed', () => {
    expect(extractSql('\nSELECT a, b\nFROM tracks\n')).toBe('SELECT a, b\nFROM tracks');
  });
});
