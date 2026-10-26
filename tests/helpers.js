// Test harness: in-memory database with synthetic seed, app on a random port, cookie-aware client.
// DB_BACKEND=pglite runs the same suites against in-process PostgreSQL with row-level security enforced.
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed, DEMO_PASSWORD } from '../server/seed.js';
import { createOutbox } from '../server/services/mailer.js';

export const BACKEND = process.env.DB_BACKEND || 'sqlite';
export const openTestDb = () => (BACKEND === 'pglite' ? openDb({ pglite: true }) : openDb({ file: ':memory:' }));

export async function startApp({ seeded = true, config = {} } = {}) {
  const db = await openTestDb();
  if (seeded) await seed(db);
  const mailer = createOutbox(null);
  const app = createApp(db, { sessionTtlHours: 1, signupsPerHour: 100, publicUrl: 'http://dara.test', devLinks: true, mailer, ...config });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const close = async () => { app.hub.closeAll(); await new Promise((r) => app.server.close(r)); await db.close(); };
  return { db, app, base, close, mailer };
}

export function client(base) {
  let cookie = '';
  async function call(method, path, body, { headers = {}, csrf = true } = {}) {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { ...(cookie && { cookie }), ...(csrf && { 'X-Requested-With': 'dara' }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let data = null; try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  }
  return {
    get: (p, o) => call('GET', p, undefined, o),
    post: (p, b = {}, o) => call('POST', p, b, o),
    patch: (p, b = {}, o) => call('PATCH', p, b, o),
    put: (p, b = {}, o) => call('PUT', p, b, o),
    del: (p, o) => call('DELETE', p, {}, o),
    async login(email, password = DEMO_PASSWORD) { const r = await call('POST', '/auth/login', { email, password }); if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`); return r.data.user; },
    base,
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
  };
}

export async function as(base, who) {
  const c = client(base);
  c.user = await c.login(who.includes('@') ? who : `${who}@dara.demo`);
  return c;
}

export const userByEmail = (db, email) => db.get('SELECT * FROM users WHERE email = ?', email);

/** Finish a new owner's onboarding the way a person would: open the emailed verification link, then turn on two-step sign-in. */
export async function finishOnboarding(c, signupResponse) {
  const { totp } = await import('../server/services/totp.js');
  const link = new URL(signupResponse.data.dev_verification_url); // emailed links use PUBLIC_URL; tests hit the local port
  const v = await fetch(c.base + link.pathname + link.search, { redirect: 'manual' });
  if (v.status !== 302 || !/verified=1/.test(v.headers.get('location'))) throw new Error('verification link did not work');
  const setup = await c.post('/auth/mfa/setup');
  const enable = await c.post('/auth/mfa/enable', { code: totp(setup.data.secret) });
  if (enable.status !== 200) throw new Error(`mfa enable failed: ${JSON.stringify(enable.data)}`);
  return { secret: setup.data.secret, recovery_codes: enable.data.recovery_codes };
}
