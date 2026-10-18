// In-app notifications (idempotent per user + dedupe key) and the audit trail.
import { uuidv7, nowIso } from '../db.js';

export function notify(ctx, userId, { type, title, body = null, link = null, dedupeKey }) {
  if (!userId) return null;
  const id = uuidv7();
  const at = nowIso();
  const r = ctx.db.run(
    `INSERT INTO notifications(id, user_id, type, title, body, link, dedupe_key, created_at)
     VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id, dedupe_key) DO NOTHING`,
    id, userId, type, title, body, link, dedupeKey || `${type}:${id}`, at);
  if (r.changes === 0) return null; // duplicate suppressed
  const n = { id, type, title, body, link, created_at: at, read_at: null };
  ctx.hub?.send(userId, 'notification', n);
  return n;
}

export function audit(ctx, actor, action, entity, entityId, data = null) {
  ctx.db.run('INSERT INTO audit_log(id, tenant_id, actor_id, action, entity, entity_id, data, at) VALUES (?,?,?,?,?,?,?,?)',
    uuidv7(), actor?.tenant_id ?? ctx.tenantId ?? 'system', actor?.id ?? null, action, entity, entityId, data ? JSON.stringify(data) : null, nowIso());
}

/** Management recipients (admins + managers) of a tenant, plus the team lead of a given team. */
export function managementIds(db, tenantId, teamId = null) {
  const ids = db.all(`SELECT id FROM users WHERE tenant_id = ? AND active = 1 AND role IN ('admin','manager')`, tenantId).map((r) => r.id);
  if (teamId) {
    const t = db.get('SELECT lead_id FROM teams WHERE id = ?', teamId);
    if (t?.lead_id) ids.push(t.lead_id);
  }
  return [...new Set(ids)];
}
