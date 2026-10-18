// SaaS (Part F), projects, reservations (E2: AC-RES-01..03) and Dubai compliance (Part G) — API tests.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client, finishOnboarding, as } from './helpers.js';

let env; let mgr; let agent; let karim; let lead; let admin; let platform; let yousef;
before(async () => {
  env = await startApp();
  [mgr, agent, karim, lead, admin, platform, yousef] = await Promise.all(['manager', 'agent', 'karim', 'lead', 'admin', 'platform', 'yousef'].map((w) => as(env.base, w)));
});
after(() => env.close());

const demoTenant = async () => await env.db.get(`SELECT * FROM tenants WHERE slug = 'dara-demo'`);
const FREE_UNIT_SQL = `SELECT p.* FROM properties p JOIN tenants t ON t.id = p.tenant_id WHERE t.slug = 'dara-demo' AND p.status = 'available' AND p.authority = ?
  AND p.id NOT IN (SELECT property_id FROM reservations WHERE status IN ('held','pending_confirmation','confirmed')) ORDER BY p.ref LIMIT 1`;
const freeUnit = async (authority = 'platform') => await env.db.get(FREE_UNIT_SQL, authority);

describe('self-signup and workspace', () => {
  let owner; let tenantId;
  test('a brokerage signs up and lands in its own empty trial workspace', async () => {
    owner = client(env.base);
    const r = await owner.post('/signup', { company: 'Test Brokerage', name: 'Tess Owner', email: 'tess@testbrokerage.ae', password: 'StrongPass2026', orn: 'ORN-1', accept_terms: true });
    assert.equal(r.status, 201);
    tenantId = r.data.tenant_id;
    // New workspaces: owner is unverified and must set up two-step sign-in before using the app.
    assert.equal(r.data.user.email_verified, false);
    assert.equal(r.data.user.mfa_setup_required, true);
    assert.equal(env.mailer.sent.at(-1).to, 'tess@testbrokerage.ae');
    assert.equal((await owner.get('/leads')).data.error.code, 'MFA_SETUP_REQUIRED');
    await finishOnboarding(owner, r);
    const me = await owner.get('/auth/me');
    assert.equal(me.data.user.role, 'admin');
    assert.equal(me.data.tenant.status, 'trial');
    assert.ok(me.data.tenant.trial_ends_at > new Date(Date.now() + 13 * 864e5).toISOString());
    assert.equal((await owner.get('/leads')).data.items.length, 0);
    assert.equal((await owner.get('/properties')).data.items.length, 0);
    assert.equal((await owner.get('/users')).data.items.length, 1);
    const main = await owner.get('/dashboard/main?period=month');
    assert.equal(main.status, 200);
    assert.equal(main.data.kpis.deals_won, 0);
    assert.ok((await owner.get('/channels')).data.items.some((c) => c.name === 'general'));
  });
  test('signup validation: terms, weak password, duplicate email (global)', async () => {
    const c = client(env.base);
    assert.equal((await c.post('/signup', { company: 'X Co', name: 'X', email: 'x@x.ae', password: 'StrongPass2026' })).data.error.details.accept_terms, 'is required');
    assert.equal((await c.post('/signup', { company: 'X Co', name: 'X', email: 'x@x.ae', password: 'short', accept_terms: true })).status, 400);
    const dup = await c.post('/signup', { company: 'X Co', name: 'X', email: 'AGENT@dara.demo', password: 'StrongPass2026', accept_terms: true });
    assert.equal(dup.status, 409); assert.equal(dup.data.error.code, 'EMAIL_TAKEN');
  });
  test('emails are unique across tenants, so admins cannot create a clashing user', async () => {
    const r = await owner.post('/users', { name: 'Clash', email: 'manager@dara.demo', role: 'agent', password: 'Password123456' });
    assert.equal(r.status, 409);
  });
  test('trial seat limit (5) is enforced on the server, including on reactivation', async () => {
    for (let i = 1; i <= 4; i++) assert.equal((await owner.post('/users', { name: `Agent ${i}`, email: `a${i}@testbrokerage.ae`, role: 'agent', password: 'Password123456' })).status, 201);
    const over = await owner.post('/users', { name: 'Sixth', email: 'a6@testbrokerage.ae', role: 'agent', password: 'Password123456' });
    assert.equal(over.status, 409); assert.equal(over.data.error.code, 'ENTITLEMENT_LIMIT');
    const ws = await owner.get('/workspace');
    assert.equal(ws.data.item.subscription.usage.seats, 5);
    assert.equal(ws.data.item.subscription.percent.seats, 100);
    const a1 = (await env.db.get(`SELECT id FROM users WHERE email = 'a1@testbrokerage.ae'`)).id;
    assert.equal((await owner.patch(`/users/${a1}`, { active: false })).status, 200);
    assert.equal((await owner.post('/users', { name: 'Sixth', email: 'a6@testbrokerage.ae', role: 'agent', password: 'Password123456' })).status, 201);
    assert.equal((await owner.patch(`/users/${a1}`, { active: true })).data.error.code, 'ENTITLEMENT_LIMIT');
  });
  test('workspace settings: admin edits Dubai fields; manager cannot', async () => {
    assert.equal((await owner.patch('/workspace', { trade_licence_no: 'TL-9', trade_licence_expiry: '2027-03-01', orn: 'ORN-22' })).status, 200);
    assert.equal((await mgr.patch('/workspace', { orn: 'nope' })).status, 403);
    assert.equal((await mgr.get('/workspace')).data.item.orn, 'SYN-ORN-0042', 'manager reads own workspace only');
  });
  test('expired trial → read-only, but data stays readable and exportable; reactivation restores writes', async () => {
    await env.db.run(`UPDATE tenants SET trial_ends_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`, tenantId);
    const w = await owner.post('/leads', { first_name: 'Blocked', phone: '1' });
    assert.equal(w.status, 403); assert.equal(w.data.error.code, 'WORKSPACE_READ_ONLY');
    assert.equal((await owner.get('/leads')).status, 200);
    const ex = await fetch(env.base + '/api/export', { headers: { cookie: owner.cookie } });
    assert.equal(ex.status, 200);
    assert.match(ex.headers.get('content-disposition'), /attachment; filename="dara-export-test-brokerage/);
    const data = await ex.json();
    assert.equal(data.format, 'dara-export/v1');
    assert.equal(data.users.length, 6);
    assert.ok(data.users.every((u) => !('password_hash' in u)), 'no password hashes in exports');
    assert.equal((await owner.post('/auth/password', { current: 'StrongPass2026', next: 'StrongPass2027' })).status, 200, 'account security still works when read-only');
    await env.db.run(`UPDATE tenants SET status = 'active' WHERE id = ?`, tenantId);
    assert.equal((await owner.post('/leads', { first_name: 'Allowed', phone: '1' })).status, 201);
  });
  test('export is admin-only and contains only the caller’s tenant', async () => {
    assert.equal((await mgr.get('/export')).status, 403);
    const ex = await (await fetch(env.base + '/api/export', { headers: { cookie: admin.cookie } })).json();
    const demo = (await demoTenant()).id;
    assert.ok(ex.leads.length > 50 && ex.leads.every((l) => l.tenant_id === demo));
    assert.ok(!ex.users.some((u) => u.email.endsWith('testbrokerage.ae')));
  });
});

describe('platform console', () => {
  test('platform staff list all workspaces with plan and usage; tenant admins are refused', async () => {
    const r = await platform.get('/platform/tenants');
    assert.equal(r.status, 200);
    assert.ok(r.data.items.length >= 2);
    assert.ok(r.data.items.every((t) => t.limits && t.usage));
    assert.ok(!r.data.items.some((t) => t.name === 'Dara Platform'));
    assert.equal((await admin.get('/platform/tenants')).status, 403);
  });
  test('platform accounts cannot read brokerage data', async () => {
    assert.equal((await platform.get('/leads')).status, 403);
    assert.equal((await platform.get('/export')).status, 403);
  });
  test('suspending a workspace makes it read-only, is visible to its admins, and is audited', async () => {
    const palm = (await env.db.get(`SELECT id FROM tenants WHERE name LIKE 'Palm Coast%'`)).id;
    assert.equal((await platform.patch(`/platform/tenants/${palm}`, { status: 'suspended' })).data.error.details.reason, 'is required');
    const r = await platform.patch(`/platform/tenants/${palm}`, { status: 'suspended', reason: 'Trial abuse check' });
    assert.equal(r.status, 200); assert.equal(r.data.item.access, 'read_only');
    const owner = client(env.base); await owner.login('owner@palmcoast.demo');
    assert.equal((await owner.post('/leads', { first_name: 'x', phone: '1' })).data.error.code, 'WORKSPACE_READ_ONLY');
    assert.ok(await env.db.get(`SELECT id FROM audit_log WHERE tenant_id = ? AND action = 'tenant.subscription_changed'`, palm));
    assert.ok((await owner.get('/notifications')).data.items.some((n) => n.type === 'subscription'));
    const up = await platform.patch(`/platform/tenants/${palm}`, { status: 'active', plan: 'starter', reason: 'Converted to paid' });
    assert.equal(up.data.item.limits.seats, 10);
    assert.equal((await owner.post('/leads', { first_name: 'x', phone: '1' })).status, 201);
  });
});

describe('projects decide availability authority', () => {
  let projectId;
  test('only management manages projects', async () => {
    assert.equal((await agent.post('/projects', { name: 'Nope', authority: 'platform' })).status, 403);
    const r = await mgr.post('/projects', { name: 'Test Tower', developer: 'Synthetic Dev', community: 'Dubai Marina', authority: 'external', completion: 'off_plan' });
    assert.equal(r.status, 201); projectId = r.data.item.id;
    assert.equal((await mgr.post('/projects', { name: 'test tower', authority: 'platform' })).status, 409);
  });
  test('listings in a project inherit its authority and cannot override it', async () => {
    const r = await agent.post('/properties', { title: 'Unit 1201', type: 'apartment', listing_type: 'sale', price: 150_000_000, project_id: projectId, authority: 'platform' });
    assert.equal(r.status, 201);
    assert.equal(r.data.item.authority, 'external');
    assert.equal(r.data.item.project, 'Test Tower');
    assert.equal((await agent.patch(`/properties/${r.data.item.id}`, { authority: 'platform' })).data.error.code, 'AUTHORITY_FROM_PROJECT');
  });
  test('changing a project’s authority cascades to its listings', async () => {
    const r = await mgr.patch(`/projects/${projectId}`, { authority: 'platform' });
    assert.equal(r.data.listings_updated, 1);
    assert.equal((await env.db.get('SELECT authority FROM properties WHERE project_id = ?', projectId)).authority, 'platform');
  });
  test('holds cannot be set by editing the listing status', async () => {
    const p = await freeUnit();
    assert.equal((await mgr.patch(`/properties/${p.id}`, { status: 'reserved' })).data.error.code, 'USE_RESERVATIONS');
  });
});

describe('reservations (E2)', () => {
  test('AC-RES-01: 30 concurrent holds on one unit → exactly one succeeds, the rest 409 with no side effects', async () => {
    const p = await freeUnit();
    const callers = [agent, karim, lead, mgr, yousef];
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => callers[i % callers.length].post('/reservations', { property_id: p.id })));
    const ok = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    assert.equal(ok.length, 1);
    assert.equal(conflicts.length, 29);
    assert.ok(conflicts.every((r) => ['RESERVATION_CONFLICT', 'UNIT_UNAVAILABLE'].includes(r.data.error.code)));
    assert.equal((await env.db.get(`SELECT COUNT(*) n FROM reservations WHERE property_id = ? AND status = 'held'`, p.id)).n, 1);
    assert.equal((await env.db.get('SELECT status FROM properties WHERE id = ?', p.id)).status, 'on_hold');
    // The conflict message names the holder's team, not the person.
    const c = conflicts.find((r) => r.data.error.code === 'RESERVATION_CONFLICT');
    if (c) assert.ok(!/Aisha|Karim|Sara|Omar|Yousef/.test(c.data.error.message));
  });

  test('database index blocks a second active reservation even if application checks are bypassed', async () => {
    const r = await env.db.get(`SELECT * FROM reservations WHERE status = 'held' LIMIT 1`);
    await assert.rejects(() => env.db.run(`INSERT INTO reservations(id, tenant_id, property_id, agent_id, status, authority, created_at, updated_at) VALUES ('dup', ?, ?, ?, 'held', 'platform', 'x', 'x')`, r.tenant_id, r.property_id, r.agent_id), /UNIQUE|duplicate key/);
  });

  test('AC-RES-02: an elapsed hold expires, the unit returns to available, and the agent is notified once', async () => {
    const p = await freeUnit('platform');
    const r = await agent.post('/reservations', { property_id: p.id });
    await env.db.run(`UPDATE reservations SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`, r.data.item.id);
    assert.equal(await env.app.ctx.sweepReservations(), 1);
    assert.equal(await env.app.ctx.sweepReservations(), 0);
    assert.equal((await env.db.get('SELECT status FROM reservations WHERE id = ?', r.data.item.id)).status, 'expired');
    assert.equal((await env.db.get('SELECT status FROM properties WHERE id = ?', p.id)).status, 'available');
    assert.equal((await env.db.get(`SELECT COUNT(*) n FROM notifications WHERE dedupe_key = ?`, `res_expired:${r.data.item.id}`)).n, 1);
  });

  test('AC-RES-03: externally controlled unit is labelled as an internal hold and cannot be confirmed without a reference', async () => {
    const p = await freeUnit('external');
    const r = await agent.post('/reservations', { property_id: p.id });
    assert.equal(r.status, 201);
    assert.equal(r.data.item.label, 'Internal hold — not confirmed with developer');
    const id = r.data.item.id;
    assert.equal((await agent.post(`/reservations/${id}/submit`, {})).data.error.code, 'DEPOSIT_REQUIRED');
    assert.equal((await agent.post(`/reservations/${id}/submit`, { deposit_note: 'Cheque 112' })).status, 200);
    assert.equal((await agent.post(`/reservations/${id}/confirm`, { external_ref: 'X' })).status, 403);
    assert.equal((await mgr.post(`/reservations/${id}/confirm`, {})).data.error.code, 'REFERENCE_REQUIRED');
    const c = await mgr.post(`/reservations/${id}/confirm`, { external_ref: 'DEV-REF-9' });
    assert.equal(c.status, 200);
    assert.equal(c.data.item.status, 'confirmed'); assert.equal(c.data.item.label, null);
    assert.equal((await env.db.get('SELECT status FROM properties WHERE id = ?', p.id)).status, 'reserved');
    assert.equal((await agent.post(`/reservations/${id}/cancel`, { reason: 'x' })).status, 403, 'confirmed needs management to cancel');
    assert.equal((await mgr.post(`/reservations/${id}/cancel`, { reason: 'Buyer withdrew' })).status, 200);
    assert.equal((await env.db.get('SELECT status FROM properties WHERE id = ?', p.id)).status, 'available');
  });

  test('renewal: management only, once', async () => {
    const p = await freeUnit('platform');
    const r = await agent.post('/reservations', { property_id: p.id });
    const id = r.data.item.id;
    assert.equal((await agent.post(`/reservations/${id}/renew`)).status, 403);
    const before = r.data.item.expires_at;
    const ok = await mgr.post(`/reservations/${id}/renew`);
    assert.equal(ok.status, 200);
    assert.ok(ok.data.item.expires_at > before);
    assert.equal((await mgr.post(`/reservations/${id}/renew`)).data.error.code, 'RENEWAL_LIMIT');
  });

  test('unverified imports cannot be held; agents only see their own reservations', async () => {
    const u = await env.db.get(`SELECT p.id FROM properties p JOIN tenants t ON t.id = p.tenant_id WHERE t.slug = 'dara-demo' AND p.authority = 'unverified' AND p.status = 'available' LIMIT 1`);
    if (u) assert.equal((await agent.post('/reservations', { property_id: u.id })).data.error.code, 'UNVERIFIED_UNIT');
    const mine = await karim.get('/reservations');
    assert.ok(mine.data.items.every((x) => x.agent_id === karim.user.id));
    const someoneElse = (await env.db.get('SELECT id FROM reservations WHERE agent_id = ? LIMIT 1', agent.user.id)).id;
    assert.equal((await karim.get(`/reservations/${someoneElse}`)).status, 404);
    assert.equal((await lead.get(`/reservations/${someoneElse}`)).status, 200, 'team lead sees team reservations');
  });

  test('holding from a deal moves it to the reservation stage; winning converts the hold; another deal cannot win a held unit', async () => {
    const p = await freeUnit('platform');
    const c = await env.db.get('SELECT id FROM contacts WHERE owner_id = ? LIMIT 1', agent.user.id);
    const d1 = (await agent.post('/deals', { title: 'Res deal', contact_id: c.id, property_id: p.id, value: p.price })).data.item;
    await agent.post(`/deals/${d1.id}/stage`, { stage: 'offer' });
    const r = await agent.post('/reservations', { property_id: p.id, deal_id: d1.id });
    assert.equal(r.status, 201);
    assert.equal((await env.db.get('SELECT stage FROM deals WHERE id = ?', d1.id)).stage, 'reservation');
    const d2 = (await agent.post('/deals', { title: 'Other deal', contact_id: c.id, property_id: p.id, value: p.price })).data.item;
    await agent.post(`/deals/${d2.id}/stage`, { stage: 'offer' });
    assert.equal((await agent.post(`/deals/${d2.id}/stage`, { stage: 'won' })).data.error.code, 'UNIT_RESERVED_ELSEWHERE');
    assert.equal((await env.db.get('SELECT stage FROM deals WHERE id = ?', d2.id)).stage, 'offer', 'failed win rolled back');
    const won = await agent.post(`/deals/${d1.id}/stage`, { stage: 'won' });
    assert.equal(won.status, 200);
    assert.equal((await env.db.get('SELECT status FROM reservations WHERE id = ?', r.data.item.id)).status, 'converted');
    assert.equal((await env.db.get('SELECT status FROM properties WHERE id = ?', p.id)).status, p.listing_type === 'rent' ? 'rented' : 'sold');
  });

  test('cross-tenant: another brokerage cannot see or hold this tenant’s units', async () => {
    const owner = client(env.base); await owner.login('owner@palmcoast.demo');
    const p = await freeUnit('platform');
    assert.equal((await owner.post('/reservations', { property_id: p.id })).status, 404);
    assert.equal((await owner.get('/reservations')).data.items.length, 0);
    assert.equal((await owner.get('/projects')).data.items.length, 0);
  });
});

