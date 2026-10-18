// Database access: Node's built-in SQLite (node:sqlite), migrations, and small query helpers.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** UUIDv7: 48-bit unix-ms timestamp + random bits; sortable by creation time. */
export function uuidv7() {
  const b = randomBytes(16);
  let ts = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) { b[i] = Number(ts & 0xffn); ts >>= 8n; }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const nowIso = () => new Date().toISOString();

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.up.sql'))
    .sort()
    .map((f) => ({ name: f.replace('.up.sql', ''), up: join(MIGRATIONS_DIR, f), down: join(MIGRATIONS_DIR, f.replace('.up.sql', '.down.sql')) }));
}

export function migrateUp(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const ran = [];
  for (const m of listMigrations()) {
    if (applied.has(m.name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(m.up, 'utf8'));
      db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(m.name, nowIso());
      db.exec('COMMIT');
      ran.push(m.name);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return ran;
}

export function migrateDown(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const last = db.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').get();
  if (!last) return null;
  const m = listMigrations().find((x) => x.name === last.name);
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('BEGIN');
  try {
    db.exec(readFileSync(m.down, 'utf8'));
    db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(m.name);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys=ON'); }
  return m.name;
}

/** Opens (and migrates) a database. Returns a thin wrapper with helpers. */
export function openDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode=WAL');
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  migrateUp(raw);
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  let depth = 0;
  return {
    raw,
    all: (sql, ...p) => stmt(sql).all(...p),
    get: (sql, ...p) => stmt(sql).get(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    exec: (sql) => raw.exec(sql),
    /** Runs fn inside a transaction (nested calls join the outer one). */
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } finally { depth--; }
    },
    close: () => raw.close(),
  };
}

export const json = {
  parse(v, fallback = []) { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  str: (v) => JSON.stringify(v ?? []),
};
