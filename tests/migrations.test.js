// Migration up/down on a populated database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrateDown, migrateUp } from '../server/db.js';
import { seed } from '../server/seed.js';

test('migrations roll down and back up on a populated database (002 then 001)', () => {
  const db = openDb(':memory:');
  seed(db);
  assert.ok(db.get('SELECT COUNT(*) n FROM reservations').n > 0);
  assert.equal(migrateDown(db.raw), '002_saas_projects_reservations');
  assert.equal(db.get(`SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = 'reservations'`).n, 0);
  assert.ok(db.get('SELECT COUNT(*) n FROM leads').n > 0, '001 data survives rolling back 002');
  assert.equal(migrateDown(db.raw), '001_init');
  assert.equal(db.get(`SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = 'leads'`).n, 0);
  assert.deepEqual(migrateUp(db.raw), ['001_init', '002_saas_projects_reservations']);
  assert.equal(db.get('SELECT COUNT(*) n FROM leads').n, 0);
  db.close();
});

test('002 applies on top of an existing 001 database with data', () => {
  const db = openDb(':memory:');
  seed(db);
  migrateDown(db.raw); // back to 001 with data
  assert.deepEqual(migrateUp(db.raw), ['002_saas_projects_reservations']);
  assert.ok(db.get('SELECT COUNT(*) n FROM deals').n > 0);
  db.close();
});

test('seed is deterministic in shape and labelled synthetic', () => {
  const db = openDb(':memory:');
  seed(db);
  for (const t of db.all('SELECT name FROM tenants WHERE is_platform = 0')) assert.match(t.name, /synthetic/i);
  assert.equal(db.get(`SELECT COUNT(*) n FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE t.slug = 'dara-demo'`).n, 10);
  assert.equal(db.get('SELECT COUNT(*) n FROM tenants WHERE is_platform = 1').n, 1);
  assert.ok(db.get(`SELECT COUNT(*) n FROM deals WHERE stage = 'won'`).n > 5);
  assert.ok(db.get(`SELECT COUNT(*) n FROM events WHERE status = 'scheduled'`).n > 20);
  // Integrity: every won deal on platform inventory left its listing sold/rented.
  const bad = db.get(`SELECT COUNT(*) n FROM deals d JOIN properties p ON p.id = d.property_id WHERE d.stage = 'won' AND p.authority = 'platform' AND p.status NOT IN ('sold','rented')`).n;
  assert.equal(bad, 0);
  // Every unit with an active reservation is on hold or reserved; never two active reservations on one unit.
  assert.equal(db.get(`SELECT COUNT(*) n FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.status IN ('held','pending_confirmation') AND p.status != 'on_hold'`).n, 0);
  assert.equal(db.get(`SELECT COUNT(*) n FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.status = 'confirmed' AND p.status != 'reserved'`).n, 0);
  // Listings inherit project authority unless unverified.
  assert.equal(db.get(`SELECT COUNT(*) n FROM properties p JOIN projects pr ON pr.id = p.project_id WHERE p.authority != 'unverified' AND p.authority != pr.authority`).n, 0);
  db.close();
});
