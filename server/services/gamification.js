// Points and achievements. Points are an engagement score, not a compensation input (see METRICS.md).
import { uuidv7, nowIso } from '../db.js';
import { notify } from './notify.js';

/** BR-060: point values per event. Changing these never rewrites the ledger (rows keep their awarded value). */
export const POINT_RULES = {
  deal_won: 100,
  viewing_completed: 20,
  meeting_completed: 10,
  call_completed: 3,
  lead_qualified: 10,
  lead_converted: 15,
  task_approved: { low: 5, medium: 10, high: 15, urgent: 25 },
  task_on_time_bonus: 5,
  activity: { call: 3, whatsapp: 2, email: 2, note: 1 },
};
/** BR-061: logged activities earn at most this many points per user per day (anti-gaming). */
export const DAILY_ACTIVITY_CAP = 30;

export const ACHIEVEMENTS = [
  { code: 'first_close', name: 'First close', description: 'Win your first deal.', icon: 'key' },
  { code: 'closer_5', name: 'Closer', description: 'Win 5 deals.', icon: 'trophy' },
  { code: 'million_month', name: 'Million month', description: 'Close AED 1,000,000+ in one calendar month.', icon: 'tower' },
  { code: 'viewing_pro', name: 'Viewing pro', description: 'Complete 10 viewings.', icon: 'door' },
  { code: 'task_master', name: 'Reliable', description: 'Have 10 tasks approved by your manager.', icon: 'check' },
  { code: 'punctual', name: 'Ahead of time', description: 'Submit 5 approved tasks before their due time.', icon: 'clock' },
  { code: 'pipeline_builder', name: 'Pipeline builder', description: 'Open 10 deals.', icon: 'layers' },
  { code: 'streak_5', name: 'Five-day streak', description: 'Earn points on 5 consecutive days.', icon: 'flame' },
];

/** Awards points once per (user, source). Returns the awarded amount (0 if duplicate or capped). */
export async function award(ctx, user, sourceType, sourceId, points, reason, at = nowIso()) {
  if (!user || points <= 0) return 0;
  let pts = points;
  if (sourceType === 'activity') {
    const day = at.slice(0, 10);
    const used = (await ctx.db.get(`SELECT COALESCE(SUM(points),0) s FROM points_ledger WHERE user_id = ? AND source_type = 'activity' AND substr(at,1,10) = ?`, user.id, day)).s;
    pts = Math.max(0, Math.min(points, DAILY_ACTIVITY_CAP - used));
    if (pts === 0) return 0;
  }
  const r = await ctx.db.run(
    `INSERT INTO points_ledger(id, tenant_id, user_id, source_type, source_id, points, reason, at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, source_type, source_id) DO NOTHING`,
    uuidv7(), user.tenant_id, user.id, sourceType, sourceId, pts, reason, at);
  if (r.changes === 0) return 0;
  ctx.hub?.send(user.id, 'points', { points: pts, reason });
  await evaluateAchievements(ctx, user);
  return pts;
}

/** Consecutive-day streak ending at the most recent active day. `days` are 'YYYY-MM-DD' strings. */
export function longestStreak(days) {
  const sorted = [...new Set(days)].sort();
  let best = 0, cur = 0, prev = null;
  for (const d of sorted) {
    const t = Date.parse(d + 'T00:00:00Z');
    cur = prev !== null && t - prev === 86400000 ? cur + 1 : 1;
    best = Math.max(best, cur); prev = t;
  }
  return best;
}

export async function achievementProgress(db, userId) {
  const one = async (sql, ...p) => (await db.get(sql, ...p))?.n ?? 0;
  const won = await one(`SELECT COUNT(*) n FROM deals WHERE owner_id = ? AND stage = 'won'`, userId);
  const bestMonth = await one(`SELECT COALESCE(MAX(v),0) n FROM (SELECT SUM(value) v FROM deals WHERE owner_id = ? AND stage = 'won' AND currency = 'AED' GROUP BY substr(closed_at,1,7)) monthly`, userId);
  const viewings = await one(`SELECT COUNT(*) n FROM events WHERE organizer_id = ? AND type = 'viewing' AND status = 'completed'`, userId);
  const approved = await one(`SELECT COUNT(*) n FROM tasks WHERE assignee_id = ? AND status = 'approved'`, userId);
  const onTime = await one(`SELECT COUNT(*) n FROM tasks WHERE assignee_id = ? AND status = 'approved' AND due_at IS NOT NULL AND submitted_at <= due_at`, userId);
  const opened = await one(`SELECT COUNT(*) n FROM deals WHERE owner_id = ?`, userId);
  const days = (await db.all(`SELECT DISTINCT substr(at,1,10) d FROM points_ledger WHERE user_id = ?`, userId)).map((r) => r.d);
  const streak = longestStreak(days);
  return {
    first_close: [won, 1], closer_5: [won, 5], million_month: [bestMonth, 100_000_000],
    viewing_pro: [viewings, 10], task_master: [approved, 10], punctual: [onTime, 5],
    pipeline_builder: [opened, 10], streak_5: [streak, 5],
  };
}

export async function evaluateAchievements(ctx, user) {
  const prog = await achievementProgress(ctx.db, user.id);
  const earned = [];
  for (const a of ACHIEVEMENTS) {
    const [v, target] = prog[a.code];
    if (v < target) continue;
    const r = await ctx.db.run('INSERT INTO user_achievements(user_id, code, earned_at) VALUES (?,?,?) ON CONFLICT DO NOTHING', user.id, a.code, nowIso());
    if (r.changes === 0) continue;
    earned.push(a.code);
    await notify(ctx, user.id, { type: 'achievement', title: `Achievement unlocked: ${a.name}`, body: a.description, link: '#/leaderboard', dedupeKey: `ach:${a.code}` });
    // Celebrate in the company channel.
    const general = await ctx.db.get(`SELECT id FROM channels WHERE tenant_id = ? AND kind = 'public' ORDER BY created_at LIMIT 1`, user.tenant_id);
    if (general && ctx.postSystemMessage) await ctx.postSystemMessage(general.id, `${user.name} unlocked “${a.name}” — ${a.description}`);
  }
  return earned;
}
