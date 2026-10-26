// Lead follow-up desk: deterministic triage plus one bounded AI plan for an authorized lead.
import { badRequest, conflict, notFound, HttpError } from '../http.js';
import { canOnOwner, ownerFilter } from '../rbac.js';
import { json, nowIso } from '../db.js';
import { matchProperties } from '../services/rules.js';
import { audit } from '../services/notify.js';
import { generateLeadPlan } from '../services/ai.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const openStatuses = "'new','contacted','qualified','nurturing'";
const msSince = (iso) => iso ? Math.max(0, Date.now() - Date.parse(iso)) : Infinity;

export function registerAi(router, ctx) {
  const { db, cfg } = ctx;
  const active = new Set();
  const client = cfg.aiClient || generateLeadPlan;

  router.get('/api/ai/status', () => ({ configured: !!(cfg.aiClient || cfg.openaiApiKey), model: cfg.aiModel || 'gpt-6-luna' }));

  router.get('/api/ai/queue', async (req) => {
    const filter = await ownerFilter(db, req.user, 'leads.read', 'l.owner_id');
    const rows = await db.all(`SELECT l.id, l.status, l.owner_id, l.created_at, l.first_contact_at,
      c.first_name, c.last_name, u.name owner_name,
      (SELECT MAX(a.occurred_at) FROM activities a WHERE a.tenant_id = l.tenant_id AND a.lead_id = l.id) last_activity_at,
      (SELECT MIN(t.due_at) FROM tasks t WHERE t.tenant_id = l.tenant_id AND t.related_type = 'lead' AND t.related_id = l.id
        AND t.status IN ('todo','in_progress','changes_requested')) next_task_due
      FROM leads l JOIN contacts c ON c.id = l.contact_id LEFT JOIN users u ON u.id = l.owner_id
      WHERE l.tenant_id = ? AND ${filter.sql} AND l.status IN (${openStatuses}) ORDER BY l.created_at DESC LIMIT 300`,
      req.user.tenant_id, ...filter.params);
    const now = Date.now();
    const items = rows.map((l) => {
      const untouched = l.status === 'new' && !l.first_contact_at && !l.last_activity_at;
      const age = msSince(l.last_activity_at || l.first_contact_at || l.created_at);
      const overdue = l.next_task_due && Date.parse(l.next_task_due) < now;
      const score = (untouched ? 100 : 0) + (overdue ? 45 : 0) + Math.min(40, Math.floor(age / DAY) * 8);
      const reason = untouched ? 'No first contact recorded' : overdue ? 'Follow-up task overdue' : age >= 3 * DAY ? 'No recent activity' : 'Ready for a next step';
      return { ...l, score, reason };
    }).sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at)).slice(0, 30);
    return { items };
  });

  // External I/O must not hold a PostgreSQL transaction or pool connection. This route opens short,
  // explicit tenant contexts around its database reads and audit write.
  router.post('/api/ai/leads/:id/plan', async (req) => {
    if (!cfg.aiClient && !cfg.openaiApiKey) throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI assistance is not configured for this server.');
    if (!['en', 'ar'].includes(req.body?.language ?? 'en')) throw badRequest('Choose English or Arabic.');
    const key = `${req.user.id}:${req.params.id}`;
    if (active.has(key)) throw conflict('AI_ALREADY_RUNNING', 'A plan for this lead is already being prepared.');
    active.add(key);
    try {
      const context = await db.withContext({ tenantId: req.user.tenant_id }, async () => {
        const recent = await db.get(`SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = ? AND actor_id = ?
          AND action = 'ai.plan_generated' AND at >= ?`, req.user.tenant_id, req.user.id, new Date(Date.now() - DAY).toISOString());
        if (Number(recent?.n || 0) >= 30) throw new HttpError(429, 'AI_DAILY_LIMIT', 'You have used today’s 30 AI plans. Try again tomorrow.');
        const l = await db.get(`SELECT l.*, c.first_name, c.last_name FROM leads l
          JOIN contacts c ON c.id = l.contact_id WHERE l.id = ? AND l.tenant_id = ?`, req.params.id, req.user.tenant_id);
        if (!l || !await canOnOwner(db, req.user, 'leads.read', l.owner_id)) throw notFound('Lead');
        if (!['new', 'contacted', 'qualified', 'nurturing'].includes(l.status)) throw conflict('LEAD_CLOSED', 'This lead no longer needs an open-lead follow-up plan.');
        const activities = await db.all(`SELECT type, summary, occurred_at FROM activities WHERE tenant_id = ? AND lead_id = ?
          ORDER BY occurred_at DESC LIMIT 12`, req.user.tenant_id, l.id);
        const tasks = await db.all(`SELECT title, status, due_at FROM tasks WHERE tenant_id = ? AND related_type = 'lead' AND related_id = ?
          AND status IN ('todo','in_progress','changes_requested') ORDER BY due_at LIMIT 5`, req.user.tenant_id, l.id);
        const properties = await db.all('SELECT * FROM properties WHERE tenant_id = ?', req.user.tenant_id);
        const shaped = { ...l, property_types: json.parse(l.property_types), locations: json.parse(l.locations) };
        const matches = matchProperties(shaped, properties, { fmt: (minor) => `AED ${Math.round(minor / 100).toLocaleString('en-US')}` })
          .filter((m) => m.property.availability_confidence === 'confirmed').slice(0, 3)
          .map((m) => ({ ref: m.property.ref, title: m.property.title, community: m.property.community,
            price_aed: Math.round(m.property.price / 100), bedrooms: m.property.bedrooms,
            authority: m.property.authority, reasons: m.reasons }));
        return {
          lead: { first_name: String(l.first_name || '').slice(0, 80), status: l.status, transaction_type: l.transaction_type,
            budget_aed: l.budget_max == null ? null : Math.round(l.budget_max / 100), property_types: shaped.property_types,
            locations: shaped.locations, bedrooms_min: l.bedrooms_min, notes: String(l.notes || '').slice(0, 1200),
            created_at: l.created_at, first_contact_at: l.first_contact_at },
          activities: activities.map((a) => ({ ...a, summary: String(a.summary).slice(0, 500) })),
          tasks: tasks.map((t) => ({ ...t, title: String(t.title).slice(0, 160) })), matches,
          today_dubai: new Date(Date.now() + 4 * HOUR).toISOString().slice(0, 10),
          time_dubai: new Date(Date.now() + 4 * HOUR).toISOString().slice(11, 16),
        };
      });
      const plan = await client({ apiKey: cfg.openaiApiKey, model: cfg.aiModel || 'gpt-6-luna', context, language: req.body.language || 'en' });
      await db.withContext({ tenantId: req.user.tenant_id }, () => audit(ctx, req.user, 'ai.plan_generated', 'lead', req.params.id,
        { model: cfg.aiModel || 'gpt-6-luna' }));
      return { plan, lead_id: req.params.id, generated_at: nowIso() };
    } finally { active.delete(key); }
  }, { externalIo: true });
}