describe('Dubai compliance reminders (Part G, [Verify])', () => {
  test('BRN expiring/expired cards notify the person and management once', async () => {
    const sent = await env.app.ctx.sweep();
    void sent;
    const karimId = karim.user.id; const hassan = (await env.db.get(`SELECT id FROM users WHERE email = 'hassan@dara.demo'`)).id;
    assert.ok(await env.db.get(`SELECT id FROM notifications WHERE user_id = ? AND type = 'compliance' AND title LIKE 'Broker card%'`, karimId));
    assert.ok(await env.db.get(`SELECT id FROM notifications WHERE user_id = ? AND type = 'compliance' AND title LIKE 'Broker card (BRN) expired%'`, hassan));
    assert.ok(await env.db.get(`SELECT id FROM notifications WHERE user_id = ? AND type = 'compliance' AND title LIKE 'Karim Nasser:%'`, mgr.user.id));
    const before = (await env.db.get(`SELECT COUNT(*) n FROM notifications WHERE type = 'compliance'`)).n;
    await env.app.ctx.sweep();
    assert.equal((await env.db.get(`SELECT COUNT(*) n FROM notifications WHERE type = 'compliance'`)).n, before, 'no duplicate reminders');
  });
  test('compliance view is scoped and flags states', async () => {
    const m = await mgr.get('/compliance');
    assert.ok(m.data.people.some((p) => p.state === 'expired'));
    assert.ok(m.data.people.some((p) => p.state === 'expiring'));
    assert.match(m.data.note, /verified with RERA\/DLD/);
    const a = await agent.get('/compliance');
    assert.ok(a.data.people.every((p) => p.id === agent.user.id));
  });
  test('BRN is editable by management on a person', async () => {
    const r = await mgr.patch(`/users/${agent.user.id}`, { brn: 'BRN-123', brn_expiry: '2027-06-30' });
    assert.equal(r.status, 200);
    assert.equal(r.data.item.brn, 'BRN-123');
  });
});
