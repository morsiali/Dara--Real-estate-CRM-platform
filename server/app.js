// Application wiring: request pipeline (auth, CSRF guard, routing, errors) and static hosting.
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, readJson, sendJson, sendError, serveStatic, parseCookies, SECURITY_HEADERS } from './http.js';
import { SESSION_COOKIE, sessionUser, LoginThrottle } from './auth.js';
import { RealtimeHub } from './services/realtime.js';
import { uuidv7, nowIso } from './db.js';
import { registerAuth, mfaSetupPending } from './routes/auth.js';
import { createOutbox } from './services/mailer.js';
import { registerCrm } from './routes/crm.js';
import { registerWork } from './routes/work.js';
import { registerChat } from './routes/chat.js';
import { registerInsights } from './routes/insights.js';
import { registerAdmin } from './routes/admin.js';
import { registerSaas } from './routes/saas.js';
import { registerInventory, sweepReservations, sweepCompliance } from './routes/inventory.js';
import { accessMode } from './services/billing.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(db, config = {}) {
  const cfg = { sessionTtlHours: 168, secureCookies: false, publicUrl: 'http://localhost:4310', devLinks: false, ...config };
  if (!cfg.mailer) cfg.mailer = createOutbox(null);
  const hub = new RealtimeHub();
  const router = new Router();
  const ctx = { db, hub, cfg, throttle: new LoginThrottle() };

  /** Posts a system message into a channel and pushes it to members. */
  ctx.postSystemMessage = async (channelId, body) => {
    const msg = { id: uuidv7(), channel_id: channelId, user_id: null, kind: 'system', body, created_at: nowIso() };
    await db.run('INSERT INTO messages(id, channel_id, user_id, kind, body, created_at) VALUES (?,?,?,?,?,?)', msg.id, channelId, null, 'system', body, msg.created_at);
    const members = (await db.all('SELECT user_id FROM channel_members WHERE channel_id = ?', channelId)).map((r) => r.user_id);
    hub.sendMany(members, 'message', msg);
    return msg;
  };

  registerAuth(router, ctx);
  registerCrm(router, ctx);
  registerWork(router, ctx);
  registerChat(router, ctx);
  registerInsights(router, ctx);
  registerAdmin(router, ctx);
  registerSaas(router, ctx);
  registerInventory(router, ctx);
  // Background jobs are cross-tenant system work.
  ctx.sweep = () => db.withContext({ system: true }, async () => (await sweepReservations(ctx)) + (await sweepCompliance(ctx)));
  ctx.sweepReservations = () => db.withContext({ system: true }, () => sweepReservations(ctx));

  router.get('/api/health', () => ({ ok: true, time: nowIso() }), { public: true });
  router.get('/api/stream', async (req, _ctx, res) => { hub.connect(req.user, req.raw, res); return undefined; }, { stream: true });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    if (!pathname.startsWith('/api/')) {
      const target = pathname === '/' ? '/index.html' : pathname === '/app' ? '/app.html' : pathname;
      if (req.method === 'GET' && serveStatic(PUBLIC_DIR, target, res)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      return res.end('Not found');
    }
    try {
      const found = router.match(req.method, pathname);
      if (!found) throw new HttpError(404, 'NOT_FOUND', 'No such endpoint.');
      if (found.methodNotAllowed) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for this endpoint.');
      const { route, params } = found;
      // CSRF defence in depth (with SameSite=Lax cookies): state-changing requests must carry a custom header,
      // which browsers will not send cross-site without a CORS preflight we never grant.
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'dara') {
        throw new HttpError(403, 'CSRF_REJECTED', 'Missing request header. Reload the page and try again.');
      }
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJson(req) : {};
      const cookies = parseCookies(req.headers.cookie);
      // Session lookup happens before the tenant is known, so it is system work (RLS bypass) — nothing else is.
      const { user, tenant } = await db.withContext({ system: true }, async () => {
        const u = await sessionUser(db, cookies[SESSION_COOKIE]);
        if (!u) return { user: null, tenant: null };
        await db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', nowIso(), u.id);
        return { user: u, tenant: await db.get('SELECT * FROM tenants WHERE id = ?', u.tenant_id) };
      });
      if (!route.opts.public && !user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      if (user) {
        // Platform staff manage workspaces; they never act inside a brokerage's data.
        if (user.platform_admin && !/^\/api\/(platform|auth|stream|notifications|health)/.test(pathname)) {
          throw new HttpError(403, 'PLATFORM_ACCOUNT', 'Platform accounts manage workspaces from the platform console.');
        }
        // C13: administrators in workspaces that require two-step sign-in must finish setting it up first.
        if (mfaSetupPending(user, tenant) && !/^\/api\/(auth|stream|health)/.test(pathname)) {
          throw new HttpError(403, 'MFA_SETUP_REQUIRED', 'Set up two-step sign-in to continue. Your workspace requires it for administrators.');
        }
        // Part F3: suspended, cancelled or expired-trial workspaces stay readable and exportable, but read-only.
        if (req.method !== 'GET' && !route.opts.allowReadOnly && accessMode(tenant) === 'read_only') {
          throw new HttpError(403, 'WORKSPACE_READ_ONLY', 'This workspace is read-only because its subscription is not active. Your data is safe and can be exported.');
        }
      }
      const r = { user, tenant, params, query: Object.fromEntries(url.searchParams), body, cookies, ip: req.socket.remoteAddress, raw: req };
      if (route.opts.stream) return route.handler(r, ctx, res); // long-lived: never hold a DB transaction open
      // One transaction per request, scoped to the caller's tenant (Postgres sets app.tenant_id for RLS).
      // `system` is reserved for explicitly marked routes (sign-in, signup, platform console) and anonymous calls.
      const result = await db.withContext({ tenantId: user?.tenant_id ?? null, system: !!route.opts.system || !user }, () => route.handler(r, ctx, res));
      if (res.headersSent) return;
      if (result && result.__status) return sendJson(res, result.__status, result.body, result.headers);
      sendJson(res, 200, result ?? { ok: true });
    } catch (err) {
      sendError(res, err);
    }
  }

  const server = createServer((req, res) => { handle(req, res).catch((e) => sendError(res, e)); });
  return { server, ctx, hub, router };
}
