// API tests: authentication, CSRF, permission allow/deny per role, workflows, tenant isolation, realtime.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startApp, client, as, userByEmail } from './helpers.js';
import { uuidv7, nowIso } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

let env; let mgr; let lead; let agent; let admin; let karim; let yousef; let daniel;
before(async () => {
  env = await startApp();
  [mgr, lead, agent, admin, karim, yousef, daniel] = await Promise.all(['manager', 'lead', 'agent', 'admin', 'karim', 'yousef', 'daniel'].map((w) => as(env.base, w)));
});
after(() => env.close());

const leadOwnedBy = (email) => env.db.get('SELECT l.id FROM leads l JOIN users u ON u.id = l.owner_id WHERE u.email = ? LIMIT 1', email).id;
const futureHour = (h) => { const d = new Date(Date.now() + h * 3600e3); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };

describe('authentication & request guards', () => {
  test('rejects wrong password with a clear error contract', async () => {
    const r = await client(env.base).post('/auth/login', { email: 'agent@dara.demo', password: 'nope-nope-1' });
    assert.equal(r.status, 401);
    assert.equal(r.data.error.code, 'INVALID_CREDENTIALS');
    for (const k of ['code', 'message', 'details', 'traceId']) assert.ok(k in r.data.error, `error has ${k}`);
  });
  test('throttles repeated failures (429 after 8)', async () => {
    const c = client(env.base);
    for (let i = 0; i < 8; i++) await c.post('/auth/login', { email: 'priya@dara.demo', password: `bad-password-${i}` });
    assert.equal((await c.post('/auth/login', { email: 'priya@dara.demo', password: 'DaraDemo2026' })).status, 429);
  });
  test('unauthenticated API calls get 401', async () => {
    assert.equal((await client(env.base).get('/leads')).status, 401);
  });
  test('state-changing request without the CSRF header is rejected', async () => {
    const r = await agent.post('/activities', { type: 'note', summary: 'x' }, { csrf: false });
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, 'CSRF_REJECTED');
  });
  test('session cookie is HttpOnly + SameSite', async () => {
    const res = await fetch(env.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dara' }, body: JSON.stringify({ email: 'elena@dara.demo', password: 'DaraDemo2026' }) });
    const c = res.headers.get('set-cookie');
    assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Lax/);
  });
  test('static pages carry security headers', async () => {
    const res = await fetch(env.base + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal((await fetch(env.base + '/../server/db.js')).status, 404);
  });
});

describe('record scoping (Own / Team / Tenant)', () => {
  test('agent sees only own leads; manager sees all', async () => {
    const a = await agent.get('/leads'); const m = await mgr.get('/leads');
    assert.ok(a.data.items.length > 0);
    assert.ok(a.data.items.every((l) => l.owner_id === agent.user.id));
    assert.ok(m.data.items.length > a.data.items.length);
  });
  test("agent gets 404 (not 403) for another agent's lead", async () => {
    const r = await agent.get(`/leads/${leadOwnedBy('karim@dara.demo')}`);
    assert.equal(r.status, 404);
  });
  test('team lead sees team leads but not the other team', async () => {
    assert.equal((await lead.get(`/leads/${leadOwnedBy('karim@dara.demo')}`)).status, 200);
    assert.equal((await lead.get(`/leads/${leadOwnedBy('yousef@dara.demo')}`)).status, 404);
  });
  test('member dashboard: own yes, team lead for team, management for all', async () => {
    assert.equal((await agent.get('/dashboard/member/me')).status, 200);
    assert.equal((await agent.get(`/dashboard/member/${karim.user.id}`)).status, 404);
    assert.equal((await lead.get(`/dashboard/member/${agent.user.id}`)).status, 200);
    assert.equal((await lead.get(`/dashboard/member/${yousef.user.id}`)).status, 404);
    assert.equal((await mgr.get(`/dashboard/member/${yousef.user.id}`)).status, 200);
  });
  test('main dashboard and leaderboard are visible to every role', async () => {
    for (const c of [agent, lead, mgr, admin]) {
      assert.equal((await c.get('/dashboard/main?period=month')).status, 200);
      assert.equal((await c.get('/leaderboard?period=month')).status, 200);
    }
  });
  test('team control and time insights: denied to agents', async () => {
    assert.equal((await agent.get('/team/overview')).status, 403);
    assert.equal((await agent.get('/analytics/time')).status, 403);
    const t = await lead.get('/team/overview?period=month');
    assert.equal(t.status, 200);
    assert.ok(t.data.members.every((m) => m.team_name === 'Marina & Palm'));
    assert.ok((await mgr.get('/team/overview')).data.members.length >= 8);
  });
});

