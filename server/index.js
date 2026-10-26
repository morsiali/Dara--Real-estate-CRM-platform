// Entry point: `npm start`. SQLite by default (zero install); PostgreSQL with row-level security when DATABASE_URL is set.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';
import { createOutbox } from './services/mailer.js';

// Minimal local env loader (no dependency): deployment environment still takes precedence.
for (const envFile of ['.env.local', '.env']) {
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#]*?)\s*(#.*)?$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}

const PORT = Number(process.env.PORT || 4310);
const PROD = process.env.NODE_ENV === 'production';
const flag = (name, dflt) => (process.env[name] === undefined || process.env[name] === '' ? dflt : process.env[name] === '1');
if (PROD && !process.env.DARA_SECRET_KEY) { console.error('DARA_SECRET_KEY is required in production (openssl rand -base64 32). Refusing to start.'); process.exit(1); }
const DB_FILE = resolve(process.env.DB_FILE || './data/dara.db');
const db = process.env.DATABASE_URL ? await openDb({ url: process.env.DATABASE_URL }) : await openDb({ file: DB_FILE });

if ((process.env.SEED_ON_EMPTY ?? (PROD ? '0' : '1')) === '1' && !(await db.get('SELECT id FROM tenants LIMIT 1'))) {
  console.log('Empty database — loading synthetic demo data…');
  await seed(db);
}

const { server, hub, ctx } = createApp(db, {
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 168),
  secureCookies: flag('COOKIE_SECURE', PROD),
  // GitHub Codespaces: emailed links point at the forwarded URL automatically.
  publicUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || (process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? `https://${process.env.CODESPACE_NAME}-${PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}` : `http://localhost:${PORT}`),
  // No email provider yet, so links can also be shown on screen. Verification links only ever go to the signed-in
  // owner of that account; password-reset links would let anyone reset any account, so they are separate and off in production.
  devLinks: flag('DEV_LINKS', !PROD),
  devResetLinks: flag('DEV_RESET_LINKS', !PROD),
  mailer: createOutbox(resolve(process.env.OUTBOX_DIR || './data/outbox')),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  aiModel: process.env.OPENAI_AI_MODEL || 'gpt-6-luna',
});

// Background jobs: expire reservation holds every 30 s (AC-RES-02 target ≤ 60 s); compliance reminders hourly.
const safely = (fn) => async () => { try { await fn(); } catch (e) { console.error('[sweep]', e); } };
await safely(ctx.sweep)();
const t1 = setInterval(safely(ctx.sweepReservations), 30_000);
const t2 = setInterval(safely(ctx.sweep), 3600_000);

if (PROD && flag('DEV_RESET_LINKS', false)) console.warn('[warn] DEV_RESET_LINKS=1 shows password-reset links in API responses — anyone could reset any account. Private local demo only.');

// Graceful shutdown (Docker sends SIGTERM): stop timers, close streams and the server, then the database pool.
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => {
  if (stopping) return; stopping = true;
  clearInterval(t1); clearInterval(t2); hub.closeAll();
  server.close(async () => { await db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
});

server.listen(PORT, () => {
  console.log(`\nDara is running → http://localhost:${PORT}`);
  console.log(`Database: ${db.dialect === 'postgres' ? `PostgreSQL (row-level security on; ${db.isolation.mode === 'app_role' ? `app role ${db.isolation.appRole}` : `forced on owner ${db.isolation.user}`})` : DB_FILE}`);
  if (!PROD) console.log('Demo sign-ins (synthetic data): admin@ · manager@ · lead@ · agent@dara.demo, platform@dara.demo (platform console), owner@palmcoast.demo (second brokerage) — password DaraDemo2026\n');
});
