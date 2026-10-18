// Migration up/down on a populated database, and seed integrity. Runs on SQLite or PGlite (DB_BACKEND).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, BACKEND } from './helpers.js';
import { seed } from '../server/seed.js';

const ALL = BACKEND === 'pglite'
  ? ['001_init', '002_saas_projects_reservations', '003_row_level_security', '004_auth_security']
  : ['001_init', '002_saas_projects_reservations', '003_auth_security'];

test('migrations roll all the way down and back up on a populated database', async () => {
  const db = await openTestDb();
  await seed(db);
  assert.ok((await db.get('SELECT COUNT(*) n FROM reservations')).n > 0);
  // Roll back everything after 001, newest first, checking each name.
  for (const name of ALL.slice(1).reverse()) assert.equal(await db.migrateDown(), name);
  assert.equal(await db.tableExists('reservations'), false);
  assert.equal(await db.tableExists('auth_tokens'), false);
  assert.ok((await db.get('SELECT COUNT(*) n FROM leads')).n > 0, '001 data survives rolling back later migrations');
  assert.equal(await db.migrateDown(), '001_init');
  assert.equal(await db.tableExists('leads'), false);
  assert.equal(await db.migrateDown(), null, 'nothing left to roll back');
  assert.deepEqual(await db.migrateUp(), ALL);
  assert.equal((await db.get('SELECT COUNT(*) n FROM leads')).n, 0);
  await db.close();
});

test('later migrations apply on top of an existing 001 database with data', async () => {
  const db = await openTestDb();
  await seed(db);
  for (let i = 1; i < ALL.length; i++) await db.migrateDown();
  const ran = await db.migrateUp();
  assert.deepEqual(ran, ALL.slice(1));
  assert.ok((await db.get('SELECT COUNT(*) n FROM deals')).n > 0);
  // 003/004 auth migration marks existing users verified so nobody is locked out by the upgrade.
  assert.equal((await db.get('SELECT COUNT(*) n FROM users WHERE email_verified_at IS NULL')).n, 0);
  await db.close();
});

test('seed is deterministic in shape and labelled synthetic', async () => {
  const db = await openTestDb();
  await seed(db);
  for (const t of await db.all('SELECT name FROM tenants WHERE is_platform = 0')) assert.match(t.name, /synthetic/i);
  assert.equal((await db.get(`SELECT COUNT(*) n FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE t.slug = 'dara-demo'`)).n, 10);
  assert.equal((await db.get('SELECT COUNT(*) n FROM tenants WHERE is_platform = 1')).n, 1);
  assert.ok((await db.get(`SELECT COUNT(*) n FROM deals WHERE stage = 'won'`)).n > 5);
  assert.ok((await db.get(`SELECT COUNT(*) n FROM events WHERE status = 'scheduled'`)).n > 20);
  assert.equal((await db.get(`SELECT COUNT(*) n FROM deals d JOIN properties p ON p.id = d.property_id WHERE d.stage = 'won' AND p.authority = 'platform' AND p.status NOT IN ('sold','rented')`)).n, 0);
  assert.equal((await db.get(`SELECT COUNT(*) n FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.status IN ('held','pending_confirmation') AND p.status != 'on_hold'`)).n, 0);
  assert.equal((await db.get(`SELECT COUNT(*) n FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.status = 'confirmed' AND p.status != 'reserved'`)).n, 0);
  assert.equal((await db.get(`SELECT COUNT(*) n FROM properties p JOIN projects pr ON pr.id = p.project_id WHERE p.authority != 'unverified' AND p.authority != pr.authority`)).n, 0);
  await db.close();
});
