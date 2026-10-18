// Sign-in security: TOTP (RFC 6238), two-step sign-in flow, recovery codes, email verification, password reset,
// admin MFA reset, and the two workspace compliance policies. Runs on SQLite or PGlite (DB_BACKEND).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client, as, finishOnboarding, userByEmail } from './helpers.js';
import { base32Encode, hotp, totp, verifyTotp, generateRecoveryCodes, consumeRecoveryCode, otpauthUri } from '../server/services/totp.js';
import { encrypt, decrypt } from '../server/services/secrets.js';

let env;
before(async () => { env = await startApp(); });
after(async () => { await env.close(); });

const localPath = (url) => { const u = new URL(url); return u.pathname + u.search + u.hash; };

describe('TOTP primitives', () => {
  test('matches the RFC 6238 SHA-1 test vectors (8 digits)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']];
    for (const [t, code] of vectors) assert.equal(hotp(secret, Math.floor(t / 30), 8), code, `T=${t}`);
  });

  test('accepts ±1 step for clock drift, rejects further drift and replays', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 1_700_000_000_000;
    assert.notEqual(verifyTotp(secret, totp(secret, now - 30_000), { ms: now }), null);
    assert.notEqual(verifyTotp(secret, totp(secret, now + 30_000), { ms: now }), null);
    assert.equal(verifyTotp(secret, totp(secret, now - 90_000), { ms: now }), null);
    const ctr = verifyTotp(secret, totp(secret, now), { ms: now });
    assert.equal(verifyTotp(secret, totp(secret, now), { ms: now, lastCounter: ctr }), null, 'same code twice is refused');
    assert.equal(verifyTotp(secret, 'abcdef', { ms: now }), null);
  });

  test('recovery codes are single-use and stored only as hashes', () => {
    const { codes, hashes } = generateRecoveryCodes();
    assert.equal(codes.length, 8);
    assert.ok(hashes.every((h) => /^[0-9a-f]{64}$/.test(h) && !codes.includes(h)));
    const left = consumeRecoveryCode(hashes, codes[3].toUpperCase());
    assert.equal(left.length, 7);
    assert.equal(consumeRecoveryCode(left, codes[3]), null);
  });

  test('MFA secrets are encrypted at rest (AES-256-GCM) and tamper-evident', () => {
    const enc = encrypt('JBSWY3DPEHPK3PXP');
    assert.match(enc, /^v1:/);
    assert.ok(!enc.includes('JBSWY3DPEHPK3PXP'));
    assert.equal(decrypt(enc), 'JBSWY3DPEHPK3PXP');
    const parts = enc.split(':'); parts[3] = Buffer.from('x'.repeat(16)).toString('base64');
    assert.throws(() => decrypt(parts.join(':')));
    assert.match(otpauthUri('ABC', 'a@b.ae'), /^otpauth:\/\/totp\/Dara%3Aa%40b\.ae\?secret=ABC/);
  });
});

