// Sign-in (with two-step verification), sign-out, current user, password change & reset, email verification.
import { randomBytes } from 'node:crypto';
import { respond, HttpError, badRequest, forbidden } from '../http.js';
import { tokenHash, verifyPassword, hashPassword, createSession, destroySession, cookieHeader, clearCookieHeader, SESSION_COOKIE, passwordPolicy, LoginThrottle } from '../auth.js';
import { validator } from '../validate.js';
import { audit } from '../services/notify.js';
import { MATRIX } from '../rbac.js';
import { accessMode } from '../services/billing.js';
import { uuidv7, nowIso, json } from '../db.js';
import { generateSecret, verifyTotp, otpauthUri, generateRecoveryCodes, consumeRecoveryCode } from '../services/totp.js';
import { encrypt, decrypt } from '../services/secrets.js';

/** Two-step sign-in is required for administrators (and platform staff) when the workspace policy says so (C13). */
export const mfaRequired = (u, t) => !!(t?.mfa_required_admins && (u.role === 'admin' || u.platform_admin));
export const mfaSetupPending = (u, t) => mfaRequired(u, t) && !u.mfa_enabled;

export const publicUser = (u, t = null) => u && ({
  id: u.id, name: u.name, email: u.email, role: u.role, title: u.title, phone: u.phone, team_id: u.team_id,
  color: u.color, locale: u.locale, active: !!u.active, last_seen_at: u.last_seen_at, must_change_password: !!u.must_change_password,
  platform_admin: !!u.platform_admin, brn: u.brn ?? null, brn_expiry: u.brn_expiry ?? null,
  email_verified: !!u.email_verified_at, mfa_enabled: !!u.mfa_enabled, ...(t ? { mfa_required: mfaRequired(u, t), mfa_setup_required: mfaSetupPending(u, t) } : {}),
});

/* ---------- One-time tokens (stored as SHA-256 hashes) ---------- */
export async function createToken(db, userId, purpose, minutes) {
  const raw = randomBytes(32).toString('base64url');
  await db.run(`UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL`, nowIso(), userId, purpose); // one live token per purpose
  await db.run('INSERT INTO auth_tokens(id, user_id, purpose, token_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)',
    uuidv7(), userId, purpose, tokenHash(raw), new Date(Date.now() + minutes * 60000).toISOString(), nowIso());
  return raw;
}
async function takeToken(db, raw, purpose, { consume = true } = {}) {
  if (!raw) return null;
  const t = await db.get('SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ?', tokenHash(raw), purpose);
  if (!t || t.used_at || t.expires_at < nowIso()) return null;
  if (consume) { const r = await db.run('UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL', nowIso(), t.id); if (!r.changes) return null; }
  return t;
}

export async function sendVerification(ctx, user) {
  const raw = await createToken(ctx.db, user.id, 'verify_email', 48 * 60);
  const url = `${ctx.cfg.publicUrl}/api/auth/verify-email?token=${raw}`;
  await ctx.cfg.mailer.send({ to: user.email, subject: 'Confirm your email for Dara', text: `Hi ${user.name},\n\nConfirm your email address to finish setting up your Dara workspace:\n${url}\n\nThis link expires in 48 hours. If you didn’t sign up, ignore this email.` });
  return ctx.cfg.devLinks ? url : undefined;
}