describe('lead → deal workflow', () => {
  let leadId; let dealId;
  test('agent creates a lead; it is assigned to them', async () => {
    const r = await agent.post('/leads', { first_name: 'Test', last_name: 'Buyer', phone: '+971 50 111 2222', transaction_type: 'buy', budget_max: 300_000_000, property_types: ['apartment'], locations: ['Dubai Marina'] });
    assert.equal(r.status, 201);
    assert.equal(r.data.item.owner_id, agent.user.id);
    leadId = r.data.item.id;
  });
  test('validation: phone or email is required', async () => {
    const r = await agent.post('/leads', { first_name: 'No contact' });
    assert.equal(r.status, 400);
    assert.ok(r.data.error.details.phone);
  });
  test('agents cannot assign or round-robin', async () => {
    assert.equal((await agent.post(`/leads/${leadId}/assign`, { owner_id: karim.user.id })).status, 403);
    assert.equal((await agent.post('/leads', { first_name: 'X', phone: '1', assign: 'round_robin' })).status, 403);
  });
  test('team lead round-robins within their team only', async () => {
    const r1 = await lead.post('/leads', { first_name: 'RR1', phone: '1', assign: 'round_robin' });
    const r2 = await lead.post('/leads', { first_name: 'RR2', phone: '2', assign: 'round_robin' });
    const team = env.db.all(`SELECT id FROM users WHERE team_id = ? AND role = 'agent'`, lead.user.team_id).map((x) => x.id);
    assert.ok(team.includes(r1.data.item.owner_id) && team.includes(r2.data.item.owner_id));
    assert.notEqual(r1.data.item.owner_id, r2.data.item.owner_id);
    assert.equal((await lead.post(`/leads/${leadId}/assign`, { owner_id: yousef.user.id })).status, 403);
  });
  test('cannot convert before qualifying; qualifying awards points once', async () => {
    assert.equal((await agent.post(`/leads/${leadId}/convert`, {})).status, 409);
    assert.equal((await agent.post(`/leads/${leadId}/status`, { status: 'contacted' })).status, 200);
    assert.equal((await agent.post(`/leads/${leadId}/status`, { status: 'qualified' })).status, 200);
    const pts = env.db.get(`SELECT COUNT(*) n FROM points_ledger WHERE source_type = 'lead_qualified' AND source_id = ?`, leadId).n;
    assert.equal(pts, 1);
  });
  test('matches are explainable and cite the listing', async () => {
    const r = await agent.get(`/leads/${leadId}/matches`);
    assert.equal(r.status, 200);
    for (const m of r.data.items) {
      assert.ok(m.property.ref.startsWith('DR-'));
      assert.ok(m.property.price <= 300_000_000);
      assert.ok(m.reasons.length > 0);
      assert.notEqual(m.property.authority, 'unverified');
    }
  });
  test('convert creates a deal owned by the lead owner', async () => {
    const r = await agent.post(`/leads/${leadId}/convert`, { value: 0 });
    assert.equal(r.status, 201);
    dealId = r.data.deal_id;
    assert.equal(env.db.get('SELECT status FROM leads WHERE id = ?', leadId).status, 'converted');
  });
  test('winning a deal requires an offer stage, listing and value', async () => {
    assert.equal((await agent.post(`/deals/${dealId}/stage`, { stage: 'won' })).data.error.code, 'INVALID_TRANSITION');
    assert.equal((await agent.post(`/deals/${dealId}/stage`, { stage: 'offer' })).status, 200);
    assert.equal((await agent.post(`/deals/${dealId}/stage`, { stage: 'won' })).data.error.code, 'PROPERTY_REQUIRED');
  });
  test('won deal: listing marked sold (platform authority), points once, management notified, audited', async () => {
    const p = env.db.get(`SELECT * FROM properties WHERE status = 'available' AND authority = 'platform' AND listing_type = 'sale' LIMIT 1`);
    assert.equal((await agent.patch(`/deals/${dealId}`, { property_id: p.id, value: p.price })).status, 200);
    const r = await agent.post(`/deals/${dealId}/stage`, { stage: 'won' });
    assert.equal(r.status, 200);
    assert.equal(env.db.get('SELECT status FROM properties WHERE id = ?', p.id).status, 'sold');
    assert.equal(env.db.get(`SELECT COUNT(*) n FROM points_ledger WHERE source_type = 'deal_won' AND source_id = ?`, dealId).n, 1);
    assert.ok(env.db.get(`SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?`, mgr.user.id, `deal_won:${dealId}`));
    assert.ok(env.db.get(`SELECT id FROM audit_log WHERE entity_id = ? AND action = 'deal.stage_changed'`, dealId));
    assert.equal((await agent.patch(`/deals/${dealId}`, { title: 'edit closed' })).status, 409);
  });
  test('only management reopens a closed deal, with reason', async () => {
    assert.equal((await agent.post(`/deals/${dealId}/stage`, { stage: 'negotiation', reason: 'x' })).data.error.code, 'CLOSED_DEAL');
    assert.equal((await mgr.post(`/deals/${dealId}/stage`, { stage: 'negotiation' })).data.error.code, 'REASON_REQUIRED');
    assert.equal((await mgr.post(`/deals/${dealId}/stage`, { stage: 'negotiation', reason: 'Buyer finance fell through' })).status, 200);
  });
  test('lost requires a reason', async () => {
    assert.equal((await agent.post(`/deals/${dealId}/stage`, { stage: 'lost' })).data.error.code, 'REASON_REQUIRED');
  });
  test('externally controlled listing status is not changed by a win', async () => {
    const p = env.db.get(`SELECT * FROM properties WHERE status = 'available' AND authority = 'external' LIMIT 1`);
    const c = env.db.get('SELECT id FROM contacts WHERE owner_id = ? LIMIT 1', agent.user.id);
    const d = await agent.post('/deals', { title: 'Ext', contact_id: c.id, property_id: p.id, value: p.price });
    await agent.post(`/deals/${d.data.item.id}/stage`, { stage: 'offer' });
    const r = await agent.post(`/deals/${d.data.item.id}/stage`, { stage: 'won' });
    assert.equal(r.status, 200);
    assert.ok(r.data.notes[0].includes('controlled externally'));
    assert.equal(env.db.get('SELECT status FROM properties WHERE id = ?', p.id).status, 'available');
  });
});

