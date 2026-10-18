// Performance analytics: period windows in the tenant's time zone, KPIs, time series, leaderboard, time use.
// Every metric here is defined in docs/METRICS.md.
import { commission } from './money.js';

const DAY = 86400000;
export const PERIODS = ['today', 'week', 'month', 'quarter', 'year'];

/**
 * Returns {start, end, buckets[], label} in UTC ISO for a local-time period.
 * offset = 0 current period, -1 previous, etc. Weeks start Monday.
 */
export function periodRange(period, tzOffsetMin = 240, now = new Date(), offset = 0) {
  if (!PERIODS.includes(period)) period = 'week';
  const off = tzOffsetMin * 60000;
  const local = new Date(now.getTime() + off); // shifted clock; read with getUTC*
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  const toUtc = (ms) => new Date(ms - off);
  let startL, endL; const buckets = [];
  if (period === 'today') {
    startL = Date.UTC(y, m, d + offset); endL = startL + DAY;
    for (let h = 0; h < 24; h++) buckets.push({ s: startL + h * 3600000, e: startL + (h + 1) * 3600000, label: String(h).padStart(2, '0') });
  } else if (period === 'week') {
    const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
    startL = Date.UTC(y, m, d - dow + offset * 7); endL = startL + 7 * DAY;
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (let i = 0; i < 7; i++) buckets.push({ s: startL + i * DAY, e: startL + (i + 1) * DAY, label: names[i] });
  } else if (period === 'month') {
    startL = Date.UTC(y, m + offset, 1); endL = Date.UTC(y, m + offset + 1, 1);
    for (let t = startL, i = 1; t < endL; t += DAY, i++) buckets.push({ s: t, e: t + DAY, label: String(i) });
  } else if (period === 'quarter') {
    const q = Math.floor(m / 3) + offset;
    startL = Date.UTC(y, q * 3, 1); endL = Date.UTC(y, q * 3 + 3, 1);
    for (let t = startL, i = 1; t < endL; t += 7 * DAY, i++) buckets.push({ s: t, e: Math.min(t + 7 * DAY, endL), label: `W${i}` });
  } else {
    startL = Date.UTC(y + offset, 0, 1); endL = Date.UTC(y + offset + 1, 0, 1);
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 0; i < 12; i++) buckets.push({ s: Date.UTC(y + offset, i, 1), e: Date.UTC(y + offset, i + 1, 1), label: names[i] });
  }
  return {
    period, start: toUtc(startL).toISOString(), end: toUtc(endL).toISOString(),
    buckets: buckets.map((b) => ({ start: toUtc(b.s).toISOString(), end: toUtc(b.e).toISOString(), label: b.label })),
  };
}

const inList = (ids) => ids.map(() => '?').join(',') || "''";

