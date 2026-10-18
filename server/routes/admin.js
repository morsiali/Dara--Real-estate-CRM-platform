// Administration: people directory, user management, teams, announcements, audit log, permission matrix.
import { notFound, forbidden, conflict, badRequest, respond, HttpError } from '../http.js';
import { uuidv7, nowIso } from '../db.js';
import { validator } from '../validate.js';
import { requireScope, isManagement, ROLES, MATRIX } from '../rbac.js';
import { hashPassword, passwordPolicy } from '../auth.js';
import { notify, audit } from '../services/notify.js';
import { publicUser } from './auth.js';
import { checkLimit } from '../services/billing.js';

const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#e87ba4', '#008300', '#eda100', '#e34948'];

export function registerAdmin(router, ctx) {
  const { db, hub } = ctx;

  router.get('/api/users', async (req) => {
    const rows = await db.all(`SELECT u.*, t.name team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.tenant_id = ? ORDER BY u.active DESC, u.name`, req.user.tenant_id);
    const online = new Set(hub.online());
    return { items: rows.map((u) => ({ ...publicUser(u), team_name: u.team_name, online: online.has(u.id) })) };
  });

  const canManageTarget = (actor, targetRole) => actor.role === 'admin' || (actor.role === 'manager' && ['agent', 'team_lead'].includes(targetRole));

  router.post('/api/users', async (req) => {
    requireScope(req.user, 'users.manage');
    if (!req.user.email_verified_at) throw new HttpError(403, 'EMAIL_UNVERIFIED', 'Confirm your email address before inviting people. Check your inbox or resend the link from the banner.');
    const v = validator(req.body).str('name', { required: true, max: 80 }).str('email', { required: true, max: 160 }).oneOf('role', ROLES, { required: true })
      .str('team_id').str('title', { max: 80 }).str('phone', { max: 40 }).str('password', { required: true, max: 200 }).str('brn', { max: 40 }).date('brn_expiry').done();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) throw badRequest('Email address looks wrong.', { email: 'invalid' });
    if (!canManageTarget(req.user, v.role)) throw forbidden('Managers can add agents and team leads. Ask an administrator for other roles.');
    if (!passwordPolicy(v.password)) throw badRequest('Use at least 10 characters with letters and numbers.', { password: 'too weak' });
    if (v.team_id && !await db.get('SELECT id FROM teams WHERE id = ? AND tenant_id = ?', v.team_id, req.user.tenant_id)) throw badRequest('Team not found.', { team_id: 'not found' });
    // Emails are unique across all workspaces; the check must see every tenant, so it lifts RLS for this one read.
    if (await db.asSystem(() => db.get('SELECT id FROM users WHERE lower(email) = lower(?)', v.email))) throw conflict('EMAIL_TAKEN', 'An account with that email already exists.', { email: 'taken' });
    await checkLimit(db, req.tenant, 'seats');
    const id = uuidv7(); const count = (await db.get('SELECT COUNT(*) n FROM users WHERE tenant_id = ?', req.user.tenant_id)).n;
    try {
      await db.tx(async () => {
        await db.run(`INSERT INTO users(id, tenant_id, team_id, name, email, password_hash, role, title, phone, color, must_change_password, created_at, brn, brn_expiry) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
          id, req.user.tenant_id, v.team_id ?? null, v.name, v.email, hashPassword(v.password), v.role, v.title ?? null, v.phone ?? null, COLORS[count % COLORS.length], nowIso(), v.brn ?? null, v.brn_expiry ?? null);
        for (const c of await db.all(`SELECT id FROM channels WHERE tenant_id = ? AND (kind = 'public' OR (kind = 'team' AND team_id = ?))`, req.user.tenant_id, v.team_id ?? '')) await db.run('INSERT INTO channel_members(channel_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING', c.id, id);
        await audit(ctx, req.user, 'user.created', 'user', id, { role: v.role, team_id: v.team_id });
      });
    } catch (e) { if (db.isUniqueViolation(e)) throw conflict('EMAIL_TAKEN', 'An account with that email already exists.', { email: 'taken' }); throw e; }
    return respond(201, { item: publicUser(await db.get('SELECT * FROM users WHERE id = ?', id)) });
  });

  router.patch('/api/users/:id', async (req) => {
    requireScope(req.user, 'users.manage');
    const target = await db.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', req.params.id, req.user.tenant_id);
    if (!target) throw notFound('User');
    const v = validator(req.body).oneOf('role', ROLES).str('team_id').str('title', { max: 80 }).str('phone', { max: 40 }).bool('active').str('password', { max: 200 })
      .str('brn', { max: 40 }).date('brn_expiry').bool('reset_mfa').done();
    if (v.reset_mfa && req.user.role !== 'admin') throw forbidden('Only administrators can reset two-step sign-in.');
    if (v.reset_mfa && target.id === req.user.id) throw conflict('SELF_MFA_RESET', 'Use your own account menu to change your two-step sign-in.');
    if (v.active === true && !target.active) await checkLimit(db, req.tenant, 'seats');
    if (!canManageTarget(req.user, target.role) || (v.role && !canManageTarget(req.user, v.role))) throw forbidden('You can’t change this account.');
    if (target.id === req.user.id && (v.active === false || (v.role && v.role !== target.role))) throw conflict('SELF_LOCKOUT', 'You can’t deactivate yourself or change your own role.');
    if (v.password !== undefined && !passwordPolicy(v.password)) throw badRequest('Use at least 10 characters with letters and numbers.', { password: 'too weak' });
    if (v.team_id && !await db.get('SELECT id FROM teams WHERE id = ? AND tenant_id = ?', v.team_id, req.user.tenant_id)) throw badRequest('Team not found.', { team_id: 'not found' });
    await db.tx(async () => {
      if (v.role) await db.run('UPDATE users SET role = ? WHERE id = ?', v.role, target.id);
      if (v.team_id !== undefined) await db.run('UPDATE users SET team_id = ? WHERE id = ?', v.team_id || null, target.id);
      if (v.title !== undefined) await db.run('UPDATE users SET title = ? WHERE id = ?', v.title, target.id);
      if (v.phone !== undefined) await db.run('UPDATE users SET phone = ? WHERE id = ?', v.phone, target.id);
      if (v.brn !== undefined) await db.run('UPDATE users SET brn = ? WHERE id = ?', v.brn, target.id);
      if (v.brn_expiry !== undefined) await db.run('UPDATE users SET brn_expiry = ? WHERE id = ?', v.brn_expiry, target.id);
      if (v.active !== undefined) { await db.run('UPDATE users SET active = ? WHERE id = ?', v.active ? 1 : 0, target.id); if (!v.active) await db.run('DELETE FROM sessions WHERE user_id = ?', target.id); }
      if (v.reset_mfa) { await db.run('UPDATE users SET mfa_enabled = 0, mfa_secret_enc = NULL, mfa_recovery = NULL, mfa_last_counter = -1 WHERE id = ?', target.id); await db.run('DELETE FROM sessions WHERE user_id = ?', target.id); }
      if (v.password) { await db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', hashPassword(v.password), target.id); await db.run('DELETE FROM sessions WHERE user_id = ?', target.id); }
      await audit(ctx, req.user, 'user.updated', 'user', target.id, { ...v, password: v.password ? '[reset]' : undefined });
    });
    return { item: publicUser(await db.get('SELECT * FROM users WHERE id = ?', target.id)) };
  });

  router.get('/api/teams', async (req) => {
    const rows = await db.all(`SELECT t.*, u.name lead_name, (SELECT COUNT(*) FROM users x WHERE x.team_id = t.id AND x.active = 1) members FROM teams t LEFT JOIN users u ON u.id = t.lead_id WHERE t.tenant_id = ? ORDER BY t.name`, req.user.tenant_id);
    return { items: rows };
  });

  router.post('/api/teams', async (req) => {
    requireScope(req.user, 'teams.manage');
    const v = validator(req.body).str('name', { required: true, max: 60 }).str('lead_id').done();
    if (v.lead_id && !await db.get('SELECT id FROM users WHERE id = ? AND tenant_id = ?', v.lead_id, req.user.tenant_id)) throw badRequest('Lead not found.', { lead_id: 'not found' });
    const id = uuidv7();
    await db.tx(async () => {
      await db.run('INSERT INTO teams(id, tenant_id, name, lead_id, created_at) VALUES (?,?,?,?,?)', id, req.user.tenant_id, v.name, v.lead_id ?? null, nowIso());
      if (v.lead_id) await db.run(`UPDATE users SET team_id = ?, role = CASE WHEN role = 'agent' THEN 'team_lead' ELSE role END WHERE id = ?`, id, v.lead_id);
      const ch = uuidv7();
      await db.run(`INSERT INTO channels(id, tenant_id, name, kind, team_id, topic, created_at) VALUES (?,?,?,'team',?,?,?)`, ch, req.user.tenant_id, v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), id, `Team ${v.name}`, nowIso());
      for (const m of await db.all(`SELECT id FROM users WHERE tenant_id = ? AND (team_id = ? OR role IN ('admin','manager'))`, req.user.tenant_id, id)) await db.run('INSERT INTO channel_members(channel_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING', ch, m.id);
      await audit(ctx, req.user, 'team.created', 'team', id, v);
    });
    return respond(201, { item: await db.get('SELECT * FROM teams WHERE id = ?', id) });
  });

  router.patch('/api/teams/:id', async (req) => {
    requireScope(req.user, 'teams.manage');
    const t = await db.get('SELECT * FROM teams WHERE id = ? AND tenant_id = ?', req.params.id, req.user.tenant_id);
    if (!t) throw notFound('Team');
    const v = validator(req.body).str('name', { max: 60 }).str('lead_id').done();
    if (v.lead_id && !await db.get('SELECT id FROM users WHERE id = ? AND tenant_id = ?', v.lead_id, req.user.tenant_id)) throw badRequest('Lead not found.', { lead_id: 'not found' });
    if (v.name) await db.run('UPDATE teams SET name = ? WHERE id = ?', v.name, t.id);
    if (v.lead_id) { await db.run('UPDATE teams SET lead_id = ? WHERE id = ?', v.lead_id, t.id); await db.run(`UPDATE users SET team_id = ?, role = CASE WHEN role = 'agent' THEN 'team_lead' ELSE role END WHERE id = ?`, t.id, v.lead_id); }
    await audit(ctx, req.user, 'team.updated', 'team', t.id, v);
    return { item: await db.get('SELECT * FROM teams WHERE id = ?', t.id) };
  });

  router.get('/api/announcements', async (req) => ({
    items: await db.all(`SELECT a.*, u.name author_name FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.tenant_id = ? ORDER BY a.pinned DESC, a.created_at DESC LIMIT 30`, req.user.tenant_id),
  }));

  router.post('/api/announcements', async (req) => {
    requireScope(req.user, 'announcements.create');
    const v = validator(req.body).str('title', { required: true, max: 120 }).str('body', { required: true, max: 2000 }).bool('pinned').done();
    const id = uuidv7();
    await db.run('INSERT INTO announcements(id, tenant_id, author_id, title, body, pinned, created_at) VALUES (?,?,?,?,?,?,?)', id, req.user.tenant_id, req.user.id, v.title, v.body, v.pinned ? 1 : 0, nowIso());
    for (const u of await db.all('SELECT id FROM users WHERE tenant_id = ? AND active = 1 AND id != ?', req.user.tenant_id, req.user.id)) {
      await notify(ctx, u.id, { type: 'announcement', title: `Announcement: ${v.title}`, body: v.body.slice(0, 140), link: '#/home', dedupeKey: `ann:${id}` });
    }
    await audit(ctx, req.user, 'announcement.created', 'announcement', id);
    return respond(201, { id });
  });

  router.delete('/api/announcements/:id', async (req) => {
    requireScope(req.user, 'announcements.create');
    const r = await db.run('DELETE FROM announcements WHERE id = ? AND tenant_id = ?', req.params.id, req.user.tenant_id);
    if (!r.changes) throw notFound('Announcement');
    await audit(ctx, req.user, 'announcement.deleted', 'announcement', req.params.id);
    return { ok: true };
  });

  router.get('/api/audit', async (req) => {
    requireScope(req.user, 'audit.read');
    const rows = await db.all(`SELECT a.*, u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.tenant_id = ? ${req.query.entity ? 'AND a.entity = ?' : ''} ORDER BY a.at DESC LIMIT 200`,
      req.user.tenant_id, ...(req.query.entity ? [req.query.entity] : []));
    return { items: rows };
  });

  router.get('/api/permissions', () => ({ roles: ROLES, matrix: MATRIX }));
}