describe('tasks: assignment and manager review', () => {
  let taskId;
  test('agent cannot assign work to someone else', async () => {
    assert.equal((await agent.post('/tasks', { title: 'x', assignee_id: karim.user.id })).status, 403);
  });
  test('team lead assigns to own team only', async () => {
    assert.equal((await lead.post('/tasks', { title: 'x', assignee_id: yousef.user.id })).status, 403);
    const r = await lead.post('/tasks', { title: 'Call back portal leads', assignee_id: agent.user.id, priority: 'high', due_at: futureHour(5) });
    assert.equal(r.status, 201);
    taskId = r.data.item.id;
    assert.ok(env.db.get(`SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?`, agent.user.id, `task_assigned:${taskId}`));
  });
  test("other agents can't see the task", async () => {
    assert.equal((await karim.post(`/tasks/${taskId}/transition`, { action: 'start' })).status, 404);
  });
  test('assignee cannot approve; reviewer cannot submit', async () => {
    assert.equal((await agent.post(`/tasks/${taskId}/transition`, { action: 'submit', note: 'Done' })).status, 200);
    assert.equal((await agent.post(`/tasks/${taskId}/transition`, { action: 'approve' })).status, 403);
    assert.equal((await lead.post(`/tasks/${taskId}/transition`, { action: 'request_changes' })).data.error.code, 'NOTE_REQUIRED');
  });
  test('approval awards priority points plus on-time bonus exactly once', async () => {
    const r = await lead.post(`/tasks/${taskId}/transition`, { action: 'approve' });
    assert.equal(r.status, 200); assert.equal(r.data.item.status, 'approved');
    const rows = env.db.all(`SELECT source_type, points FROM points_ledger WHERE source_id = ? ORDER BY source_type`, taskId);
    assert.deepEqual(rows.map((x) => [x.source_type, x.points]), [['task_approved', 15], ['task_on_time', 5]]);
    assert.equal((await lead.post(`/tasks/${taskId}/transition`, { action: 'approve' })).status, 409);
  });
  test('self-assigned agent task needs a team lead or manager to approve', async () => {
    const t = await agent.post('/tasks', { title: 'Self task' });
    await agent.post(`/tasks/${t.data.item.id}/transition`, { action: 'submit', note: 'ok' });
    assert.equal((await agent.post(`/tasks/${t.data.item.id}/transition`, { action: 'approve' })).status, 403);
    const review = await lead.get('/tasks?view=review');
    assert.ok(review.data.items.some((x) => x.id === t.data.item.id));
    assert.equal((await mgr.post(`/tasks/${t.data.item.id}/transition`, { action: 'approve' })).status, 200);
  });
});

