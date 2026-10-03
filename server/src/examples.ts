// Stored example questions. The SQL uses only the app views and runs through
// the same validator and read-only executor as a model-written query.
export interface Example { id: number; question: string; sql: string }

export const EXAMPLES: Example[] = [
  {
    id: 1,
    question: 'Which five countries bring in the most revenue?',
    sql: 'SELECT billing_country, round(sum(total), 2) AS revenue FROM invoices GROUP BY billing_country ORDER BY revenue DESC LIMIT 5',
  },
  {
    id: 2,
    question: 'Who are the top 10 customers by total spend?',
    sql: 'SELECT c.full_name, c.country, round(sum(i.total), 2) AS spend FROM customers c JOIN invoices i ON i.customer_id = c.customer_id GROUP BY c.customer_id, c.full_name, c.country ORDER BY spend DESC LIMIT 10',
  },
  {
    id: 3,
    question: 'Which genre sells best?',
    sql: 'SELECT t.genre_name, round(sum(l.line_total), 2) AS revenue FROM invoice_lines l JOIN tracks t ON t.track_id = l.track_id GROUP BY t.genre_name ORDER BY revenue DESC LIMIT 10',
  },
  {
    id: 4,
    question: 'How many tracks does each media type have?',
    sql: 'SELECT media_type_name, count(*) AS track_count FROM tracks GROUP BY media_type_name ORDER BY track_count DESC',
  },
  {
    id: 5,
    question: 'Which 10 artists have the most tracks?',
    sql: 'SELECT artist_name, count(*) AS track_count FROM tracks GROUP BY artist_name ORDER BY track_count DESC, artist_name LIMIT 10',
  },
  {
    id: 6,
    question: 'What was the revenue in each year?',
    sql: 'SELECT extract(year FROM invoice_date)::int AS year, round(sum(total), 2) AS revenue FROM invoices GROUP BY 1 ORDER BY 1',
  },
];
