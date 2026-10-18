// Database-level tenant isolation (PostgreSQL row-level security). These run only on the Postgres backend
// (`npm run test:pg`); on SQLite isolation is enforced in the application layer and covered by api.test.js.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, BACKEND } from './helpers.js';
import { seed } from '../server/seed.js';
import { uuidv7, nowIso } from '../server/db.js';

describe('row-level security', { skip: BACKEND !== 'pglite' && 'Postgres only — run `npm run test:pg`' }, () => {
  let db; let demo; let palm;
  before(async () => {
    db = await openTestDb();
    await seed(db);
    demo = (await db.get(`SELECT id FROM tenants WHERE slug = 'dara-demo'`)).id;
    palm = (await db.get(`SELECT id FROM tenants WHERE slug LIKE 'palm-coast%'`)).id;
  });
  after(async () => { await db?.close(); });

  const inTenant = (tenantId, fn) => db.withContext({ tenantId, system: false }, fn);

  test('the app role is not a superuser and cannot bypass RLS', async () => {
    const r = await inTenant(demo, () => db.get(`SELECT current_user u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) s, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) b`));
    assert.equal(r.u, 'dara_app');
    assert.equal(r.s, false);
    assert.equal(r.b, false);
  });

  test('a tenant context sees only its own rows — even with no WHERE clause', async () => {
    for (const table of ['leads', 'deals', 'properties', 'users', 'reservations', 'messages', 'audit_log']) {
      const rows = await inTenant(palm, () => db.all(`SELECT * FROM ${table}`));
      const foreign = rows.filter((r) => r.tenant_id && r.tenant_id !== palm);
      assert.equal(foreign.length, 0, `${table} leaked rows from another tenant`);
    }
    const palmProps = await inTenant(palm, () => db.get('SELECT COUNT(*) n FROM properties'));
    const demoProps = await inTenant(demo, () => db.get('SELECT COUNT(*) n FROM properties'));
    assert.equal(palmProps.n, 3);
    assert.ok(demoProps.n > 3);
  });

  test('child tables without tenant_id are scoped through their parent', async () => {
    const hist = await inTenant(palm, () => db.get('SELECT COUNT(*) n FROM deal_stage_history'));
    assert.equal(hist.n, 0, 'palm coast has no deals, so it must see no deal history');
    const members = await inTenant(palm, () => db.all('SELECT cm.* FROM channel_members cm'));
    const palmUsers = new Set((await inTenant(palm, () => db.all('SELECT id FROM users'))).map((u) => u.id));
    assert.ok(members.every((m) => palmUsers.has(m.user_id)));
  });

  test('no context at all sees nothing', async () => {
    const n = await db.withContext({ tenantId: null, system: false }, () => db.get('SELECT COUNT(*) n FROM leads'));
    assert.equal(n.n, 0);
  });

  test('writing a row into another tenant is refused by the database', async () => {
    await assert.rejects(
      inTenant(palm, () => db.run(`INSERT INTO teams(id, tenant_id, name, created_at) VALUES (?,?,?,?)`, uuidv7(), demo, 'Smuggled', nowIso())),
      /row-level security|violates/i,
    );
    const lead = await inTenant(demo, () => db.get('SELECT id FROM leads LIMIT 1'));
    const upd = await inTenant(palm, () => db.run(`UPDATE leads SET notes = 'hijacked' WHERE id = ?`, lead.id));
    assert.equal(upd.changes, 0, 'updates cannot reach other tenants’ rows');
    const del = await inTenant(palm, () => db.run('DELETE FROM leads WHERE id = ?', lead.id));
    assert.equal(del.changes, 0);
    await assert.rejects(inTenant(palm, () => db.run('UPDATE properties SET tenant_id = ? WHERE tenant_id = ?', demo, palm)), /row-level security|violates/i);
  });

  test('tenant context never leaks between transactions (SET LOCAL is transaction-scoped)', async () => {
    const counts = [];
    for (const t of [palm, demo, palm, null]) counts.push((await db.withContext({ tenantId: t, system: false }, () => db.get('SELECT COUNT(*) n FROM properties'))).n);
    assert.equal(counts[0], counts[2]);
    assert.ok(counts[1] > counts[0]);
    assert.equal(counts[3], 0);
  });

  test('every tenant-owned table has RLS enabled and forced', async () => {
    const rows = await db.all(`SELECT c.relname, c.relrowsecurity rls, c.relforcerowsecurity force FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname NOT IN ('schema_migrations')`);
    const missing = rows.filter((r) => !r.rls || !r.force).map((r) => r.relname);
    assert.deepEqual(missing, [], `tables without forced RLS: ${missing.join(', ')}`);
  });
});