describe('calendar', () => {
  let evId;
  test('creates an event and invites attendees', async () => {
    const r = await agent.post('/events', { title: 'Viewing test', type: 'viewing', start_at: futureHour(240), end_at: futureHour(241), attendee_ids: [karim.user.id] });
    assert.equal(r.status, 201); evId = r.data.item.id;
    assert.ok(env.db.get(`SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?`, karim.user.id, `invite:${evId}`));
  });
  test('detects double booking (409) and allows explicit override', async () => {
    const body = { title: 'Clash', type: 'meeting', start_at: futureHour(240), end_at: futureHour(241) };
    const r = await karim.post('/events', body);
    assert.equal(r.status, 409); assert.equal(r.data.error.code, 'CALENDAR_CONFLICT');
    assert.equal((await karim.post('/events', { ...body, allow_conflicts: true })).status, 201);
  });
  test('end must be after start', async () => {
    assert.equal((await agent.post('/events', { title: 'Bad', type: 'call', start_at: futureHour(250), end_at: futureHour(249) })).status, 400);
  });
  test('attendee RSVPs; non-organizer cannot record outcome; future events cannot be completed', async () => {
    assert.equal((await karim.post(`/events/${evId}/rsvp`, { response: 'accepted' })).status, 200);
    assert.equal((await karim.post(`/events/${evId}/outcome`, { status: 'completed' })).status, 403);
    assert.equal((await agent.post(`/events/${evId}/outcome`, { status: 'completed' })).data.error.code, 'EVENT_NOT_STARTED');
  });
  test('completing a past viewing awards points once', async () => {
    const start = new Date(Date.now() - 2 * 3600e3).toISOString(); const end = new Date(Date.now() - 3600e3).toISOString();
    const r = await agent.post('/events', { title: 'Past viewing', type: 'viewing', start_at: start, end_at: end, allow_conflicts: true });
    assert.equal((await agent.post(`/events/${r.data.item.id}/outcome`, { status: 'completed', outcome: 'Liked it' })).status, 200);
    assert.equal(env.db.get(`SELECT points FROM points_ledger WHERE source_id = ?`, r.data.item.id).points, 20);
    assert.equal((await agent.post(`/events/${r.data.item.id}/outcome`, { status: 'completed' })).status, 409);
  });
  test('agent cannot read a manager-only event they are not invited to', async () => {
    const r = await mgr.post('/events', { title: 'Board prep', type: 'internal', start_at: futureHour(300), end_at: futureHour(301) });
    assert.equal((await agent.get(`/events/${r.data.item.id}`)).status, 404);
    assert.equal((await mgr.get(`/events/${r.data.item.id}`)).status, 200);
  });
});

