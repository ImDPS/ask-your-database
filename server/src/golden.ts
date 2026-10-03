// Ten golden questions. `goldSql` runs on the `app` views and is what a good
// model answer should be equivalent to. `rawSql` computes the same answer
// straight from the original Chinook tables in schema `public` (it needs the
// owner role, the read-only role cannot read them). The two were written
// separately, from the view columns and the raw column names respectively, so
// their agreement checks the views and the expected answers without any number
// copied from memory.
//
// Both sides are deterministic: money is rounded to 2 decimals, counts are cast
// to int, and every ORDER BY has a tie-breaker. Both sides return the same
// columns in the same order, because only values are compared.
export interface Golden {
  id: number;
  question: string;
  goldSql: string;
  rawSql: string;
  orderMatters: boolean;
}

export const GOLDEN: Golden[] = [
  {
    id: 1,
    question: 'Which five countries bring in the most revenue?',
    goldSql: `SELECT billing_country AS country, round(sum(total), 2) AS revenue
FROM invoices
GROUP BY billing_country
ORDER BY revenue DESC, country ASC
LIMIT 5`,
    rawSql: `SELECT inv.billing_country, round(sum(inv.total), 2)
FROM public.invoice AS inv
GROUP BY inv.billing_country
ORDER BY 2 DESC, 1 ASC
LIMIT 5`,
    orderMatters: true,
  },
  {
    id: 2,
    question: 'Who are the top 10 customers by total spend?',
    goldSql: `SELECT c.full_name AS customer, round(sum(i.total), 2) AS total_spend
FROM customers c
JOIN invoices i ON i.customer_id = c.customer_id
GROUP BY c.customer_id, c.full_name
ORDER BY total_spend DESC, c.customer_id ASC
LIMIT 10`,
    rawSql: `SELECT cu.first_name || ' ' || cu.last_name, spend.amount
FROM public.customer AS cu
JOIN (
  SELECT customer_id, round(sum(total), 2) AS amount
  FROM public.invoice
  GROUP BY customer_id
) AS spend ON spend.customer_id = cu.customer_id
ORDER BY spend.amount DESC, cu.customer_id ASC
LIMIT 10`,
    orderMatters: true,
  },
  {
    id: 3,
    question: 'Which genre sells best by revenue?',
    goldSql: `SELECT t.genre_name AS genre, round(sum(l.line_total), 2) AS revenue
FROM invoice_lines l
JOIN tracks t ON t.track_id = l.track_id
WHERE t.genre_name IS NOT NULL
GROUP BY t.genre_name
ORDER BY revenue DESC, genre ASC
LIMIT 1`,
    rawSql: `SELECT g.name, round(sum(il.unit_price * il.quantity), 2)
FROM public.invoice_line AS il
JOIN public.track AS tr ON tr.track_id = il.track_id
JOIN public.genre AS g ON g.genre_id = tr.genre_id
GROUP BY g.genre_id, g.name
ORDER BY 2 DESC, 1 ASC
LIMIT 1`,
    orderMatters: false,
  },
  {
    id: 4,
    question: 'How many customers are there?',
    goldSql: `SELECT count(*)::int AS customer_count FROM customers`,
    rawSql: `SELECT count(customer_id)::int FROM public.customer`,
    orderMatters: false,
  },
  {
    id: 5,
    question: 'How many tracks does each media type have?',
    goldSql: `SELECT m.media_type_name AS media_type, count(t.track_id)::int AS track_count
FROM media_types m
LEFT JOIN tracks t ON t.media_type_id = m.media_type_id
GROUP BY m.media_type_id, m.media_type_name
ORDER BY track_count DESC, media_type ASC`,
    rawSql: `SELECT mt.name, count(tr.track_id)::int
FROM public.media_type AS mt
LEFT JOIN public.track AS tr ON tr.media_type_id = mt.media_type_id
GROUP BY mt.media_type_id, mt.name
ORDER BY 2 DESC, 1 ASC`,
    orderMatters: true,
  },
  {
    id: 6,
    question: 'Which 10 artists have the most tracks?',
    goldSql: `SELECT artist_name AS artist, count(*)::int AS track_count
FROM tracks
WHERE artist_name IS NOT NULL
GROUP BY artist_id, artist_name
ORDER BY track_count DESC, artist ASC
LIMIT 10`,
    rawSql: `SELECT ar.name, count(*)::int
FROM public.artist AS ar
JOIN public.album AS al ON al.artist_id = ar.artist_id
JOIN public.track AS tr ON tr.album_id = al.album_id
GROUP BY ar.artist_id, ar.name
ORDER BY 2 DESC, 1 ASC
LIMIT 10`,
    orderMatters: true,
  },
  {
    id: 7,
    question: 'What was the revenue in each year?',
    goldSql: `SELECT extract(year FROM invoice_date)::int AS year, round(sum(total), 2) AS revenue
FROM invoices
GROUP BY 1
ORDER BY year ASC`,
    rawSql: `SELECT date_part('year', inv.invoice_date)::int, round(sum(inv.total), 2)
FROM public.invoice AS inv
GROUP BY 1
ORDER BY 1 ASC`,
    orderMatters: true,
  },
  {
    id: 8,
    question: 'What is the average invoice total?',
    goldSql: `SELECT round(avg(total), 2) AS average_invoice_total FROM invoices`,
    rawSql: `SELECT round(sum(total) / count(*), 2) FROM public.invoice`,
    orderMatters: false,
  },
  {
    id: 9,
    question: 'Which employee supports the most customers?',
    goldSql: `SELECT e.full_name AS employee, count(*)::int AS customer_count
FROM employees e
JOIN customers c ON c.support_rep_id = e.employee_id
GROUP BY e.employee_id, e.full_name
ORDER BY customer_count DESC, employee ASC
LIMIT 1`,
    rawSql: `SELECT em.first_name || ' ' || em.last_name, count(*)::int
FROM public.employee AS em
JOIN public.customer AS cu ON cu.support_rep_id = em.employee_id
GROUP BY em.employee_id, em.first_name, em.last_name
ORDER BY 2 DESC, 1 ASC
LIMIT 1`,
    orderMatters: false,
  },
  {
    id: 10,
    question: 'How many tracks are longer than 5 minutes?',
    // milliseconds, not duration_seconds: that view column is rounded to one
    // decimal, so a 300.04 second track would show as 300.0 and be missed.
    goldSql: `SELECT count(*)::int AS long_track_count FROM tracks WHERE milliseconds > 300000`,
    rawSql: `SELECT count(*)::int FROM public.track WHERE milliseconds > 5 * 60 * 1000`,
    orderMatters: false,
  },
];
