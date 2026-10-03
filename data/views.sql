-- App-facing views over the Chinook tables (public schema, snake_case, unquoted names).
-- The model and the read-only role see only these views. Every view and column has a COMMENT,
-- and those comments are what the prompt later shows the model as the schema description.
CREATE SCHEMA app;

CREATE VIEW app.artists AS
SELECT ar.artist_id, ar.name AS artist_name
FROM public.artist ar;
COMMENT ON VIEW app.artists IS 'One row per music artist or band. artists.artist_id joins albums.artist_id.';
COMMENT ON COLUMN app.artists.artist_id IS 'Unique id of the artist.';
COMMENT ON COLUMN app.artists.artist_name IS 'Name of the artist or band.';

CREATE VIEW app.albums AS
SELECT al.album_id, al.title AS album_title, al.artist_id
FROM public.album al;
COMMENT ON VIEW app.albums IS 'One row per album. albums.artist_id joins artists.artist_id; tracks.album_id joins albums.album_id.';
COMMENT ON COLUMN app.albums.album_id IS 'Unique id of the album.';
COMMENT ON COLUMN app.albums.album_title IS 'Title of the album.';
COMMENT ON COLUMN app.albums.artist_id IS 'The artist who made the album; joins artists.artist_id.';

CREATE VIEW app.genres AS
SELECT g.genre_id, g.name AS genre_name
FROM public.genre g;
COMMENT ON VIEW app.genres IS 'One row per music genre, such as Rock or Jazz. genres.genre_id joins tracks.genre_id.';
COMMENT ON COLUMN app.genres.genre_id IS 'Unique id of the genre.';
COMMENT ON COLUMN app.genres.genre_name IS 'Name of the genre.';

CREATE VIEW app.media_types AS
SELECT m.media_type_id, m.name AS media_type_name
FROM public.media_type m;
COMMENT ON VIEW app.media_types IS 'One row per audio or video file format a track is sold in. media_types.media_type_id joins tracks.media_type_id.';
COMMENT ON COLUMN app.media_types.media_type_id IS 'Unique id of the media type.';
COMMENT ON COLUMN app.media_types.media_type_name IS 'Name of the file format, for example MPEG audio file.';

CREATE VIEW app.tracks AS
SELECT t.track_id, t.name AS track_name,
       t.album_id, al.title AS album_title,
       al.artist_id, ar.name AS artist_name,
       t.genre_id, g.name AS genre_name,
       t.media_type_id, m.name AS media_type_name,
       t.composer, t.milliseconds,
       round(t.milliseconds / 1000.0, 1) AS duration_seconds,
       t.bytes, t.unit_price
FROM public.track t
LEFT JOIN public.album al ON al.album_id = t.album_id
LEFT JOIN public.artist ar ON ar.artist_id = al.artist_id
LEFT JOIN public.genre g ON g.genre_id = t.genre_id
LEFT JOIN public.media_type m ON m.media_type_id = t.media_type_id;
COMMENT ON VIEW app.tracks IS 'One row per track (song) in the store, with its album, artist, genre and media type already joined in. invoice_lines.track_id and playlist_tracks.track_id join tracks.track_id.';
COMMENT ON COLUMN app.tracks.track_id IS 'Unique id of the track.';
COMMENT ON COLUMN app.tracks.track_name IS 'Title of the track.';
COMMENT ON COLUMN app.tracks.album_id IS 'Album the track belongs to; joins albums.album_id. Can be empty for singles.';
COMMENT ON COLUMN app.tracks.album_title IS 'Title of the track''s album. Empty when the track has no album.';
COMMENT ON COLUMN app.tracks.artist_id IS 'Artist of the track''s album; joins artists.artist_id. Empty when the track has no album.';
COMMENT ON COLUMN app.tracks.artist_name IS 'Name of the artist or band who made the track''s album.';
COMMENT ON COLUMN app.tracks.genre_id IS 'Genre of the track; joins genres.genre_id. Can be empty.';
COMMENT ON COLUMN app.tracks.genre_name IS 'Name of the track''s genre, for example Rock, Jazz or Latin.';
COMMENT ON COLUMN app.tracks.media_type_id IS 'File format of the track; joins media_types.media_type_id.';
COMMENT ON COLUMN app.tracks.media_type_name IS 'Name of the file format of the track, for example MPEG audio file.';
COMMENT ON COLUMN app.tracks.composer IS 'Name or names of the people who composed the track. Often empty.';
COMMENT ON COLUMN app.tracks.milliseconds IS 'Length of the track in milliseconds.';
COMMENT ON COLUMN app.tracks.duration_seconds IS 'Length of the track in seconds, rounded to one decimal place.';
COMMENT ON COLUMN app.tracks.bytes IS 'File size of the track in bytes.';
COMMENT ON COLUMN app.tracks.unit_price IS 'Price of one copy of the track, in US dollars.';

