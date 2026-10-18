// `npm run migrate:up` / `npm run migrate:down -- --yes` against DATABASE_URL (Postgres) or DB_FILE (SQLite).
import { resolve } from 'node:path';
import { openDb } from './db.js';

const dir = process.argv[2];
if (dir === 'down' && !process.argv.includes('--yes')) {
  console.error('migrate:down drops tables and deletes data. Re-run with: npm run migrate:down -- --yes');
  process.exit(1);
}
// openDb applies pending migrations on open, so "up" is just opening the database.
const db = process.env.DATABASE_URL ? await openDb({ url: process.env.DATABASE_URL }) : await openDb({ file: resolve(process.env.DB_FILE || './data/dara.db') });
if (dir === 'down') console.log('Rolled back:', (await db.migrateDown()) ?? '(nothing to roll back)');
else console.log('Database is up to date.');
await db.close();