/** KPI block for a set of users within [start, end). */
export function metrics(db, userIds, range) {
  if (!userIds.length) userIds = ['__none__'];
  const L = inList(userIds); const { start, end } = range;
  const n = (sql, ...p) => db.get(sql, ...userIds, start, end, ...p)?.n ?? 0;
  const wonRows = db.all(`SELECT value, commission_bp FROM deals WHERE owner_id IN (${L}) AND stage = 'won' AND closed_at >= ? AND closed_at < ? AND currency = 'AED'`, ...userIds, start, end);
  const closedLost = n(`SELECT COUNT(*) n FROM deals WHERE owner_id IN (${L}) AND stage = 'lost' AND closed_at >= ? AND closed_at < ?`);
  const evRows = db.all(`SELECT e.type, e.status, e.start_at, e.end_at FROM events e WHERE e.organizer_id IN (${L}) AND e.start_at >= ? AND e.start_at < ?`, ...userIds, start, end);
  const tasksDue = db.all(`SELECT status, due_at, submitted_at FROM tasks WHERE assignee_id IN (${L}) AND approved_at >= ? AND approved_at < ?`, ...userIds, start, end);
  const heldTypes = { viewing: 0, meeting: 0, call: 0 };
  let meetingMinutes = 0, noShow = 0, scheduledPast = 0;
  for (const e of evRows) {
    if (e.status === 'completed') {
      if (heldTypes[e.type] !== undefined) heldTypes[e.type]++;
      meetingMinutes += (Date.parse(e.end_at) - Date.parse(e.start_at)) / 60000;
    }
    if (e.status === 'no_show') noShow++;
    if (['completed', 'no_show'].includes(e.status)) scheduledPast++;
  }
  const won = wonRows.length;
  const wonVolume = wonRows.reduce((s, r) => s + r.value, 0);
  const commissionWon = wonRows.reduce((s, r) => s + commission(r.value, r.commission_bp), 0);
  const onTime = tasksDue.filter((t) => t.due_at && t.submitted_at && t.submitted_at <= t.due_at).length;
  return {
    leads_new: n(`SELECT COUNT(*) n FROM leads WHERE owner_id IN (${L}) AND created_at >= ? AND created_at < ?`),
    leads_qualified: n(`SELECT COUNT(DISTINCT lead_id) n FROM lead_status_history WHERE owner_id IN (${L}) AND at >= ? AND at < ? AND to_status = 'qualified'`),
    deals_opened: n(`SELECT COUNT(*) n FROM deals WHERE owner_id IN (${L}) AND created_at >= ? AND created_at < ?`),
    deals_won: won,
    deals_lost: closedLost,
    win_rate: won + closedLost ? Math.round((won / (won + closedLost)) * 1000) / 10 : null,
    won_volume: wonVolume,
    commission_won: commissionWon,
    viewings_done: heldTypes.viewing,
    meetings_held: heldTypes.meeting,
    calls_logged: n(`SELECT COUNT(*) n FROM activities WHERE user_id IN (${L}) AND occurred_at >= ? AND occurred_at < ? AND type = 'call'`) + heldTypes.call,
    activities_logged: n(`SELECT COUNT(*) n FROM activities WHERE user_id IN (${L}) AND occurred_at >= ? AND occurred_at < ?`),
    tasks_approved: tasksDue.length,
    tasks_on_time_rate: tasksDue.length ? Math.round((onTime / tasksDue.length) * 1000) / 10 : null,
    meeting_hours: Math.round(meetingMinutes / 6) / 10,
    no_show_rate: scheduledPast ? Math.round((noShow / scheduledPast) * 1000) / 10 : null,
    points: n(`SELECT COALESCE(SUM(points),0) n FROM points_ledger WHERE user_id IN (${L}) AND at >= ? AND at < ?`),
  };
}

/** Snapshot (not period-bound) figures: open pipeline, overdue tasks, today's agenda size. */
export function snapshot(db, userIds, nowIso) {
  if (!userIds.length) userIds = ['__none__'];
  const L = inList(userIds);
  const pipe = db.all(`SELECT stage, COUNT(*) c, COALESCE(SUM(value),0) v FROM deals WHERE owner_id IN (${L}) AND stage NOT IN ('won','lost') GROUP BY stage`, ...userIds);
  return {
    pipeline_by_stage: pipe,
    pipeline_value: pipe.reduce((s, r) => s + r.v, 0),
    open_deals: pipe.reduce((s, r) => s + r.c, 0),
    open_tasks: db.get(`SELECT COUNT(*) n FROM tasks WHERE assignee_id IN (${L}) AND status IN ('todo','in_progress','changes_requested')`, ...userIds).n,
    overdue_tasks: db.get(`SELECT COUNT(*) n FROM tasks WHERE assignee_id IN (${L}) AND status IN ('todo','in_progress','changes_requested') AND due_at < ?`, ...userIds, nowIso).n,
    awaiting_review: db.get(`SELECT COUNT(*) n FROM tasks WHERE assignee_id IN (${L}) AND status = 'submitted'`, ...userIds).n,
    active_leads: db.get(`SELECT COUNT(*) n FROM leads WHERE owner_id IN (${L}) AND status IN ('new','contacted','qualified','nurturing')`, ...userIds).n,
    uncontacted_leads: db.get(`SELECT COUNT(*) n FROM leads WHERE owner_id IN (${L}) AND status = 'new'`, ...userIds).n,
  };
}

