// Sign-in, sign-out, current user, password change, own preferences.
import { respond, HttpError, badRequest } from '../http.js';
import { tokenHash, verifyPassword, hashPassword, createSession, destroySession, cookieHeader, clearCookieHeader, SESSION_COOKIE, passwordPolicy } from '../auth.js';
import { validator } from '../validate.js';
import { audit } from '../services/notify.js';
import { MATRIX } from '../rbac.js';
import { accessMode } from '../services/billing.js';

export const publicUser = (u) => u && ({
  id: u.id, name: u.name, email: u.email, role: u.role, title: u.title, phone: u.phone, team_id: u.team_id,
  color: u.color, locale: u.locale, active: !!u.active, last_seen_at: u.last_seen_at, must_change_password: !!u.must_change_password,
  platform_admin: !!u.platform_admin, brn: u.brn ?? null, brn_expiry: u.brn_expiry ?? null,
});

export function registerAuth(router, ctx) {
  const { db } = ctx;

  router.post('/api/auth/login', (req) => {
    const { email, password } = validator(req.body).str('email', { required: true, max: 200 }).str('password', { required: true, max: 200 }).done();
    ctx.throttle.check(req.ip, email);
    const u = db.get('SELECT * FROM users WHERE lower(email) = lower(?)', email);
    if (!u || !verifyPassword(password, u.password_hash)) {
      ctx.throttle.fail(req.ip, email);
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'That email and password don’t match an account.');
    }
    if (!u.active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account is deactivated. Ask your administrator to reactivate it.');
    ctx.throttle.reset(req.ip, email);
    const s = createSession(db, u.id, ctx.cfg.sessionTtlHours);
    audit(ctx, u, 'auth.login', 'user', u.id);
    return respond(200, { user: publicUser(u) }, { 'Set-Cookie': cookieHeader(s.token, s.expires, ctx.cfg.secureCookies) });
  }, { public: true, allowReadOnly: true });

  router.post('/api/auth/logout', (req) => {
    destroySession(db, req.cookies[SESSION_COOKIE]);
    return respond(200, { ok: true }, { 'Set-Cookie': clearCookieHeader() });
  }, { public: true, allowReadOnly: true });

  // Public: lets the landing page detect an existing session without a 401.
  router.get('/api/auth/session', (req) => ({ user: req.user ? publicUser(req.user) : null }), { public: true });

  router.get('/api/auth/me', (req) => {
    const team = req.user.team_id ? db.get('SELECT id, name, lead_id FROM teams WHERE id = ?', req.user.team_id) : null;
    const t = req.tenant;
    const tenant = { id: t.id, name: t.name, currency: t.currency, tz_offset_min: t.tz_offset_min, plan: t.plan, status: t.status, trial_ends_at: t.trial_ends_at, is_platform: !!t.is_platform, access: accessMode(t) };
    const permissions = Object.fromEntries(Object.entries(MATRIX).map(([k, v]) => [k, v[req.user.role]]));
    return { user: publicUser(req.user), team, tenant, permissions };
  });

  router.post('/api/auth/password', (req) => {
    const { current, next } = validator(req.body).str('current', { required: true }).str('next', { required: true, max: 200 }).done();
    if (!verifyPassword(current, req.user.password_hash)) throw badRequest('Current password is incorrect.', { current: 'is incorrect' });
    if (!passwordPolicy(next)) throw badRequest('Use at least 10 characters with letters and numbers.', { next: 'is too weak' });
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(next), req.user.id);
    // Sign out other sessions.
    db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', req.user.id, tokenHash(req.cookies[SESSION_COOKIE]));
    audit(ctx, req.user, 'auth.password_changed', 'user', req.user.id);
    return { ok: true };
  }, { allowReadOnly: true });

  router.patch('/api/auth/me', (req) => {
    const v = validator(req.body).oneOf('locale', ['en', 'ar']).str('phone', { max: 40 }).str('title', { max: 80 }).done();
    for (const k of Object.keys(v)) db.run(`UPDATE users SET ${k} = ? WHERE id = ?`, v[k], req.user.id);
    return { user: publicUser(db.get('SELECT * FROM users WHERE id = ?', req.user.id)) };
  });
}
