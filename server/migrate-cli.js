// `npm run migrate:up` / `npm run migrate:down` against DB_FILE (default ./data/dara.db).
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrateUp, migrateDown } from './db.js';

const file = resolve(process.env.DB_FILE || './data/dara.db');
mkdirSync(dirname(file), { recursive: true });
const db = new DatabaseSync(file);
const dir = process.argv[2];
if (dir === 'down') {
  if (!process.argv.includes('--yes')) {
    console.error('migrate:down drops tables and deletes data. Re-run with: npm run migrate:down -- --yes');
    process.exit(1);
  }
  console.log('Rolled back:', migrateDown(db) ?? '(nothing to roll back)');
} else {
  console.log('Applied:', migrateUp(db).join(', ') || '(already up to date)');
}
db.close();
