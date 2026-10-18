// SaaS layer: brokerage self-signup, workspace settings & plan usage, data export, platform console.
import { respond, HttpError, badRequest, conflict, forbidden, notFound } from '../http.js';
import { uuidv7, nowIso } from '../db.js';
import { validator } from '../validate.js';
import { requireScope } from '../rbac.js';
import { hashPassword, passwordPolicy, createSession, cookieHeader, LoginThrottle } from '../auth.js';
import { audit, notify } from '../services/notify.js';
import { PLANS, STATUSES, TRIAL_DAYS, planSummary, accessMode, usage } from '../services/billing.js';
import { publicUser, sendVerification } from './auth.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace';

/** Creates a tenant with its first administrator, a default team and chat channels. Used by signup and seed. */
export async function createWorkspace(db, { company, name, email, password, trade_licence_no = null, orn = null, plan = 'trial', status = 'trial', now = new Date() }) {
  const at = now.toISOString();
  const tenantId = uuidv7(); const userId = uuidv7(); const teamId = uuidv7();
  let slug = slugify(company); let n = 1;
  while (await db.get('SELECT id FROM tenants WHERE slug = ?', slug)) slug = `${slugify(company)}-${++n}`;
  const trialEnds = status === 'trial' ? new Date(now.getTime() + TRIAL_DAYS * 864e5).toISOString() : null;
  await db.tx(async () => {
    await db.run(`INSERT INTO tenants(id, name, currency, tz_offset_min, created_at, slug, plan, status, trial_ends_at, trade_licence_no, orn) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      tenantId, company, 'AED', 240, at, slug, plan, status, trialEnds, trade_licence_no, orn);
    await db.run('INSERT INTO teams(id, tenant_id, name, created_at) VALUES (?,?,?,?)', teamId, tenantId, 'Sales', at);
    await db.run(`INSERT INTO users(id, tenant_id, team_id, name, email, password_hash, role, title, color, created_at) VALUES (?,?,?,?,?,?, 'admin', 'Administrator', '#6250d6', ?)`,
      userId, tenantId, null, name, email, hashPassword(password), at);
    for (const [cname, kind, team, topic] of [['general', 'public', null, 'Company-wide updates and wins'], ['sales', 'team', teamId, 'Team Sales']]) {
      const cid = uuidv7();
      await db.run('INSERT INTO channels(id, tenant_id, name, kind, team_id, topic, created_at) VALUES (?,?,?,?,?,?,?)', cid, tenantId, cname, kind, team, topic, at);
      await db.run('INSERT INTO channel_members(channel_id, user_id) VALUES (?,?)', cid, userId);
    }
    await db.run('INSERT INTO announcements(id, tenant_id, author_id, title, body, pinned, created_at) VALUES (?,?,?,?,?,?,?)', uuidv7(), tenantId, userId,
      'Welcome to Dara', 'Start under People & teams: add your team leads and agents, then add projects and listings. Every member gets their own dashboard.', 1, at);
  });
  return { tenantId, userId, slug };
}

export function registerSaas(router, ctx) {
  const { db } = ctx;
  const signupThrottle = new LoginThrottle(ctx.cfg.signupsPerHour ?? 5, 60 * 60_000);

  /* ---------- Self-signup (public) ---------- */
  router.post('/api/signup', async (req) => {
    signupThrottle.check(req.ip, 'signup');
    const v = validator(req.body).str('company', { required: true, max: 120, min: 2 }).str('name', { required: true, max: 80 }).str('email', { required: true, max: 160 })
      .str('password', { required: true, max: 200 }).str('trade_licence_no', { max: 60 }).str('orn', { max: 40 }).bool('accept_terms').done();
    if (!EMAIL.test(v.email)) throw badRequest('Email address looks wrong.', { email: 'is not a valid email' });
    if (!passwordPolicy(v.password)) throw badRequest('Use at least 10 characters with letters and numbers.', { password: 'is too weak' });
    if (!v.accept_terms) throw badRequest('Accept the terms to create a workspace.', { accept_terms: 'is required' });
    if (await db.get('SELECT id FROM users WHERE lower(email) = lower(?)', v.email)) throw conflict('EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.', { email: 'already registered' });
    signupThrottle.fail(req.ip, 'signup');
    const { tenantId, userId } = await createWorkspace(db, v);
    const s = await createSession(db, userId, ctx.cfg.sessionTtlHours);
    const user = await db.get('SELECT * FROM users WHERE id = ?', userId);
    await audit(ctx, user, 'tenant.created', 'tenant', tenantId, { plan: 'trial' });
    for (const p of await db.all(`SELECT u.id FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE t.is_platform = 1 AND u.platform_admin = 1`)) {
      await notify(ctx, p.id, { type: 'tenant_signup', title: `New brokerage signed up: ${v.company}`, link: '#/platform', dedupeKey: `signup:${tenantId}` });
    }
    const tenant = await db.get('SELECT * FROM tenants WHERE id = ?', tenantId);
    const dev_verification_url = await sendVerification(ctx, user);
    return respond(201, { user: publicUser(user, tenant), tenant_id: tenantId, verification_sent: true, ...(dev_verification_url ? { dev_verification_url } : {}) }, { 'Set-Cookie': cookieHeader(s.token, s.expires, ctx.cfg.secureCookies) });
  }, { public: true });

  router.get('/api/plans', () => ({ trial_days: TRIAL_DAYS, plans: Object.entries(PLANS).map(([code, p]) => ({ code, ...p })), pricing: 'Proposed — unvalidated. Prices to be confirmed.' }), { public: true });

  /* ---------- Workspace (tenant) settings ---------- */
  const workspaceView = async (t) => ({
    id: t.id, name: t.name, slug: t.slug, trade_licence_no: t.trade_licence_no, trade_licence_expiry: t.trade_licence_expiry, orn: t.orn,
    created_at: t.created_at, subscription: await planSummary(db, t),
    policies: { mfa_required_admins: !!t.mfa_required_admins, block_expired_brn: !!t.policy_block_expired_brn, block_expired_permit: !!t.policy_block_expired_permit },
  });
  router.get('/api/workspace', async (req) => ({ item: await workspaceView(req.tenant) }));

  router.patch('/api/workspace', async (req) => {
    requireScope(req.user, 'workspace.manage');
    const v = validator(req.body).str('name', { max: 120, min: 2 }).str('trade_licence_no', { max: 60 }).date('trade_licence_expiry').str('orn', { max: 40 })
      .bool('mfa_required_admins').bool('policy_block_expired_brn').bool('policy_block_expired_permit').done();
    const policyKeys = ['mfa_required_admins', 'policy_block_expired_brn', 'policy_block_expired_permit'];
    if (policyKeys.some((k) => v[k] !== undefined) && req.user.role !== 'admin') throw forbidden('Only administrators can change security and compliance policies.');
    for (const k of policyKeys) if (v[k] !== undefined) v[k] = v[k] ? 1 : 0;
    const sets = Object.keys(v).map((k) => `${k} = ?`);
    if (sets.length) await db.run(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`, ...Object.values(v), req.tenant.id);
    await audit(ctx, req.user, 'tenant.updated', 'tenant', req.tenant.id, v);
    return { item: await workspaceView(await db.get('SELECT * FROM tenants WHERE id = ?', req.tenant.id)) };
  });

  /* ---------- Data export: never plan-gated, allowed when read-only (Part F2/F3) ---------- */
  router.get('/api/export', async (req, _ctx, res) => {
    requireScope(req.user, 'data.export');
    const tid = req.tenant.id;
    const q = (sql) => db.all(sql, tid);
    const data = {
      exported_at: nowIso(), format: 'dara-export/v1', tenant: await workspaceView(req.tenant),
      users: await q('SELECT id, team_id, name, email, role, title, phone, active, brn, brn_expiry, created_at FROM users WHERE tenant_id = ?'),
      teams: await q('SELECT * FROM teams WHERE tenant_id = ?'), contacts: await q('SELECT * FROM contacts WHERE tenant_id = ?'), leads: await q('SELECT * FROM leads WHERE tenant_id = ?'),
      projects: await q('SELECT * FROM projects WHERE tenant_id = ?'), properties: await q('SELECT * FROM properties WHERE tenant_id = ?'), deals: await q('SELECT * FROM deals WHERE tenant_id = ?'),
      reservations: await q('SELECT * FROM reservations WHERE tenant_id = ?'), tasks: await q('SELECT * FROM tasks WHERE tenant_id = ?'), events: await q('SELECT * FROM events WHERE tenant_id = ?'),
      activities: await q('SELECT * FROM activities WHERE tenant_id = ?'), announcements: await q('SELECT * FROM announcements WHERE tenant_id = ?'),
      messages: await q('SELECT m.* FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.tenant_id = ?'), audit_log: await q('SELECT * FROM audit_log WHERE tenant_id = ?'),
    };
    await audit(ctx, req.user, 'tenant.exported', 'tenant', tid, { rows: Object.values(data).filter(Array.isArray).reduce((s, a) => s + a.length, 0) });
    const body = JSON.stringify(data, null, 2);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="dara-export-${req.tenant.slug || 'workspace'}-${nowIso().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' });
    res.end(body);
    return undefined;
  });

  /* ---------- Platform console (Dara staff only) ---------- */
  const requirePlatform = (req) => {
    if (!req.user.platform_admin || !req.tenant?.is_platform) throw forbidden('Platform console is for Dara staff only.');
  };
  router.get('/api/platform/tenants', async (req) => {
    requirePlatform(req);
    const rows = await db.all('SELECT * FROM tenants WHERE is_platform = 0 ORDER BY created_at DESC');
    return {
      plans: Object.entries(PLANS).map(([code, p]) => ({ code, ...p })), statuses: STATUSES,
      items: await Promise.all(rows.map(async (t) => ({
        id: t.id, name: t.name, slug: t.slug, created_at: t.created_at, orn: t.orn, ...(await planSummary(db, t)),
        admins: await db.all(`SELECT name, email FROM users WHERE tenant_id = ? AND role = 'admin' AND active = 1`, t.id),
        last_active: (await db.get('SELECT MAX(last_seen_at) m FROM users WHERE tenant_id = ?', t.id)).m,
        deals_won: (await db.get(`SELECT COUNT(*) n FROM deals WHERE tenant_id = ? AND stage = 'won'`, t.id)).n,
      }))),
    };
  }, { system: true }); // platform staff only (requirePlatform runs first); cross-tenant by design, aggregates only

  router.patch('/api/platform/tenants/:id', async (req) => {
    requirePlatform(req);
    const t = await db.get('SELECT * FROM tenants WHERE id = ? AND is_platform = 0', req.params.id);
    if (!t) throw notFound('Workspace');
    const v = validator(req.body).oneOf('plan', Object.keys(PLANS)).oneOf('status', STATUSES).date('trial_ends_at').str('reason', { required: true, max: 300 }).done();
    // F3: downgrades never delete data; going over a limit blocks new additions only.
    const sets = []; const params = [];
    for (const k of ['plan', 'status', 'trial_ends_at']) if (v[k] !== undefined) { sets.push(`${k} = ?`); params.push(v[k]); }
    if (!sets.length) throw badRequest('Nothing to change.');
    await db.run(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`, ...params, t.id);
    const after = await db.get('SELECT * FROM tenants WHERE id = ?', t.id);
    // Visible to the tenant: logged in their audit trail and notified to their admins.
    await audit({ ...ctx, tenantId: t.id }, { id: req.user.id, tenant_id: t.id }, 'tenant.subscription_changed', 'tenant', t.id, { ...v, by: req.user.name });
    for (const a of await db.all(`SELECT id FROM users WHERE tenant_id = ? AND role = 'admin' AND active = 1`, t.id)) {
      await notify(ctx, a.id, { type: 'subscription', title: `Your subscription changed: ${PLANS[after.plan].name} · ${after.status.replace('_', ' ')}`, body: v.reason, link: '#/workspace', dedupeKey: `sub:${t.id}:${nowIso()}` });
    }
    return { item: { id: after.id, name: after.name, ...(await planSummary(db, after)) } };
  }, { system: true }); // platform staff only (requirePlatform runs first); cross-tenant by design, aggregates only

  router.get('/api/platform/summary', async (req) => {
    requirePlatform(req);
    const rows = await db.all('SELECT * FROM tenants WHERE is_platform = 0');
    const by = (k) => rows.reduce((m, t) => ({ ...m, [t[k]]: (m[t[k]] || 0) + 1 }), {});
    return { workspaces: rows.length, by_status: by('status'), by_plan: by('plan'), seats: (await Promise.all(rows.map((t) => usage(db, t.id)))).reduce((s, u) => s + u.seats, 0),
      read_only: rows.filter((t) => accessMode(t) === 'read_only').length };
  }, { system: true }); // platform staff only (requirePlatform runs first); cross-tenant by design, aggregates only
}