CREATE VIEW app.employees AS
SELECT e.employee_id, e.first_name, e.last_name,
       e.first_name || ' ' || e.last_name AS full_name,
       e.title, e.reports_to AS reports_to_id,
       e.birth_date, e.hire_date,
       e.city, e.state, e.country, e.postal_code, e.phone, e.email
FROM public.employee e;
COMMENT ON VIEW app.employees IS 'One row per staff member of the store. employees.employee_id joins customers.support_rep_id (the sales support agent of a customer). reports_to_id joins employees.employee_id (the manager).';
COMMENT ON COLUMN app.employees.employee_id IS 'Unique id of the employee.';
COMMENT ON COLUMN app.employees.first_name IS 'First name of the employee.';
COMMENT ON COLUMN app.employees.last_name IS 'Last name of the employee.';
COMMENT ON COLUMN app.employees.full_name IS 'First name and last name joined with a space.';
COMMENT ON COLUMN app.employees.title IS 'Job title, for example Sales Support Agent or General Manager.';
COMMENT ON COLUMN app.employees.reports_to_id IS 'The employee_id of this employee''s manager. Empty for the top of the hierarchy.';
COMMENT ON COLUMN app.employees.birth_date IS 'Date of birth of the employee.';
COMMENT ON COLUMN app.employees.hire_date IS 'Date the employee was hired.';
COMMENT ON COLUMN app.employees.city IS 'City where the employee lives.';
COMMENT ON COLUMN app.employees.state IS 'State or province where the employee lives.';
COMMENT ON COLUMN app.employees.country IS 'Country where the employee lives.';
COMMENT ON COLUMN app.employees.postal_code IS 'Postal code of the employee''s address.';
COMMENT ON COLUMN app.employees.phone IS 'Phone number of the employee.';
COMMENT ON COLUMN app.employees.email IS 'Email address of the employee.';

CREATE VIEW app.customers AS
SELECT c.customer_id, c.first_name, c.last_name,
       c.first_name || ' ' || c.last_name AS full_name,
       c.company, c.address, c.city, c.state, c.country, c.postal_code,
       c.phone, c.email, c.support_rep_id
FROM public.customer c;
COMMENT ON VIEW app.customers IS 'One row per customer who buys music. customers.customer_id joins invoices.customer_id; customers.support_rep_id joins employees.employee_id.';
COMMENT ON COLUMN app.customers.customer_id IS 'Unique id of the customer.';
COMMENT ON COLUMN app.customers.first_name IS 'First name of the customer.';
COMMENT ON COLUMN app.customers.last_name IS 'Last name of the customer.';
COMMENT ON COLUMN app.customers.full_name IS 'First name and last name joined with a space.';
COMMENT ON COLUMN app.customers.company IS 'Company the customer works for. Often empty.';
COMMENT ON COLUMN app.customers.address IS 'Street address of the customer.';
COMMENT ON COLUMN app.customers.city IS 'City where the customer lives.';
COMMENT ON COLUMN app.customers.state IS 'State or province where the customer lives. Empty for many countries.';
COMMENT ON COLUMN app.customers.country IS 'Country where the customer lives, for example USA, Brazil or India.';
COMMENT ON COLUMN app.customers.postal_code IS 'Postal code of the customer''s address.';
COMMENT ON COLUMN app.customers.phone IS 'Phone number of the customer.';
COMMENT ON COLUMN app.customers.email IS 'Email address of the customer.';
COMMENT ON COLUMN app.customers.support_rep_id IS 'The sales support employee assigned to the customer; joins employees.employee_id.';