describe('chat', () => {
  test('team channels are private to the team (+ management)', async () => {
    const downtown = env.db.get(`SELECT id FROM channels WHERE kind = 'team' AND name = 'downtown-hills'`).id;
    assert.equal((await agent.get(`/channels/${downtown}/messages`)).status, 404);
    assert.equal((await yousef.get(`/channels/${downtown}/messages`)).status, 200);
    assert.equal((await mgr.get(`/channels/${downtown}/messages`)).status, 200);
  });
  test('direct message is created once and mentions notify', async () => {
    const a = await agent.post('/channels/dm', { user_id: yousef.user.id });
    const b = await yousef.post('/channels/dm', { user_id: agent.user.id });
    assert.equal(a.data.item.id, b.data.item.id);
    const m = await agent.post(`/channels/${a.data.item.id}/messages`, { body: 'Hi @Yousef, can you share the Canal Point floor plan?' });
    assert.equal(m.status, 201);
    assert.ok(env.db.get(`SELECT id FROM notifications WHERE user_id = ? AND type = 'mention'`, yousef.user.id));
  });
  test('only management creates company-wide channels; agents none', async () => {
    assert.equal((await agent.post('/channels', { name: 'x' })).status, 403);
    assert.equal((await lead.post('/channels', { name: 'x', kind: 'public' })).status, 403);
    assert.equal((await lead.post('/channels', { name: 'marina-viewings', kind: 'team' })).status, 201);
    assert.equal((await mgr.post('/channels', { name: 'off-plan', kind: 'public' })).status, 201);
  });
  test('messages are pushed in real time over SSE', async () => {
    const general = env.db.get(`SELECT id FROM channels WHERE kind = 'public' AND name = 'general'`).id;
    const received = new Promise((resolve, reject) => {
      const req = http.get(env.base + '/api/stream', { headers: { cookie: karim.cookie } }, (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk;
          if (buf.includes('retry:')) agent.post(`/channels/${general}/messages`, { body: 'Realtime check' });
          const m = buf.match(/event: message\ndata: (.+)\n/);
          if (m) { req.destroy(); resolve(JSON.parse(m[1])); }
        });
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
      setTimeout(() => reject(new Error('no SSE message within 3s')), 3000);
    });
    const msg = await received;
    assert.equal(msg.body, 'Realtime check');
    assert.equal(msg.channel_id, general);
  });
});

describe('administration', () => {
  test('manager adds agents but not admins; admin can add any role', async () => {
    assert.equal((await mgr.post('/users', { name: 'X', email: 'x@dara.demo', role: 'admin', password: 'Password123456' })).status, 403);
    const r = await mgr.post('/users', { name: 'New Agent', email: 'new.agent@dara.demo', role: 'agent', team_id: lead.user.team_id, password: 'Password123456' });
    assert.equal(r.status, 201);
    assert.equal(r.data.item.must_change_password, true);
    assert.equal((await mgr.post('/users', { name: 'Dup', email: 'NEW.AGENT@dara.demo', role: 'agent', password: 'Password123456' })).status, 409);
    assert.equal((await admin.post('/users', { name: 'Ops', email: 'ops@dara.demo', role: 'admin', password: 'Password123456' })).status, 201);
  });
  test('weak passwords are rejected', async () => {
    assert.equal((await admin.post('/users', { name: 'W', email: 'w@dara.demo', role: 'agent', password: 'short' })).status, 400);
  });
  test('deactivated users are signed out and cannot sign in', async () => {
    const c = await as(env.base, 'hassan');
    const id = c.user.id;
    assert.equal((await mgr.patch(`/users/${id}`, { active: false })).status, 200);
    assert.equal((await c.get('/auth/me')).status, 401);
    assert.equal((await client(env.base).post('/auth/login', { email: 'hassan@dara.demo', password: 'DaraDemo2026' })).status, 403);
    await mgr.patch(`/users/${id}`, { active: true });
  });
  test('nobody can lock themselves out', async () => {
    assert.equal((await admin.patch(`/users/${admin.user.id}`, { active: false })).status, 409);
  });
  test('agents cannot manage people, goals, announcements or audit', async () => {
    assert.equal((await agent.post('/users', { name: 'X', email: 'y@dara.demo', role: 'agent', password: 'Password123456' })).status, 403);
    assert.equal((await agent.put('/goals', { user_id: agent.user.id, month: '2026-10', metric: 'deals_won', target: 99 })).status, 403);
    assert.equal((await agent.post('/announcements', { title: 'x', body: 'y' })).status, 403);
    assert.equal((await agent.get('/audit')).status, 403);
  });
  test("team lead can't set their own goals; manager can set anyone's", async () => {
    assert.equal((await lead.put('/goals', { user_id: lead.user.id, month: '2026-10', metric: 'deals_won', target: 3 })).status, 403);
    assert.equal((await lead.put('/goals', { user_id: agent.user.id, month: '2026-10', metric: 'deals_won', target: 3 })).status, 200);
    assert.equal((await mgr.put('/goals', { user_id: lead.user.id, month: '2026-10', metric: 'deals_won', target: 3 })).status, 200);
  });
  test('password change keeps current session and revokes others', async () => {
    const a = await as(env.base, 'elena'); const b = await as(env.base, 'elena');
    assert.equal((await a.post('/auth/password', { current: 'DaraDemo2026', next: 'NewPassword2026' })).status, 200);
    assert.equal((await a.get('/auth/me')).status, 200);
    assert.equal((await b.get('/auth/me')).status, 401);
  });
});

