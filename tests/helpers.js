// Test harness: in-memory database with synthetic seed, app on a random port, cookie-aware client.
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed, DEMO_PASSWORD } from '../server/seed.js';

export async function startApp({ seeded = true } = {}) {
  const db = openDb(':memory:');
  if (seeded) seed(db);
  const app = createApp(db, { sessionTtlHours: 1, signupsPerHour: 100 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const close = async () => { app.hub.closeAll(); await new Promise((r) => app.server.close(r)); db.close(); };
  return { db, app, base, close };
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
    async login(email, password = DEMO_PASSWORD) { const r = await call('POST', '/auth/login', { email, password }); if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`); return r.data.user; },
    get cookie() { return cookie; },
  };
}

export async function as(base, who) {
  const c = client(base);
  c.user = await c.login(`${who}@dara.demo`);
  return c;
}

export const userByEmail = (db, email) => db.get('SELECT * FROM users WHERE email = ?', email);