CREATE VIEW app.invoices AS
SELECT i.invoice_id, i.customer_id, i.invoice_date,
       i.billing_address, i.billing_city, i.billing_state, i.billing_country, i.billing_postal_code,
       i.total
FROM public.invoice i;
COMMENT ON VIEW app.invoices IS 'One row per sale (invoice). invoices.customer_id joins customers.customer_id; invoice_lines.invoice_id joins invoices.invoice_id. total is the sum of the invoice''s line_total values.';
COMMENT ON COLUMN app.invoices.invoice_id IS 'Unique id of the invoice.';
COMMENT ON COLUMN app.invoices.customer_id IS 'The customer who was billed; joins customers.customer_id.';
COMMENT ON COLUMN app.invoices.invoice_date IS 'Date and time of the sale.';
COMMENT ON COLUMN app.invoices.billing_address IS 'Street address the invoice was billed to.';
COMMENT ON COLUMN app.invoices.billing_city IS 'City the invoice was billed to.';
COMMENT ON COLUMN app.invoices.billing_state IS 'State or province the invoice was billed to. Often empty.';
COMMENT ON COLUMN app.invoices.billing_country IS 'Country the invoice was billed to. Use this for revenue by country.';
COMMENT ON COLUMN app.invoices.billing_postal_code IS 'Postal code the invoice was billed to.';
COMMENT ON COLUMN app.invoices.total IS 'Total amount of the invoice, in US dollars. This is the revenue of the sale.';

CREATE VIEW app.invoice_lines AS
SELECT il.invoice_line_id, il.invoice_id, il.track_id,
       il.unit_price, il.quantity,
       il.unit_price * il.quantity AS line_total
FROM public.invoice_line il;
COMMENT ON VIEW app.invoice_lines IS 'One row per track bought on an invoice. invoice_lines.invoice_id joins invoices.invoice_id; invoice_lines.track_id joins tracks.track_id. line_total is unit_price times quantity.';
COMMENT ON COLUMN app.invoice_lines.invoice_line_id IS 'Unique id of the invoice line.';
COMMENT ON COLUMN app.invoice_lines.invoice_id IS 'The invoice this line belongs to; joins invoices.invoice_id.';
COMMENT ON COLUMN app.invoice_lines.track_id IS 'The track that was bought; joins tracks.track_id.';
COMMENT ON COLUMN app.invoice_lines.unit_price IS 'Price of one copy of the track at the time of sale, in US dollars.';
COMMENT ON COLUMN app.invoice_lines.quantity IS 'Number of copies of the track bought on this line.';
COMMENT ON COLUMN app.invoice_lines.line_total IS 'Revenue for this line, in US dollars (unit_price times quantity).';

CREATE VIEW app.playlists AS
SELECT p.playlist_id, p.name AS playlist_name
FROM public.playlist p;
COMMENT ON VIEW app.playlists IS 'One row per playlist. playlists.playlist_id joins playlist_tracks.playlist_id. Some playlist names appear more than once with different ids.';
COMMENT ON COLUMN app.playlists.playlist_id IS 'Unique id of the playlist.';
COMMENT ON COLUMN app.playlists.playlist_name IS 'Name of the playlist, for example Music or Classical.';

CREATE VIEW app.playlist_tracks AS
SELECT pt.playlist_id, pt.track_id
FROM public.playlist_track pt;
COMMENT ON VIEW app.playlist_tracks IS 'Link between playlists and tracks, one row per track in a playlist. playlist_tracks.playlist_id joins playlists.playlist_id; playlist_tracks.track_id joins tracks.track_id.';
COMMENT ON COLUMN app.playlist_tracks.playlist_id IS 'The playlist; joins playlists.playlist_id.';
COMMENT ON COLUMN app.playlist_tracks.track_id IS 'A track in the playlist; joins tracks.track_id.';