describe('two-step sign-in', () => {
  let secret; let recovery;
  test('a user turns it on; the secret is never stored in plain text', async () => {
    const c = await as(env.base, 'agent');
    const setup = await c.post('/auth/mfa/setup');
    assert.equal(setup.status, 200);
    secret = setup.data.secret;
    assert.match(setup.data.otpauth_uri, /^otpauth:\/\/totp\//);
    assert.equal((await c.post('/auth/mfa/enable', { code: '000000' })).status, 400);
    const on = await c.post('/auth/mfa/enable', { code: totp(secret) });
    assert.equal(on.status, 200);
    recovery = on.data.recovery_codes;
    assert.equal(recovery.length, 8);
    const row = await userByEmail(env.db, 'agent@dara.demo');
    assert.equal(Number(row.mfa_enabled), 1);
    assert.ok(!row.mfa_secret_enc.includes(secret));
    assert.ok(!row.mfa_recovery.includes(recovery[0]));
  });

  test('password alone no longer creates a session; the code does — once', async () => {
    const c = client(env.base);
    const step1 = await c.post('/auth/login', { email: 'agent@dara.demo', password: 'DaraDemo2026' });
    assert.equal(step1.status, 200);
    assert.equal(step1.data.mfa_required, true);
    assert.equal(c.cookie, '', 'no session cookie before the second step');
    assert.equal((await c.get('/auth/me')).status, 401);
    // The code used to enable is already spent (replay protection); the next step's code works.
    const next = totp(secret, Date.now() + 30_000);
    assert.equal((await c.post('/auth/mfa/verify', { challenge: step1.data.challenge, code: '123456' })).data.error.code, 'INVALID_CODE');
    const ok = await c.post('/auth/mfa/verify', { challenge: step1.data.challenge, code: next });
    assert.equal(ok.status, 200);
    assert.equal((await c.get('/auth/me')).data.user.email, 'agent@dara.demo');
    assert.equal((await c.post('/auth/mfa/verify', { challenge: step1.data.challenge, code: next })).data.error.code, 'CHALLENGE_EXPIRED', 'challenge is single-use');
    const again = client(env.base);
    const s2 = await again.post('/auth/login', { email: 'agent@dara.demo', password: 'DaraDemo2026' });
    assert.equal((await again.post('/auth/mfa/verify', { challenge: s2.data.challenge, code: next })).data.error.code, 'INVALID_CODE', 'a code cannot be replayed');
  });

  test('a recovery code signs in once and is then spent', async () => {
    const c = client(env.base);
    const s = await c.post('/auth/login', { email: 'agent@dara.demo', password: 'DaraDemo2026' });
    const r = await c.post('/auth/mfa/verify', { challenge: s.data.challenge, code: recovery[0] });
    assert.equal(r.status, 200);
    assert.equal(r.data.recovery_codes_left, 7);
    const d = client(env.base);
    const s2 = await d.post('/auth/login', { email: 'agent@dara.demo', password: 'DaraDemo2026' });
    assert.equal((await d.post('/auth/mfa/verify', { challenge: s2.data.challenge, code: recovery[0] })).status, 401);
  });

  test('an admin can reset someone’s two-step sign-in (audited, signs them out); a manager cannot', async () => {
    const admin = await as(env.base, 'admin');
    const mgr = await as(env.base, 'manager');
    const agent = await userByEmail(env.db, 'agent@dara.demo');
    assert.equal((await mgr.patch(`/users/${agent.id}`, { reset_mfa: true })).status, 403);
    assert.equal((await admin.patch(`/users/${admin.user.id}`, { reset_mfa: true })).data.error.code, 'SELF_MFA_RESET');
    const r = await admin.patch(`/users/${agent.id}`, { reset_mfa: true });
    assert.equal(r.status, 200);
    assert.equal(r.data.item.mfa_enabled, false);
    assert.equal((await env.db.get('SELECT COUNT(*) n FROM sessions WHERE user_id = ?', agent.id)).n, 0);
    assert.ok(await env.db.get(`SELECT id FROM audit_log WHERE entity_id = ? AND action = 'user.updated'`, agent.id));
    await as(env.base, 'agent'); // password-only sign-in works again
  });
});

describe('new workspaces: verification and required two-step sign-in for admins', () => {
  let owner; let signup;
  test('an unverified owner must set up two-step sign-in, and cannot invite people until verified', async () => {
    owner = client(env.base);
    signup = await owner.post('/signup', { company: 'Secure Homes', name: 'Sara Secure', email: 'sara@securehomes.ae', password: 'StrongPass2026', accept_terms: true });
    assert.equal(signup.status, 201);
    assert.ok(signup.data.dev_verification_url.includes('/api/auth/verify-email?token='));
    const mail = env.mailer.sent.at(-1);
    assert.equal(mail.to, 'sara@securehomes.ae');
    assert.ok(mail.text.includes(new URL(signup.data.dev_verification_url).search.slice(7)), 'the emailed link carries the token');
    assert.equal((await owner.get('/dashboard/main')).data.error.code, 'MFA_SETUP_REQUIRED');
    assert.equal((await owner.get('/auth/me')).status, 200, 'account pages stay reachable to finish setup');
    const setup = await owner.post('/auth/mfa/setup');
    assert.equal((await owner.post('/auth/mfa/enable', { code: totp(setup.data.secret) })).status, 200);
    assert.equal((await owner.get('/dashboard/main')).status, 200);
    assert.equal((await owner.post('/users', { name: 'New', email: 'new@securehomes.ae', role: 'agent', password: 'Password123456' })).data.error.code, 'EMAIL_UNVERIFIED');
    assert.equal((await owner.post('/auth/mfa/disable', { password: 'StrongPass2026' })).status, 403, 'policy keeps it on for admins');
  });

  test('the verification link works once; a bad token is sent back to the sign-in page', async () => {
    const bad = await fetch(env.base + '/api/auth/verify-email?token=nope', { redirect: 'manual' });
    assert.equal(bad.status, 302);
    assert.match(bad.headers.get('location'), /verify=invalid/);
    const good = await fetch(env.base + localPath(signup.data.dev_verification_url), { redirect: 'manual' });
    assert.match(good.headers.get('location'), /verified=1/);
    const reuse = await fetch(env.base + localPath(signup.data.dev_verification_url), { redirect: 'manual' });
    assert.match(reuse.headers.get('location'), /verify=invalid/);
    assert.equal((await owner.get('/auth/me')).data.user.email_verified, true);
    assert.equal((await owner.post('/users', { name: 'New', email: 'new@securehomes.ae', role: 'agent', password: 'Password123456' })).status, 201);
    assert.equal((await owner.post('/auth/resend-verification')).data.already_verified, true);
  });

  test('admins can switch the requirement off; only admins can change policies', async () => {
    assert.equal((await owner.patch('/workspace', { mfa_required_admins: false })).status, 200);
    assert.equal((await owner.get('/workspace')).data.item.policies.mfa_required_admins, false);
    const mgr = await as(env.base, 'manager');
    assert.equal((await mgr.patch('/workspace', { policy_block_expired_brn: true })).status, 403);
  });
});

describe('forgot / reset password', () => {
  test('same answer whether or not the email exists; the link resets once and signs out everywhere', async () => {
    const c = client(env.base);
    const unknown = await c.post('/auth/forgot', { email: 'nobody@nowhere.ae' });
    const known = await c.post('/auth/forgot', { email: 'lead@dara.demo' });
    assert.equal(unknown.status, 200); assert.equal(known.status, 200);
    assert.equal(unknown.data.message, known.data.message);
    assert.equal(unknown.data.dev_url, undefined);
    const token = new URL(known.data.dev_url).hash.replace('#reset=', '');
    const lead = await as(env.base, 'lead');
    assert.equal((await c.post('/auth/reset', { token, password: 'short' })).status, 400);
    assert.equal((await c.post('/auth/reset', { token, password: 'BrandNewPass2026' })).status, 200);
    assert.equal((await lead.get('/auth/me')).status, 401, 'old sessions are signed out');
    assert.equal((await c.post('/auth/reset', { token, password: 'AnotherPass2026' })).data.error.code, 'RESET_LINK_INVALID');
    await client(env.base).login('lead@dara.demo', 'BrandNewPass2026');
    await assert.rejects(client(env.base).login('lead@dara.demo'));
  });
});

describe('compliance policies (off by default)', () => {
  const free = () => env.db.get(`SELECT p.* FROM properties p JOIN tenants t ON t.id = p.tenant_id WHERE t.slug = 'dara-demo' AND p.status = 'available'
    AND p.id NOT IN (SELECT property_id FROM reservations WHERE status IN ('held','pending_confirmation','confirmed')) ORDER BY p.ref LIMIT 1`);
  let admin; let agent; let agentRow; let tenantId;
  before(async () => {
    admin = await as(env.base, 'admin'); agent = await as(env.base, 'karim');
    agentRow = await userByEmail(env.db, 'karim@dara.demo'); tenantId = agentRow.tenant_id;
    await env.db.run('UPDATE users SET brn_expiry = ? WHERE id = ?', '2020-01-01T00:00:00.000Z', agentRow.id);
  });

  test('with the switch off, an expired BRN only warns — holds still work', async () => {
    const p = await free();
    const r = await agent.post('/reservations', { property_id: p.id });
    assert.equal(r.status, 201);
    assert.equal((await agent.post(`/reservations/${r.data.item.id}/cancel`, { reason: 'test' })).status, 200);
  });

  test('expired BRN blocks holds and lead assignment when switched on', async () => {
    assert.equal((await admin.patch('/workspace', { policy_block_expired_brn: true })).status, 200);
    const p = await free();
    assert.equal((await agent.post('/reservations', { property_id: p.id })).data.error.code, 'BRN_EXPIRED');
    const lead = await admin.post('/leads', { first_name: 'Policy', phone: '+971500000001', owner_id: agentRow.id, assign: 'manual' });
    assert.equal(lead.data.error.code, 'BRN_EXPIRED');
    await admin.patch('/workspace', { policy_block_expired_brn: false });
  });

  test('expired permit blocks holds on that listing when switched on', async () => {
    const p = await free();
    await env.db.run('UPDATE properties SET permit_expiry = ? WHERE id = ?', '2020-01-01T00:00:00.000Z', p.id);
    const fresh = await as(env.base, 'agent');
    assert.equal((await fresh.post('/reservations', { property_id: p.id })).status, 201, 'off by default');
    await env.db.run(`UPDATE reservations SET status = 'cancelled' WHERE property_id = ? AND status = 'held'`, p.id);
    await env.db.run(`UPDATE properties SET status = 'available' WHERE id = ?`, p.id);
    await admin.patch('/workspace', { policy_block_expired_permit: true });
    assert.equal((await fresh.post('/reservations', { property_id: p.id })).data.error.code, 'PERMIT_EXPIRED');
    await admin.patch('/workspace', { policy_block_expired_permit: false });
    assert.ok(tenantId);
  });
});
