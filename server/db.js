// Data access layer with two adapters behind one async API:
//   • SQLite (node:sqlite, zero dependencies) — local evaluation and the default.
//   • PostgreSQL (`pg` pool, or in-process PGlite for tests) — production, with row-level security.
// Every request runs inside db.withContext({ tenantId | system }). On Postgres that context opens one transaction,
// sets app.tenant_id (or app.bypass_rls for system work) and, if configured, switches to the non-owner app role,
// so the database itself filters rows by tenant (ADR-013). SQLite has no RLS; isolation there is the tested
// tenant-scoped query layer only.
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const MIGRATIONS_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

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
export const json = {
  parse(v, fallback = []) { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  str: (v) => JSON.stringify(v ?? []),
};

function listMigrations(dialect) {
  const dir = join(MIGRATIONS_ROOT, dialect);
  return readdirSync(dir).filter((f) => f.endsWith('.up.sql')).sort()
    .map((f) => ({ name: f.replace('.up.sql', ''), up: join(dir, f), down: join(dir, f.replace('.up.sql', '.down.sql')) }));
}

/* =============================== SQLite =============================== */
async function openSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode=WAL');
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  const als = new AsyncLocalStorage();
  let depth = 0;
  const db = {
    dialect: 'sqlite', raw,
    // Synchronous under the hood, exposed as promises. Awaiting them only queues microtasks — never an I/O turn — so a
    // transaction body can't interleave with another request on the single connection.
    get: async (sql, ...p) => stmt(sql).get(...p),
    all: async (sql, ...p) => stmt(sql).all(...p),
    run: async (sql, ...p) => { const r = stmt(sql).run(...p); return { changes: Number(r.changes) }; },
    exec: (sql) => raw.exec(sql),
    async tx(fn) {
      if (depth > 0) return fn();
      depth++; raw.exec('BEGIN IMMEDIATE');
      try { const r = await fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } finally { depth--; }
    },
    withContext: (ctx, fn) => als.run(ctx, fn),
    asSystem: (fn) => fn(),
    context: () => als.getStore() || null,
    isUniqueViolation: (e) => /UNIQUE constraint failed/.test(String(e?.message)),
    async migrateUp() {
      raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
      const applied = new Set(raw.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
      const ran = [];
      for (const m of listMigrations('sqlite')) {
        if (applied.has(m.name)) continue;
        raw.exec('BEGIN');
        try { raw.exec(readFileSync(m.up, 'utf8')); raw.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(m.name, nowIso()); raw.exec('COMMIT'); ran.push(m.name); }
        catch (e) { raw.exec('ROLLBACK'); throw e; }
      }
      cache.clear();
      return ran;
    },
    async migrateDown() {
      raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
      const last = raw.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').get();
      if (!last) return null;
      const m = listMigrations('sqlite').find((x) => x.name === last.name);
      raw.exec('PRAGMA foreign_keys=OFF'); raw.exec('BEGIN');
      try { raw.exec(readFileSync(m.down, 'utf8')); raw.prepare('DELETE FROM schema_migrations WHERE name = ?').run(m.name); raw.exec('COMMIT'); }
      catch (e) { raw.exec('ROLLBACK'); throw e; } finally { raw.exec('PRAGMA foreign_keys=ON'); }
      cache.clear();
      return m.name;
    },
    async tableExists(name) { return !!raw.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name); },
    close: () => raw.close(),
  };
  return db;
}