describe('tenant isolation', () => {
  let outsider;
  before(async () => {
    const t = uuidv7(); const u = uuidv7();
    env.db.run('INSERT INTO tenants(id, name, created_at) VALUES (?,?,?)', t, 'Other Brokerage', nowIso());
    env.db.run(`INSERT INTO users(id, tenant_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?, 'admin', ?)`, u, t, 'Outsider', 'boss@other.test', hashPassword('OtherPass2026'), nowIso());
    outsider = client(env.base); await outsider.login('boss@other.test', 'OtherPass2026');
  });
  test('cross-tenant record access returns 404 and lists are empty', async () => {
    assert.equal((await outsider.get(`/leads/${leadOwnedBy('agent@dara.demo')}`)).status, 404);
    assert.equal((await outsider.get('/leads')).data.items.length, 0);
    assert.equal((await outsider.get('/deals')).data.items.length, 0);
    assert.equal((await outsider.get('/properties')).data.items.length, 0);
    assert.equal((await outsider.get(`/dashboard/member/${agent.user.id}`)).status, 404);
    const general = env.db.get(`SELECT id FROM channels WHERE name = 'general'`).id;
    assert.equal((await outsider.get(`/channels/${general}/messages`)).status, 404);
    assert.equal((await outsider.get('/users')).data.items.length, 1);
  });
  test('cross-tenant writes are refused', async () => {
    assert.equal((await outsider.post('/tasks', { title: 'x', assignee_id: agent.user.id })).status, 400);
    assert.equal((await outsider.patch(`/users/${agent.user.id}`, { active: false })).status, 404);
    assert.equal((await outsider.post('/channels/dm', { user_id: agent.user.id })).status, 404);
  });
});

describe('analytics consistency', () => {
  test('main dashboard totals equal the sum of per-member figures', async () => {
    const main = await mgr.get('/dashboard/main?period=year');
    const team = await mgr.get('/team/overview?period=year');
    const sum = team.data.members.reduce((s, m) => s + m.kpis.won_volume, 0);
    // Managers/admins own no deals in the seed, so field members account for all closed volume.
    assert.equal(sum, main.data.kpis.won_volume);
  });
  test('leaderboard is ranked by points', async () => {
    const r = await agent.get('/leaderboard?period=year');
    const pts = r.data.items.map((x) => x.points);
    assert.deepEqual(pts, [...pts].sort((a, b) => b - a));
  });
  test('daily activity points are capped at 30', async () => {
    for (let i = 0; i < 15; i++) await daniel.post('/activities', { type: 'call', summary: `cap ${i}`, lead_id: leadOwnedBy('daniel@dara.demo') });
    const day = new Date().toISOString().slice(0, 10);
    const s = env.db.get(`SELECT SUM(points) s FROM points_ledger WHERE user_id = ? AND source_type = 'activity' AND substr(at,1,10) = ?`, daniel.user.id, day).s;
    assert.ok(s <= 30, `got ${s}`);
  });
});
