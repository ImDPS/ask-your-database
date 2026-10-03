import pg from 'pg';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
// Workspace scripts run with the server folder as cwd, so load the repo-root .env explicitly.
// A missing file is fine (the container gets its values from real environment variables).
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
const make = (key: string) => () => {
  const url = process.env[key];
  if (!url) throw new Error(`${key} is not set`);
  return new pg.Pool({ connectionString: url, max: 5 });
};
export const getReadonlyPool = make('DATABASE_URL_READONLY');
export const getOwnerPool = make('DATABASE_URL_OWNER');
