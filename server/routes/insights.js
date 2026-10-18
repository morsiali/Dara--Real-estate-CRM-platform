// Dashboards, leaderboard, achievements, team overview and calendar time analytics.
import { notFound } from '../http.js';
import { nowIso } from '../db.js';
import { canOnOwner, visibleUserIds, requireScope, isManagement } from '../rbac.js';
import { periodRange, metrics, snapshot, series, leaderboard, timeUse } from '../services/analytics.js';
import { ACHIEVEMENTS, achievementProgress } from '../services/gamification.js';

export function registerInsights(router, ctx) {
  const { db, hub } = ctx;
  const tz = async (u) => (await db.get('SELECT tz_offset_min FROM tenants WHERE id = ?', u.tenant_id))?.tz_offset_min ?? 240;
  const ranges = async (u, period) => ({ cur: periodRange(period, await tz(u)), prev: periodRange(period, await tz(u), new Date(), -1) });
  const tenantUserIds = async (u) => (await db.all(`SELECT id FROM users WHERE tenant_id = ?`, u.tenant_id)).map((r) => r.id);
  const fieldIds = async (u) => (await db.all(`SELECT id FROM users WHERE tenant_id = ? AND role IN ('agent','team_lead')`, u.tenant_id)).map((r) => r.id);

  router.get('/api/dashboard/main', async (req) => {
    const u = req.user; const period = req.query.period || 'week';
    const { cur, prev } = await ranges(u, period);
    const ids = await tenantUserIds(u);
    const board = await leaderboard(db, u.tenant_id, cur);
    const startToday = periodRange('today', await tz(u)).start; const endToday = periodRange('today', await tz(u)).end;
    const agenda = await db.all(`SELECT DISTINCT e.id, e.title, e.type, e.start_at, e.end_at, e.location, e.status FROM events e LEFT JOIN event_attendees ea ON ea.event_id = e.id
      WHERE e.tenant_id = ? AND (e.organizer_id = ? OR (ea.user_id = ? AND ea.response != 'declined')) AND e.start_at >= ? AND e.start_at < ? AND e.status != 'cancelled' ORDER BY e.start_at`,
      u.tenant_id, u.id, u.id, startToday, endToday);
    const wins = await db.all(`SELECT d.id, d.title, d.value, d.currency, d.closed_at, u.name owner_name, u.color owner_color FROM deals d JOIN users u ON u.id = d.owner_id
      WHERE d.tenant_id = ? AND d.stage = 'won' ORDER BY d.closed_at DESC LIMIT 6`, u.tenant_id);
    const announcements = await db.all(`SELECT a.*, u.name author_name FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.tenant_id = ? ORDER BY a.pinned DESC, a.created_at DESC LIMIT 5`, u.tenant_id);
    const snap = await snapshot(db, ids, nowIso());
    return {
      range: cur, kpis: await metrics(db, ids, cur), previous: await metrics(db, ids, prev), series: await series(db, ids, cur),
      pipeline_by_stage: snap.pipeline_by_stage, pipeline_value: snap.pipeline_value, open_deals: snap.open_deals,
      leaderboard: board.slice(0, 5), my_rank: board.find((r) => r.id === u.id) ?? null, field_size: board.length,
      agenda, wins, announcements, online: hub.online(), team_size: (await fieldIds(u)).length,
    };
  });

  router.get('/api/dashboard/member/:id', async (req) => {
    const u = req.user; const id = req.params.id === 'me' ? u.id : req.params.id;
    const member = await db.get(`SELECT u.id, u.name, u.role, u.title, u.color, u.email, u.phone, u.team_id, u.last_seen_at, t.name team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ? AND u.tenant_id = ?`, id, u.tenant_id);
    if (!member || !await canOnOwner(db, u, 'dashboard.member', member.id)) throw notFound('Team member');
    const period = req.query.period || 'week';
    const { cur, prev } = await ranges(u, period);
    const month = periodRange('month', await tz(u));
    const monthKey = new Date(Date.parse(month.start) + await tz(u) * 60000).toISOString().slice(0, 7);
    const monthM = await metrics(db, [member.id], month);
    const goals = (await db.all('SELECT metric, target FROM goals WHERE user_id = ? AND month = ?', member.id, monthKey))
      .map((g) => ({ ...g, actual: monthM[g.metric] ?? 0, pct: Math.min(999, Math.round(((monthM[g.metric] ?? 0) / g.target) * 100)) }));
    const prog = await achievementProgress(db, member.id);
    const earned = new Map((await db.all('SELECT code, earned_at FROM user_achievements WHERE user_id = ?', member.id)).map((r) => [r.code, r.earned_at]));
    const board = await leaderboard(db, u.tenant_id, cur);
    const tasks = await db.all(`SELECT t.id, t.title, t.priority, t.status, t.due_at, c.name creator_name FROM tasks t JOIN users c ON c.id = t.creator_id
      WHERE t.assignee_id = ? AND t.status IN ('todo','in_progress','changes_requested','submitted') ORDER BY COALESCE(t.due_at,'9999') LIMIT 8`, member.id);
    const upcoming = await db.all(`SELECT DISTINCT e.id, e.title, e.type, e.start_at, e.end_at, e.location FROM events e LEFT JOIN event_attendees ea ON ea.event_id = e.id
      WHERE (e.organizer_id = ? OR (ea.user_id = ? AND ea.response != 'declined')) AND e.status = 'scheduled' AND e.end_at >= ? ORDER BY e.start_at LIMIT 6`, member.id, member.id, nowIso());
    const ledger = await db.all('SELECT points, reason, at FROM points_ledger WHERE user_id = ? ORDER BY at DESC LIMIT 10', member.id);
    return {
      member: { ...member, online: hub.clients.has(member.id) }, range: cur,
      kpis: await metrics(db, [member.id], cur), previous: await metrics(db, [member.id], prev), series: await series(db, [member.id], cur),
      snapshot: await snapshot(db, [member.id], nowIso()), goals, month: monthKey,
      achievements: ACHIEVEMENTS.map((a) => ({ ...a, earned_at: earned.get(a.code) ?? null, progress: prog[a.code][0], target: prog[a.code][1] })),
      rank: board.find((r) => r.id === member.id)?.rank ?? null, field_size: board.length,
      tasks, upcoming, ledger, can_set_goals: await canOnOwner(db, u, 'goals.set', member.id) && (member.id !== u.id || isManagement(u)),
    };
  });

  router.get('/api/team/overview', async (req) => {
    requireScope(req.user, 'analytics.time');
    const period = req.query.period || 'week';
    const { cur } = await ranges(req.user, period);
    const ids = (await visibleUserIds(db, req.user, 'dashboard.member')).filter((id) => id !== req.user.id || req.user.role === 'team_lead');
    const L = ids.map(() => '?').join(',') || "''";
    const people = await db.all(`SELECT u.id, u.name, u.role, u.title, u.color, u.last_seen_at, u.active, t.name team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.id IN (${L}) AND u.role IN ('agent','team_lead') ORDER BY t.name, u.name`, ...ids);
    const now = nowIso();
    const rows = await Promise.all(people.map(async (p) => ({ ...p, online: hub.clients.has(p.id), kpis: await metrics(db, [p.id], cur), snapshot: await snapshot(db, [p.id], now) })));
    const totals = await metrics(db, people.map((p) => p.id), cur);
    return { range: cur, members: rows, totals };
  });

  router.get('/api/leaderboard', async (req) => {
    const period = req.query.period || 'month';
    const { cur } = await ranges(req.user, period);
    return { range: cur, items: await leaderboard(db, req.user.tenant_id, cur) };
  });

  router.get('/api/achievements', async (req) => {
    const id = req.query.user || req.user.id;
    if (!await db.get('SELECT id FROM users WHERE id = ? AND tenant_id = ?', id, req.user.tenant_id)) throw notFound('User');
    const earned = new Map((await db.all('SELECT code, earned_at FROM user_achievements WHERE user_id = ?', id)).map((r) => [r.code, r.earned_at]));
    const recent = await db.all(`SELECT ua.code, ua.earned_at, u.name, u.color FROM user_achievements ua JOIN users u ON u.id = ua.user_id WHERE u.tenant_id = ? ORDER BY ua.earned_at DESC LIMIT 12`, req.user.tenant_id);
    return { catalog: ACHIEVEMENTS.map((a) => ({ ...a, earned_at: earned.get(a.code) ?? null })), recent };
  });

  router.get('/api/analytics/time', async (req) => {
    requireScope(req.user, 'analytics.time');
    const period = req.query.period || 'week';
    const { cur } = await ranges(req.user, period);
    const ids = await visibleUserIds(db, req.user, 'analytics.time');
    const names = new Map((await db.all(`SELECT id, name, color, role FROM users WHERE tenant_id = ?`, req.user.tenant_id)).map((r) => [r.id, r]));
    const rows = (await timeUse(db, ids, cur)).map((r) => ({ ...r, name: names.get(r.user_id)?.name, color: names.get(r.user_id)?.color, role: names.get(r.user_id)?.role }))
      .filter((r) => r.events > 0 || ['agent', 'team_lead'].includes(r.role));
    const wonDeals = (await db.get(`SELECT COUNT(*) n FROM deals WHERE tenant_id = ? AND stage = 'won' AND closed_at >= ? AND closed_at < ? AND owner_id IN (${ids.map(() => '?').join(',') || "''"})`, req.user.tenant_id, cur.start, cur.end, ...ids)).n;
    return { range: cur, items: rows.sort((a, b) => b.total_hours - a.total_hours), deals_won: wonDeals };
  });
}