export function registerAuth(router, ctx) {
  const { db } = ctx;
  const mfaThrottle = new LoginThrottle(6, 10 * 60_000);

  async function startSession(req, u) {
    const s = await createSession(db, u.id, ctx.cfg.sessionTtlHours);
    await audit(ctx, u, 'auth.login', 'user', u.id);
    const t = await db.get('SELECT * FROM tenants WHERE id = ?', u.tenant_id);
    return respond(200, { user: publicUser(u, t) }, { 'Set-Cookie': cookieHeader(s.token, s.expires, ctx.cfg.secureCookies) });
  }

  router.post('/api/auth/login', async (req) => {
    const { email, password } = validator(req.body).str('email', { required: true, max: 200 }).str('password', { required: true, max: 200 }).done();
    ctx.throttle.check(req.ip, email);
    const u = await db.get('SELECT * FROM users WHERE lower(email) = lower(?)', email);
    if (!u || !verifyPassword(password, u.password_hash)) {
      ctx.throttle.fail(req.ip, email);
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'That email and password don’t match an account.');
    }
    if (!u.active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account is deactivated. Ask your administrator to reactivate it.');
    ctx.throttle.reset(req.ip, email);
    if (u.mfa_enabled) {
      // Step 2 required: no session yet. The challenge is single-use and short-lived.
      const challenge = await createToken(db, u.id, 'mfa_challenge', 5);
      return { mfa_required: true, challenge };
    }
    return startSession(req, u);
  }, { public: true, system: true, allowReadOnly: true });

  router.post('/api/auth/mfa/verify', async (req) => {
    const { challenge, code } = validator(req.body).str('challenge', { required: true, max: 200 }).str('code', { required: true, max: 20 }).done();
    mfaThrottle.check(req.ip, challenge);
    const t = await takeToken(db, challenge, 'mfa_challenge', { consume: false });
    if (!t) throw new HttpError(401, 'CHALLENGE_EXPIRED', 'This sign-in attempt expired. Enter your email and password again.');
    const u = await db.get('SELECT * FROM users WHERE id = ?', t.user_id);
    const secret = u.mfa_secret_enc ? decrypt(u.mfa_secret_enc) : null;
    const ctr = secret ? verifyTotp(secret, code, { lastCounter: Number(u.mfa_last_counter) }) : null;
    let usedRecovery = false;
    if (ctr != null) await db.run('UPDATE users SET mfa_last_counter = ? WHERE id = ?', ctr, u.id);
    else {
      const left = consumeRecoveryCode(json.parse(u.mfa_recovery, []), code);
      if (!left) { mfaThrottle.fail(req.ip, challenge); throw new HttpError(401, 'INVALID_CODE', 'That code isn’t right. Use the current code from your authenticator app, or a recovery code.'); }
      await db.run('UPDATE users SET mfa_recovery = ? WHERE id = ?', JSON.stringify(left), u.id);
      usedRecovery = true;
      await audit(ctx, u, 'auth.recovery_code_used', 'user', u.id, { remaining: left.length });
    }
    await db.run('UPDATE auth_tokens SET used_at = ? WHERE id = ?', nowIso(), t.id);
    mfaThrottle.reset(req.ip, challenge);
    const r = await startSession(req, u);
    if (usedRecovery) r.body.recovery_codes_left = json.parse((await db.get('SELECT mfa_recovery FROM users WHERE id = ?', u.id)).mfa_recovery, []).length;
    return r;
  }, { public: true, system: true, allowReadOnly: true });

  router.post('/api/auth/logout', async (req) => {
    await destroySession(db, req.cookies[SESSION_COOKIE]);
    return respond(200, { ok: true }, { 'Set-Cookie': clearCookieHeader() });
  }, { public: true, allowReadOnly: true });

  // Public: lets the landing page detect an existing session without a 401.
  router.get('/api/auth/session', async (req) => ({ user: req.user ? publicUser(req.user, req.tenant) : null }), { public: true });

  router.get('/api/auth/me', async (req) => {
    const team = req.user.team_id ? await db.get('SELECT id, name, lead_id FROM teams WHERE id = ?', req.user.team_id) : null;
    const t = req.tenant;
    const tenant = { id: t.id, name: t.name, currency: t.currency, tz_offset_min: t.tz_offset_min, plan: t.plan, status: t.status, trial_ends_at: t.trial_ends_at, is_platform: !!t.is_platform, access: accessMode(t),
      mfa_required_admins: !!t.mfa_required_admins, policy_block_expired_brn: !!t.policy_block_expired_brn, policy_block_expired_permit: !!t.policy_block_expired_permit };
    const permissions = Object.fromEntries(Object.entries(MATRIX).map(([k, v]) => [k, v[req.user.role]]));
    return { user: publicUser(req.user, t), team, tenant, permissions };
  });

  router.post('/api/auth/password', async (req) => {
    const { current, next } = validator(req.body).str('current', { required: true }).str('next', { required: true, max: 200 }).done();
    if (!verifyPassword(current, req.user.password_hash)) throw badRequest('Current password is incorrect.', { current: 'is incorrect' });
    if (!passwordPolicy(next)) throw badRequest('Use at least 10 characters with letters and numbers.', { next: 'is too weak' });
    await db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(next), req.user.id);
    await db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', req.user.id, tokenHash(req.cookies[SESSION_COOKIE]));
    await audit(ctx, req.user, 'auth.password_changed', 'user', req.user.id);
    return { ok: true };
  }, { allowReadOnly: true });

  router.patch('/api/auth/me', async (req) => {
    const v = validator(req.body).oneOf('locale', ['en', 'ar']).str('phone', { max: 40 }).str('title', { max: 80 }).done();
    for (const k of Object.keys(v)) await db.run(`UPDATE users SET ${k} = ? WHERE id = ?`, v[k], req.user.id);
    return { user: publicUser(await db.get('SELECT * FROM users WHERE id = ?', req.user.id), req.tenant) };
  }, { allowReadOnly: true });

  /* ---------- Two-step sign-in management ---------- */
  router.post('/api/auth/mfa/setup', async (req) => {
    if (req.user.mfa_enabled) throw new HttpError(409, 'MFA_ALREADY_ON', 'Two-step sign-in is already on. Turn it off first to switch devices.');
    const secret = generateSecret();
    await db.run('UPDATE users SET mfa_secret_enc = ?, mfa_last_counter = -1 WHERE id = ?', encrypt(secret), req.user.id);
    return { secret, otpauth_uri: otpauthUri(secret, req.user.email) };
  }, { allowReadOnly: true });

  router.post('/api/auth/mfa/enable', async (req) => {
    const { code } = validator(req.body).str('code', { required: true, max: 10 }).done();
    const u = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (u.mfa_enabled) throw new HttpError(409, 'MFA_ALREADY_ON', 'Two-step sign-in is already on.');
    if (!u.mfa_secret_enc) throw badRequest('Start setup first.');
    const ctr = verifyTotp(decrypt(u.mfa_secret_enc), code);
    if (ctr == null) throw badRequest('That code isn’t right. Check your phone’s time is set automatically, then try the newest code.', { code: 'is incorrect' });
    const { codes, hashes } = generateRecoveryCodes();
    await db.run('UPDATE users SET mfa_enabled = 1, mfa_last_counter = ?, mfa_recovery = ? WHERE id = ?', ctr, JSON.stringify(hashes), u.id);
    await audit(ctx, req.user, 'auth.mfa_enabled', 'user', u.id);
    return { recovery_codes: codes };
  }, { allowReadOnly: true });

  router.post('/api/auth/mfa/disable', async (req) => {
    const { password } = validator(req.body).str('password', { required: true, max: 200 }).done();
    if (mfaRequired(req.user, req.tenant)) throw forbidden('Your workspace requires two-step sign-in for administrators.');
    if (!verifyPassword(password, req.user.password_hash)) throw badRequest('Password is incorrect.', { password: 'is incorrect' });
    await db.run('UPDATE users SET mfa_enabled = 0, mfa_secret_enc = NULL, mfa_recovery = NULL, mfa_last_counter = -1 WHERE id = ?', req.user.id);
    await audit(ctx, req.user, 'auth.mfa_disabled', 'user', req.user.id);
    return { ok: true };
  }, { allowReadOnly: true });

  router.post('/api/auth/mfa/recovery-codes', async (req) => {
    const { code } = validator(req.body).str('code', { required: true, max: 10 }).done();
    const u = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!u.mfa_enabled) throw badRequest('Turn on two-step sign-in first.');
    const ctr = verifyTotp(decrypt(u.mfa_secret_enc), code, { lastCounter: Number(u.mfa_last_counter) });
    if (ctr == null) throw badRequest('That code isn’t right.', { code: 'is incorrect' });
    const { codes, hashes } = generateRecoveryCodes();
    await db.run('UPDATE users SET mfa_recovery = ?, mfa_last_counter = ? WHERE id = ?', JSON.stringify(hashes), ctr, u.id);
    await audit(ctx, req.user, 'auth.recovery_codes_regenerated', 'user', u.id);
    return { recovery_codes: codes };
  }, { allowReadOnly: true });

  /* ---------- Email verification ---------- */
  router.get('/api/auth/verify-email', async (req, _ctx, res) => {
    const t = await takeToken(db, req.query.token, 'verify_email');
    if (t) {
      await db.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', nowIso(), t.user_id);
      const u = await db.get('SELECT * FROM users WHERE id = ?', t.user_id);
      await audit(ctx, u, 'auth.email_verified', 'user', u.id);
    }
    res.writeHead(302, { Location: t ? '/app#/home?verified=1' : '/?verify=invalid#signin' });
    res.end();
    return undefined;
  }, { public: true, system: true });

  router.post('/api/auth/resend-verification', async (req) => {
    if (req.user.email_verified_at) return { ok: true, already_verified: true };
    const dev_url = await sendVerification(ctx, req.user);
    return { ok: true, dev_url };
  }, { allowReadOnly: true });

  /* ---------- Password reset (always answers the same way, so it can't reveal which emails exist) ---------- */
  const forgotThrottle = new LoginThrottle(5, 60 * 60_000);
  router.post('/api/auth/forgot', async (req) => {
    const { email } = validator(req.body).str('email', { required: true, max: 200 }).done();
    forgotThrottle.check(req.ip, email); forgotThrottle.fail(req.ip, email);
    const u = await db.get('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1', email);
    let dev_url;
    if (u) {
      const raw = await createToken(db, u.id, 'reset_password', 60);
      const url = `${ctx.cfg.publicUrl}/#reset=${raw}`;
      await ctx.cfg.mailer.send({ to: u.email, subject: 'Reset your Dara password', text: `Hi ${u.name},\n\nUse this link within 1 hour to choose a new password:\n${url}\n\nIf you didn’t ask for this, you can ignore this email — your password hasn’t changed.` });
      await audit(ctx, u, 'auth.reset_requested', 'user', u.id);
      if (ctx.cfg.devResetLinks ?? ctx.cfg.devLinks) dev_url = url; // never on a public server: it would let anyone reset any account
    }
    return { ok: true, message: 'If that email has an account, a reset link is on its way.', ...(dev_url ? { dev_url } : {}) };
  }, { public: true, system: true, allowReadOnly: true });

  router.post('/api/auth/reset', async (req) => {
    const { token, password } = validator(req.body).str('token', { required: true, max: 200 }).str('password', { required: true, max: 200 }).done();
    if (!passwordPolicy(password)) throw badRequest('Use at least 10 characters with letters and numbers.', { password: 'is too weak' });
    const t = await takeToken(db, token, 'reset_password');
    if (!t) throw new HttpError(400, 'RESET_LINK_INVALID', 'This reset link has expired or was already used. Ask for a new one.');
    await db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(password), t.user_id);
    await db.run('DELETE FROM sessions WHERE user_id = ?', t.user_id); // sign out everywhere
    const u = await db.get('SELECT * FROM users WHERE id = ?', t.user_id);
    await audit(ctx, u, 'auth.password_reset', 'user', u.id);
    return { ok: true };
  }, { public: true, system: true, allowReadOnly: true });
}