/** Time series per bucket: points, won volume, and activity count (calls+messages+completed events). */
export function series(db, userIds, range) {
  if (!userIds.length) userIds = ['__none__'];
  const L = inList(userIds); const { start, end, buckets } = range;
  const idx = (iso) => { for (let i = 0; i < buckets.length; i++) if (iso >= buckets[i].start && iso < buckets[i].end) return i; return -1; };
  const points = buckets.map(() => 0), volume = buckets.map(() => 0), activity = buckets.map(() => 0), won = buckets.map(() => 0);
  for (const r of db.all(`SELECT points, at FROM points_ledger WHERE user_id IN (${L}) AND at >= ? AND at < ?`, ...userIds, start, end)) { const i = idx(r.at); if (i >= 0) points[i] += r.points; }
  for (const r of db.all(`SELECT value, closed_at FROM deals WHERE owner_id IN (${L}) AND stage = 'won' AND currency = 'AED' AND closed_at >= ? AND closed_at < ?`, ...userIds, start, end)) { const i = idx(r.closed_at); if (i >= 0) { volume[i] += r.value; won[i]++; } }
  for (const r of db.all(`SELECT occurred_at t FROM activities WHERE user_id IN (${L}) AND occurred_at >= ? AND occurred_at < ?`, ...userIds, start, end)) { const i = idx(r.t); if (i >= 0) activity[i]++; }
  for (const r of db.all(`SELECT start_at t FROM events WHERE organizer_id IN (${L}) AND status = 'completed' AND start_at >= ? AND start_at < ?`, ...userIds, start, end)) { const i = idx(r.t); if (i >= 0) activity[i]++; }
  // Index of the bucket containing "now" so charts don't draw the future as zeros.
  const now = new Date().toISOString();
  const current = now >= end ? buckets.length - 1 : buckets.findIndex((b) => now >= b.start && now < b.end);
  return { labels: buckets.map((b) => b.label), points, won_volume: volume, deals_won: won, activity, current_index: current };
}

export function leaderboard(db, tenantId, range) {
  const users = db.all(`SELECT u.id, u.name, u.role, u.title, u.color, u.team_id, t.name team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id
    WHERE u.tenant_id = ? AND u.active = 1 AND u.role IN ('agent','team_lead')`, tenantId);
  const badges = new Map(db.all(`SELECT user_id, COUNT(*) c FROM user_achievements GROUP BY user_id`).map((r) => [r.user_id, r.c]));
  const rows = users.map((u) => {
    const m = metrics(db, [u.id], range);
    return { ...u, points: m.points, deals_won: m.deals_won, won_volume: m.won_volume, viewings_done: m.viewings_done, tasks_approved: m.tasks_approved, calls_logged: m.calls_logged, badges: badges.get(u.id) || 0 };
  });
  rows.sort((a, b) => b.points - a.points || b.won_volume - a.won_volume || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** Calendar time use per member: hours by event type, conflicts (double-booked attended events). */
export function timeUse(db, userIds, range) {
  const out = [];
  for (const id of userIds) {
    const evs = db.all(`SELECT e.id, e.type, e.status, e.start_at, e.end_at FROM events e
      WHERE (e.organizer_id = ? OR e.id IN (SELECT event_id FROM event_attendees WHERE user_id = ? AND response != 'declined'))
      AND e.start_at >= ? AND e.start_at < ? AND e.status != 'cancelled' ORDER BY e.start_at`, id, id, range.start, range.end);
    const hours = { meeting: 0, viewing: 0, call: 0, internal: 0, focus: 0 };
    let conflicts = 0;
    for (let i = 0; i < evs.length; i++) {
      hours[evs[i].type] += (Date.parse(evs[i].end_at) - Date.parse(evs[i].start_at)) / 3600000;
      for (let j = i + 1; j < evs.length && evs[j].start_at < evs[i].end_at; j++) conflicts++;
    }
    for (const k in hours) hours[k] = Math.round(hours[k] * 10) / 10;
    const total = Object.values(hours).reduce((a, b) => a + b, 0);
    out.push({ user_id: id, hours, total_hours: Math.round(total * 10) / 10, events: evs.length, conflicts,
      no_shows: evs.filter((e) => e.status === 'no_show').length });
  }
  return out;
}
