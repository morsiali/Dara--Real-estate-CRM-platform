// Dashboards, leaderboard, achievements, team overview and calendar time analytics.
import { notFound } from '../http.js';
import { nowIso } from '../db.js';
import { canOnOwner, visibleUserIds, requireScope, isManagement } from '../rbac.js';
import { periodRange, metrics, snapshot, series, leaderboard, timeUse } from '../services/analytics.js';
import { ACHIEVEMENTS, achievementProgress } from '../services/gamification.js';

export function registerInsights(router, ctx) {
  const { db, hub } = ctx;
  const tz = (u) => db.get('SELECT tz_offset_min FROM tenants WHERE id = ?', u.tenant_id)?.tz_offset_min ?? 240;
  const ranges = (u, period) => ({ cur: periodRange(period, tz(u)), prev: periodRange(period, tz(u), new Date(), -1) });
  const tenantUserIds = (u) => db.all(`SELECT id FROM users WHERE tenant_id = ?`, u.tenant_id).map((r) => r.id);
  const fieldIds = (u) => db.all(`SELECT id FROM users WHERE tenant_id = ? AND role IN ('agent','team_lead')`, u.tenant_id).map((r) => r.id);

  router.get('/api/dashboard/main', (req) => {
    const u = req.user; const period = req.query.period || 'week';
    const { cur, prev } = ranges(u, period);
    const ids = tenantUserIds(u);
    const board = leaderboard(db, u.tenant_id, cur);
    const startToday = periodRange('today', tz(u)).start; const endToday = periodRange('today', tz(u)).end;
    const agenda = db.all(`SELECT DISTINCT e.id, e.title, e.type, e.start_at, e.end_at, e.location, e.status FROM events e LEFT JOIN event_attendees ea ON ea.event_id = e.id
      WHERE e.tenant_id = ? AND (e.organizer_id = ? OR (ea.user_id = ? AND ea.response != 'declined')) AND e.start_at >= ? AND e.start_at < ? AND e.status != 'cancelled' ORDER BY e.start_at`,
      u.tenant_id, u.id, u.id, startToday, endToday);
    const wins = db.all(`SELECT d.id, d.title, d.value, d.currency, d.closed_at, u.name owner_name, u.color owner_color FROM deals d JOIN users u ON u.id = d.owner_id
      WHERE d.tenant_id = ? AND d.stage = 'won' ORDER BY d.closed_at DESC LIMIT 6`, u.tenant_id);
    const announcements = db.all(`SELECT a.*, u.name author_name FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.tenant_id = ? ORDER BY a.pinned DESC, a.created_at DESC LIMIT 5`, u.tenant_id);
    const snap = snapshot(db, ids, nowIso());
    return {
      range: cur, kpis: metrics(db, ids, cur), previous: metrics(db, ids, prev), series: series(db, ids, cur),
      pipeline_by_stage: snap.pipeline_by_stage, pipeline_value: snap.pipeline_value, open_deals: snap.open_deals,
      leaderboard: board.slice(0, 5), my_rank: board.find((r) => r.id === u.id) ?? null, field_size: board.length,
      agenda, wins, announcements, online: hub.online(), team_size: fieldIds(u).length,
    };
  });

  router.get('/api/dashboard/member/:id', (req) => {
    const u = req.user; const id = req.params.id === 'me' ? u.id : req.params.id;
    const member = db.get(`SELECT u.id, u.name, u.role, u.title, u.color, u.email, u.phone, u.team_id, u.last_seen_at, t.name team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ? AND u.tenant_id = ?`, id, u.tenant_id);
    if (!member || !canOnOwner(db, u, 'dashboard.member', member.id)) throw notFound('Team member');
    const period = req.query.period || 'week';
    const { cur, prev } = ranges(u, period);
    const month = periodRange('month', tz(u));
    const monthKey = new Date(Date.parse(month.start) + tz(u) * 60000).toISOString().slice(0, 7);
    const monthM = metrics(db, [member.id], month);
    const goals = db.all('SELECT metric, target FROM goals WHERE user_id = ? AND month = ?', member.id, monthKey)
      .map((g) => ({ ...g, actual: monthM[g.metric] ?? 0, pct: Math.min(999, Math.round(((monthM[g.metric] ?? 0) / g.target) * 100)) }));
    const prog = achievementProgress(db, member.id);
    const earned = new Map(db.all('SELECT code, earned_at FROM user_achievements WHERE user_id = ?', member.id).map((r) => [r.code, r.earned_at]));
    const board = leaderboard(db, u.tenant_id, cur);
    const tasks = db.all(`SELECT t.id, t.title, t.priority, t.status, t.due_at, c.name creator_name FROM tasks t JOIN users c ON c.id = t.creator_id
      WHERE t.assignee_id = ? AND t.status IN ('todo','in_progress','changes_requested','submitted') ORDER BY COALESCE(t.due_at,'9999') LIMIT 8`, member.id);
    const upcoming = db.all(`SELECT DISTINCT e.id, e.title, e.type, e.start_at, e.end_at, e.location FROM events e LEFT JOIN event_attendees ea ON ea.event_id = e.id
      WHERE (e.organizer_id = ? OR (ea.user_id = ? AND ea.response != 'declined')) AND e.status = 'scheduled' AND e.end_at >= ? ORDER BY e.start_at LIMIT 6`, member.id, member.id, nowIso());
    const ledger = db.all('SELECT points, reason, at FROM points_ledger WHERE user_id = ? ORDER BY at DESC LIMIT 10', member.id);
    return {
      member: { ...member, online: hub.clients.has(member.id) }, range: cur,
      kpis: metrics(db, [member.id], cur), previous: metrics(db, [member.id], prev), series: series(db, [member.id], cur),
      snapshot: snapshot(db, [member.id], nowIso()), goals, month: monthKey,
      achievements: ACHIEVEMENTS.map((a) => ({ ...a, earned_at: earned.get(a.code) ?? null, progress: prog[a.code][0], target: prog[a.code][1] })),
      rank: board.find((r) => r.id === member.id)?.rank ?? null, field_size: board.length,
      tasks, upcoming, ledger, can_set_goals: canOnOwner(db, u, 'goals.set', member.id) && (member.id !== u.id || isManagement(u)),
    };
  });

  router.get('/api/team/overview', (req) => {
    requireScope(req.user, 'analytics.time');
    const period = req.query.period || 'week';
    const { cur } = ranges(req.user, period);
    const ids = visibleUserIds(db, req.user, 'dashboard.member').filter((id) => id !== req.user.id || req.user.role === 'team_lead');
    const L = ids.map(() => '?').join(',') || "''";
    const people = db.all(`SELECT u.id, u.name, u.role, u.title, u.color, u.last_seen_at, u.active, t.name team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.id IN (${L}) AND u.role IN ('agent','team_lead') ORDER BY t.name, u.name`, ...ids);
    const now = nowIso();
    const rows = people.map((p) => ({ ...p, online: hub.clients.has(p.id), kpis: metrics(db, [p.id], cur), snapshot: snapshot(db, [p.id], now) }));
    const totals = metrics(db, people.map((p) => p.id), cur);
    return { range: cur, members: rows, totals };
  });

  router.get('/api/leaderboard', (req) => {
    const period = req.query.period || 'month';
    const { cur } = ranges(req.user, period);
    return { range: cur, items: leaderboard(db, req.user.tenant_id, cur) };
  });

  router.get('/api/achievements', (req) => {
    const id = req.query.user || req.user.id;
    if (!db.get('SELECT id FROM users WHERE id = ? AND tenant_id = ?', id, req.user.tenant_id)) throw notFound('User');
    const earned = new Map(db.all('SELECT code, earned_at FROM user_achievements WHERE user_id = ?', id).map((r) => [r.code, r.earned_at]));
    const recent = db.all(`SELECT ua.code, ua.earned_at, u.name, u.color FROM user_achievements ua JOIN users u ON u.id = ua.user_id WHERE u.tenant_id = ? ORDER BY ua.earned_at DESC LIMIT 12`, req.user.tenant_id);
    return { catalog: ACHIEVEMENTS.map((a) => ({ ...a, earned_at: earned.get(a.code) ?? null })), recent };
  });

  router.get('/api/analytics/time', (req) => {
    requireScope(req.user, 'analytics.time');
    const period = req.query.period || 'week';
    const { cur } = ranges(req.user, period);
    const ids = visibleUserIds(db, req.user, 'analytics.time');
    const names = new Map(db.all(`SELECT id, name, color, role FROM users WHERE tenant_id = ?`, req.user.tenant_id).map((r) => [r.id, r]));
    const rows = timeUse(db, ids, cur).map((r) => ({ ...r, name: names.get(r.user_id)?.name, color: names.get(r.user_id)?.color, role: names.get(r.user_id)?.role }))
      .filter((r) => r.events > 0 || ['agent', 'team_lead'].includes(r.role));
    const wonDeals = db.get(`SELECT COUNT(*) n FROM deals WHERE tenant_id = ? AND stage = 'won' AND closed_at >= ? AND closed_at < ? AND owner_id IN (${ids.map(() => '?').join(',') || "''"})`, req.user.tenant_id, cur.start, cur.end, ...ids).n;
    return { range: cur, items: rows.sort((a, b) => b.total_hours - a.total_hours), deals_won: wonDeals };
  });
}