/* ============================== PostgreSQL ============================== */
/** `?` placeholders → `$n`; SQLite's case-insensitive LIKE → ILIKE. No `?` appears inside SQL literals in this codebase. */
export function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`).replace(/\bLIKE\b/g, 'ILIKE');
}

/**
 * driver: { kind: 'pg', pool } or { kind: 'pglite', pglite }.
 * appRole: non-owner, non-superuser role assumed inside every transaction so RLS always applies (required for PGlite,
 * whose session user is a superuser; recommended in production).
 */
function makePostgres(driver, { appRole = null } = {}) {
  const als = new AsyncLocalStorage();
  let spSeq = 0;
  const q = async (client, sql, params = []) => {
    const r = await client.query(toPg(sql), params);
    return { rows: r.rows, changes: r.rowCount ?? r.affectedRows ?? 0 };
  };
  async function begin(client, ctx) {
    if (appRole) await client.query(`SET LOCAL ROLE ${appRole}`);
    await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.bypass_rls', $2, true)`, [ctx.tenantId || '', ctx.system ? 'on' : 'off']);
  }
  async function withContext(ctx, fn) {
    const existing = als.getStore();
    if (existing) return als.run({ ...existing, ...ctx, inherited: true }, async () => {
      await existing.client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.bypass_rls', $2, true)`, [ctx.tenantId || existing.tenantId || '', ctx.system ? 'on' : 'off']);
      try { return await fn(); } finally { await existing.client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.bypass_rls', $2, true)`, [existing.tenantId || '', existing.system ? 'on' : 'off']); }
    });
    if (driver.kind === 'pglite') {
      return driver.pglite.transaction(async (tx) => { await begin(tx, ctx); return als.run({ ...ctx, client: tx }, fn); });
    }
    const client = await driver.pool.connect();
    try {
      await client.query('BEGIN');
      await begin(client, ctx);
      const r = await als.run({ ...ctx, client }, fn);
      await client.query('COMMIT');
      return r;
    } catch (e) { try { await client.query('ROLLBACK'); } catch { /* ignore */ } throw e; }
    finally { client.release(); }
  }
  // Queries outside a request context (seed, sweeps, migrations) run as system work in their own transaction.
  const exec = (fn) => { const s = als.getStore(); return s ? fn(s.client) : withContext({ system: true }, () => fn(als.getStore().client)); };
  const db = {
    dialect: 'postgres',
    get: (sql, ...p) => exec(async (c) => (await q(c, sql, p)).rows[0]),
    all: (sql, ...p) => exec(async (c) => (await q(c, sql, p)).rows),
    run: (sql, ...p) => exec(async (c) => ({ changes: (await q(c, sql, p)).changes })),
    exec: (sql) => exec((c) => (driver.kind === 'pglite' ? c.exec(sql) : c.query(sql))),
    async tx(fn) {
      const s = als.getStore();
      if (!s) return withContext({ system: true }, fn);
      const sp = `sp_${++spSeq}`;
      await s.client.query(`SAVEPOINT ${sp}`);
      try { const r = await fn(); await s.client.query(`RELEASE SAVEPOINT ${sp}`); return r; }
      catch (e) { await s.client.query(`ROLLBACK TO SAVEPOINT ${sp}`); throw e; }
    },
    withContext,
    /** Temporarily lift RLS inside the current transaction (global email checks, cross-tenant system steps). */
    async asSystem(fn) {
      const s = als.getStore();
      if (!s) return withContext({ system: true }, fn);
      await s.client.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
      try { return await als.run({ ...s, system: true }, fn); } finally { await s.client.query(`SELECT set_config('app.bypass_rls', $1, true)`, [s.system ? 'on' : 'off']); }
    },
    context: () => als.getStore() || null,
    isUniqueViolation: (e) => e?.code === '23505' || /duplicate key value/.test(String(e?.message)),
    async migrateUp() {
      const raw = (sql, p) => (driver.kind === 'pglite' ? driver.pglite.query(sql, p) : driver.pool.query(sql, p));
      const execRaw = (sql) => (driver.kind === 'pglite' ? driver.pglite.exec(sql) : driver.pool.query(sql));
      await execRaw('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
      const applied = new Set((await raw('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
      const ran = [];
      for (const m of listMigrations('postgres')) {
        if (applied.has(m.name)) continue;
        const sql = readFileSync(m.up, 'utf8').replaceAll(':app_role', appRole || 'dara_app');
        await execRaw(`BEGIN;\n${sql}\nINSERT INTO schema_migrations(name, applied_at) VALUES ('${m.name}', '${nowIso()}');\nCOMMIT;`).catch(async (e) => { await execRaw('ROLLBACK').catch(() => {}); throw e; });
        ran.push(m.name);
      }
      return ran;
    },
    async migrateDown() {
      const raw = (sql, p) => (driver.kind === 'pglite' ? driver.pglite.query(sql, p) : driver.pool.query(sql, p));
      const execRaw = (sql) => (driver.kind === 'pglite' ? driver.pglite.exec(sql) : driver.pool.query(sql));
      const last = (await raw('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')).rows[0];
      if (!last) return null;
      const m = listMigrations('postgres').find((x) => x.name === last.name);
      const sql = readFileSync(m.down, 'utf8').replaceAll(':app_role', appRole || 'dara_app');
      await execRaw(`BEGIN;\n${sql}\nDELETE FROM schema_migrations WHERE name = '${m.name}';\nCOMMIT;`).catch(async (e) => { await execRaw('ROLLBACK').catch(() => {}); throw e; });
      return m.name;
    },
    async tableExists(name) { return !!(await db.get(`SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?`, name)); },
    /**
     * Startup safety check for tenant isolation. Uses the app role when the connection may assume it; otherwise
     * relies on FORCE ROW LEVEL SECURITY applying to the (non-superuser) owner. Refuses to run where RLS would be bypassed.
     */
    async verifyIsolation() {
      const raw = (sql, p) => (driver.kind === 'pglite' ? driver.pglite.query(sql, p) : driver.pool.query(sql, p));
      const me = (await raw(`SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).rows[0];
      let mode = 'app_role';
      if (appRole) {
        const ok = (await raw(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AND pg_has_role(current_user, $1, 'MEMBER') AS ok`, [appRole])).rows[0]?.ok;
        if (!ok) { appRole = null; mode = 'owner_forced'; }
      } else mode = 'owner_forced';
      if (!appRole && (me.rolsuper || me.rolbypassrls)) {
        throw new Error(`Database user "${me.u}" is a superuser or has BYPASSRLS, and no app role is available, so row-level security would not apply. Connect as a non-superuser (see docker/initdb.sh).`);
      }
      return { mode, user: me.u, appRole };
    },
    close: async () => { if (driver.kind === 'pglite') await driver.pglite.close(); else await driver.pool.end(); },
  };
  return db;
}

async function openPostgres(url, { appRole }) {
  let pg;
  try { pg = (await import('pg')).default; } catch {
    throw new Error('DATABASE_URL is set but the "pg" package is not installed. Run `npm install` (it is an optional dependency).');
  }
  // int8 (COUNT/SUM, BIGINT money) → JS number. Values stay well inside 2^53 (AED fils up to 9e15).
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => Number(v));
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 10) });
  return makePostgres({ kind: 'pg', pool }, { appRole });
}

export async function openPglite({ appRole = 'dara_app' } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite();
  await pglite.waitReady;
  return makePostgres({ kind: 'pglite', pglite }, { appRole });
}

/**
 * openDb({ file }) → SQLite; openDb({ url }) → Postgres; openDb({ pglite: true }) → in-process Postgres (tests).
 * Migrations run on open.
 */
export async function openDb(opts = {}) {
  if (typeof opts === 'string') opts = { file: opts };
  const appRole = opts.appRole ?? process.env.PG_APP_ROLE ?? 'dara_app';
  const db = opts.url ? await openPostgres(opts.url, { appRole }) : opts.pglite ? await openPglite({ appRole }) : await openSqlite(opts.file ?? ':memory:');
  await db.migrateUp();
  if (db.dialect === 'postgres') db.isolation = await db.verifyIsolation();
  return db;
}
