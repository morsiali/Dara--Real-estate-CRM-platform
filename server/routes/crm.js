// CRM: leads, contacts, properties, deals (opportunities), activities, matching.
import { notFound, forbidden, conflict, badRequest, respond } from '../http.js';
import { uuidv7, nowIso, json } from '../db.js';
import { validator } from '../validate.js';
import { canOnOwner, ownerFilter, requireOwner as requirePerm, scopeOf, isManagement } from '../rbac.js';
import { leadTransition, dealTransition, roundRobinNext, matchProperties, brnBlocked, LEAD_STATUSES, DEAL_STAGES } from '../services/rules.js';
import { notify, audit, managementIds } from '../services/notify.js';
import { award, POINT_RULES } from '../services/gamification.js';
import { checkLimit } from '../services/billing.js';

const PROPERTY_TYPES = ['apartment', 'villa', 'townhouse', 'penthouse', 'office', 'retail', 'land'];
const SOURCES = ['manual', 'website', 'portal', 'referral', 'walk_in', 'phone', 'social', 'event'];
const fmtAed = (minor) => `AED ${Math.round(minor / 100).toLocaleString('en-US')}`;

export function registerCrm(router, ctx) {
  const { db } = ctx;

  const loadLead = async (user, id) => {
    const l = await db.get(`SELECT l.*, c.first_name, c.last_name, c.email, c.phone, c.roles, u.name owner_name
      FROM leads l JOIN contacts c ON c.id = l.contact_id LEFT JOIN users u ON u.id = l.owner_id WHERE l.id = ? AND l.tenant_id = ?`, id, user.tenant_id);
    if (!l || !await canOnOwner(db, user, 'leads.read', l.owner_id)) throw notFound('Lead'); // 404, not 403: don't reveal existence
    return l;
  };
  const shapeLead = (l) => ({ ...l, property_types: json.parse(l.property_types), locations: json.parse(l.locations), roles: json.parse(l.roles, ['buyer']) });
  const userInTenant = async (user, id) => { const u = await db.get('SELECT * FROM users WHERE id = ? AND tenant_id = ? AND active = 1', id, user.tenant_id); if (!u) throw badRequest('Choose an active team member.', { owner_id: 'is not an active user' }); return u; };

  async function recordLeadStatus(lead, to, actor, reason) {
    await db.run('INSERT INTO lead_status_history(id, lead_id, from_status, to_status, actor_id, owner_id, reason, at) VALUES (?,?,?,?,?,?,?,?)',
      uuidv7(), lead.id, lead.status, to, actor.id, lead.owner_id, reason ?? null, nowIso());
  }

  async function assignLead(lead, toUser, actor, method) {
    await db.run('UPDATE leads SET owner_id = ?, team_id = COALESCE(?, team_id), updated_at = ? WHERE id = ?', toUser.id, toUser.team_id, nowIso(), lead.id);
    await db.run('INSERT INTO lead_assignments(id, lead_id, from_user_id, to_user_id, actor_id, method, at) VALUES (?,?,?,?,?,?,?)', uuidv7(), lead.id, lead.owner_id, toUser.id, actor.id, method, nowIso());
    if (toUser.id !== actor.id) await notify(ctx, toUser.id, { type: 'lead_assigned', title: 'New lead assigned to you', body: lead.name || 'Open it to make first contact.', link: `#/leads/${lead.id}`, dedupeKey: `lead_assigned:${lead.id}:${toUser.id}` });
    await audit(ctx, actor, 'lead.assigned', 'lead', lead.id, { from: lead.owner_id, to: toUser.id, method });
  }

  /* ---------------- Leads ---------------- */
  router.get('/api/leads', async (req) => {
    const f = await ownerFilter(db, req.user, 'leads.read', 'l.owner_id');
    const where = [`l.tenant_id = ?`, f.sql]; const params = [req.user.tenant_id, ...f.params];
    if (req.query.status && LEAD_STATUSES.includes(req.query.status)) { where.push('l.status = ?'); params.push(req.query.status); }
    if (req.query.owner) { where.push('l.owner_id = ?'); params.push(req.query.owner); }
    if (req.query.q) { where.push(`(c.first_name || ' ' || c.last_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)`); const q = `%${req.query.q}%`; params.push(q, q, q); }
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const rows = await db.all(`SELECT l.*, c.first_name, c.last_name, c.email, c.phone, c.roles, u.name owner_name, u.color owner_color FROM leads l
      JOIN contacts c ON c.id = l.contact_id LEFT JOIN users u ON u.id = l.owner_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT ?`, ...params, limit);
    return { items: rows.map(shapeLead) };
  });

  router.post('/api/leads', async (req) => {
    const v = validator(req.body)
      .str('first_name', { required: true, max: 80 }).str('last_name', { max: 80 }).str('email', { max: 160 }).str('phone', { max: 40 })
      .oneOf('source', SOURCES).str('campaign', { max: 120 }).oneOf('transaction_type', ['buy', 'rent'])
      .int('budget_max', { min: 0, max: 1e13 }).list('property_types', { values: PROPERTY_TYPES }).list('locations', { max: 10 })
      .int('bedrooms_min', { min: 0, max: 20 }).str('notes', { max: 4000 }).str('owner_id', { max: 60 }).oneOf('assign', ['self', 'manual', 'round_robin'])
      .check(req.body.email || req.body.phone, 'phone', 'Add a phone number or an email').done();
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) throw badRequest('Email address looks wrong.', { email: 'is not a valid email' });
    const actor = req.user;
    // Decide owner.
    let owner = actor; let method = 'self';
    if (v.assign === 'round_robin') {
      if (scopeOf(actor, 'leads.assign') === 'None') throw forbidden('Only team leads and management can use round-robin assignment.');
      const teamId = req.body.team_id || actor.team_id;
      if (!teamId) throw badRequest('Choose a team for round-robin.', { team_id: 'is required' });
      const team = await db.get('SELECT * FROM teams WHERE id = ? AND tenant_id = ?', teamId, actor.tenant_id);
      if (!team || (scopeOf(actor, 'leads.assign') === 'Team' && team.id !== actor.team_id)) throw forbidden('You can only assign within your team.');
      const eligible = (await db.all(`SELECT id, brn_expiry FROM users WHERE team_id = ? AND active = 1 AND role = 'agent'`, team.id))
        .filter((u) => !brnBlocked(req.tenant, u)).map((r) => r.id); // expired-BRN policy: skipped, never assigned
      const next = roundRobinNext(eligible, team.rr_last_user_id);
      if (!next) throw conflict('NO_ELIGIBLE_AGENT', 'This team has no active agents to assign to.');
      owner = await userInTenant(actor, next); method = 'round_robin';
      await db.run('UPDATE teams SET rr_last_user_id = ? WHERE id = ?', next, team.id);
    } else if (v.owner_id && v.owner_id !== actor.id) {
      const target = await userInTenant(actor, v.owner_id);
      if (!await canOnOwner(db, actor, 'leads.assign', target.id)) throw forbidden('You can’t assign leads to that person.');
      if (brnBlocked(req.tenant, target)) throw conflict('BRN_EXPIRED', `${target.name}’s broker card (BRN) has expired. Your workspace blocks new assignments until it’s renewed.`);
      owner = target; method = 'manual';
    }
    const at = nowIso(); const contactId = uuidv7(); const leadId = uuidv7();
    await db.tx(async () => {
      await db.run('INSERT INTO contacts(id, tenant_id, owner_id, first_name, last_name, email, phone, roles, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        contactId, actor.tenant_id, owner.id, v.first_name, v.last_name ?? '', v.email ?? null, v.phone ?? null, json.str([v.transaction_type === 'rent' ? 'tenant' : 'buyer']), at);
      await db.run(`INSERT INTO leads(id, tenant_id, contact_id, owner_id, team_id, status, source, campaign, transaction_type, budget_max, currency, property_types, locations, bedrooms_min, notes, created_at, updated_at)
        VALUES (?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?,?,?)`, leadId, actor.tenant_id, contactId, null, owner.team_id, v.source ?? 'manual', v.campaign ?? null,
        v.transaction_type ?? 'buy', v.budget_max ?? null, 'AED', json.str(v.property_types), json.str(v.locations), v.bedrooms_min ?? null, v.notes ?? null, at, at);
      await db.run('INSERT INTO lead_status_history(id, lead_id, from_status, to_status, actor_id, owner_id, at) VALUES (?,?,?,?,?,?,?)', uuidv7(), leadId, null, 'new', actor.id, owner.id, at);
      await assignLead({ id: leadId, owner_id: null, name: `${v.first_name} ${v.last_name ?? ''}`.trim() }, owner, actor, method);
      await audit(ctx, actor, 'lead.created', 'lead', leadId, { source: v.source ?? 'manual' });
    });
    return respond(201, { item: shapeLead(await loadLead(actor, leadId)) });
  });

  router.get('/api/leads/:id', async (req) => {
    const l = await loadLead(req.user, req.params.id);
    const history = await db.all(`SELECT h.*, u.name actor_name FROM lead_status_history h LEFT JOIN users u ON u.id = h.actor_id WHERE lead_id = ? ORDER BY at`, l.id);
    const assignments = await db.all(`SELECT a.*, f.name from_name, t.name to_name, x.name actor_name FROM lead_assignments a LEFT JOIN users f ON f.id = a.from_user_id
      LEFT JOIN users t ON t.id = a.to_user_id LEFT JOIN users x ON x.id = a.actor_id WHERE lead_id = ? ORDER BY at`, l.id);
    const activities = await db.all(`SELECT a.*, u.name user_name FROM activities a JOIN users u ON u.id = a.user_id WHERE a.lead_id = ? OR a.contact_id = ? ORDER BY occurred_at DESC LIMIT 100`, l.id, l.contact_id);
    const deals = await db.all(`SELECT id, title, stage, value, currency FROM deals WHERE lead_id = ?`, l.id);
    return { item: shapeLead(l), history, assignments, activities, deals };
  });

  router.patch('/api/leads/:id', async (req) => {
    const l = await loadLead(req.user, req.params.id);
    await requirePerm(db, req.user, 'leads.update', l.owner_id);
    const v = validator(req.body).oneOf('transaction_type', ['buy', 'rent']).int('budget_max', { min: 0, max: 1e13 }).list('property_types', { values: PROPERTY_TYPES })
      .list('locations', { max: 10 }).int('bedrooms_min', { min: 0, max: 20 }).str('notes', { max: 4000 }).str('campaign', { max: 120 }).done();
    const sets = []; const params = [];
    for (const [k, val] of Object.entries(v)) { sets.push(`${k} = ?`); params.push(Array.isArray(val) ? json.str(val) : val); }
    if (sets.length) await db.run(`UPDATE leads SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, nowIso(), l.id);
    await audit(ctx, req.user, 'lead.updated', 'lead', l.id, v);
    return { item: shapeLead(await loadLead(req.user, l.id)) };
  });

  router.post('/api/leads/:id/status', async (req) => {
    const l = await loadLead(req.user, req.params.id);
    await requirePerm(db, req.user, 'leads.update', l.owner_id);
    const { status, reason } = validator(req.body).str('status', { required: true }).str('reason', { max: 500 }).done();
    if (status === 'converted') throw badRequest('Use “Convert to deal” to convert a lead.');
    const t = leadTransition(l.status, status, { reason });
    if (!t.ok) throw conflict(t.code, t.message);
    const at = nowIso();
    await db.tx(async () => {
      await recordLeadStatus(l, status, req.user, reason);
      await db.run(`UPDATE leads SET status = ?, disqualify_reason = ?, first_contact_at = COALESCE(first_contact_at, CASE WHEN ? IN ('contacted','qualified') THEN ? END), updated_at = ? WHERE id = ?`,
        status, status === 'disqualified' ? reason : null, status, at, at, l.id);
      if (status === 'qualified' && l.owner_id) await award(ctx, await db.get('SELECT * FROM users WHERE id = ?', l.owner_id), 'lead_qualified', l.id, POINT_RULES.lead_qualified, 'Lead qualified');
      await audit(ctx, req.user, 'lead.status_changed', 'lead', l.id, { from: l.status, to: status, reason });
    });
    return { item: shapeLead(await loadLead(req.user, l.id)) };
  });

  router.post('/api/leads/:id/assign', async (req) => {
    const l = await loadLead(req.user, req.params.id);
    const { owner_id } = validator(req.body).str('owner_id', { required: true }).done();
    const target = await userInTenant(req.user, owner_id);
    if (!await canOnOwner(db, req.user, 'leads.assign', l.owner_id) || !await canOnOwner(db, req.user, 'leads.assign', target.id)) throw forbidden('You can’t reassign this lead to that person.');
    if (brnBlocked(req.tenant, target)) throw conflict('BRN_EXPIRED', `${target.name}’s broker card (BRN) has expired. Your workspace blocks new assignments until it’s renewed.`);
    if (target.id === l.owner_id) throw conflict('NO_CHANGE', 'The lead already belongs to that person.');
    await db.tx(async () => await assignLead({ ...l, name: `${l.first_name} ${l.last_name}`.trim() }, target, req.user, 'manual'));
    await db.run('UPDATE contacts SET owner_id = ? WHERE id = ?', target.id, l.contact_id);
    return { item: shapeLead(await loadLead(req.user, l.id)) };
  });

  router.post('/api/leads/:id/convert', async (req) => {
    const l = await loadLead(req.user, req.params.id);
    await requirePerm(db, req.user, 'leads.update', l.owner_id);
    const t = leadTransition(l.status, 'converted');
    if (!t.ok) throw conflict(t.code, l.status === 'converted' ? 'This lead is already converted.' : 'Qualify the lead before converting it to a deal.');
    const v = validator(req.body).str('title', { max: 160 }).str('property_id', { max: 60 }).int('value', { min: 0, max: 1e13 }).done();
    if (v.property_id && !await db.get('SELECT id FROM properties WHERE id = ? AND tenant_id = ?', v.property_id, req.user.tenant_id)) throw badRequest('Choose an existing property.', { property_id: 'not found' });
    const id = uuidv7(); const at = nowIso();
    await db.tx(async () => {
      await db.run(`INSERT INTO deals(id, tenant_id, title, contact_id, lead_id, property_id, owner_id, stage, value, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'new',?,?,?,?)`,
        id, req.user.tenant_id, v.title || `${l.first_name} ${l.last_name} — ${l.transaction_type === 'rent' ? 'rental' : 'purchase'}`.trim(), l.contact_id, l.id, v.property_id ?? null, l.owner_id, v.value ?? 0, l.currency, at, at);
      await db.run('INSERT INTO deal_stage_history(id, deal_id, from_stage, to_stage, actor_id, at) VALUES (?,?,?,?,?,?)', uuidv7(), id, null, 'new', req.user.id, at);
      await recordLeadStatus(l, 'converted', req.user);
      await db.run(`UPDATE leads SET status = 'converted', updated_at = ? WHERE id = ?`, at, l.id);
      if (l.owner_id) await award(ctx, await db.get('SELECT * FROM users WHERE id = ?', l.owner_id), 'lead_converted', l.id, POINT_RULES.lead_converted, 'Lead converted to deal');
      await audit(ctx, req.user, 'lead.converted', 'lead', l.id, { deal_id: id });
    });
    return respond(201, { deal_id: id });
  });

  router.get('/api/leads/:id/matches', async (req) => {
    const l = shapeLead(await loadLead(req.user, req.params.id));
    const props = await db.all('SELECT * FROM properties WHERE tenant_id = ?', req.user.tenant_id);
    const matches = matchProperties(l, props, { includeUnverified: req.query.includeUnverified === '1', fmt: fmtAed }).slice(0, 20);
    return { items: matches.map((m) => ({ ...m, property: { ...m.property } })), criteria: { budget_max: l.budget_max, property_types: l.property_types, locations: l.locations, bedrooms_min: l.bedrooms_min, transaction_type: l.transaction_type } };
  });

  /* ---------------- Contacts (read-only list; created with leads) ---------------- */
  router.get('/api/contacts', async (req) => {
    const f = await ownerFilter(db, req.user, 'leads.read', 'c.owner_id');
    const q = req.query.q ? `%${req.query.q}%` : null;
    const rows = await db.all(`SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.owner_id, u.name owner_name FROM contacts c LEFT JOIN users u ON u.id = c.owner_id
      WHERE c.tenant_id = ? AND ${f.sql} ${q ? `AND (c.first_name || ' ' || c.last_name LIKE ? OR c.phone LIKE ?)` : ''} ORDER BY c.first_name LIMIT 300`,
      req.user.tenant_id, ...f.params, ...(q ? [q, q] : []));
    return { items: rows };
  });

  /* ---------------- Properties ---------------- */
  router.get('/api/properties', async (req) => {
    const where = ['p.tenant_id = ?']; const params = [req.user.tenant_id];
    for (const k of ['status', 'type', 'listing_type', 'authority', 'project_id']) if (req.query[k]) { where.push(`p.${k} = ?`); params.push(req.query[k]); }
    if (req.query.mine === '1') { where.push('p.agent_id = ?'); params.push(req.user.id); }
    if (req.query.q) { where.push('(p.title LIKE ? OR p.community LIKE ? OR p.ref LIKE ? OR p.project LIKE ?)'); const q = `%${req.query.q}%`; params.push(q, q, q, q); }
    const rows = await db.all(`SELECT p.*, u.name agent_name, pr.name project_name,
        r.id reservation_id, r.status reservation_status, r.expires_at reservation_expires_at, ru.name reservation_agent
      FROM properties p LEFT JOIN users u ON u.id = p.agent_id LEFT JOIN projects pr ON pr.id = p.project_id
      LEFT JOIN reservations r ON r.property_id = p.id AND r.status IN ('held','pending_confirmation','confirmed') LEFT JOIN users ru ON ru.id = r.agent_id
      WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 500`, ...params);
    return { items: await Promise.all(rows.map(async (p) => ({ ...p, can_edit: await canOnOwner(db, req.user, 'properties.update', p.agent_id) }))) };
  });

  const propertyValidator = (body, required) => validator(body)
    .str('title', { required, max: 160 }).oneOf('type', PROPERTY_TYPES, { required }).oneOf('listing_type', ['sale', 'rent'], { required })
    .int('price', { required, min: 1, max: 1e13 }).int('bedrooms', { min: 0, max: 30 }).int('bathrooms', { min: 0, max: 30 }).int('area_sqft', { min: 1, max: 10_000_000 })
    .str('community', { max: 120 }).str('project', { max: 120 }).str('developer', { max: 120 }).str('city', { max: 60 })
    .oneOf('completion', ['ready', 'off_plan']).oneOf('authority', ['platform', 'external', 'unverified']).str('permit_no', { max: 60 }).date('permit_expiry')
    .oneOf('status', ['available', 'sold', 'rented', 'off_market']).str('agent_id', { max: 60 }).str('project_id', { max: 60 });
  const loadProject = async (user, id) => { const pr = await db.get('SELECT * FROM projects WHERE id = ? AND tenant_id = ?', id, user.tenant_id); if (!pr) throw badRequest('Choose an existing project.', { project_id: 'not found' }); return pr; };

  router.post('/api/properties', async (req) => {
    if (['on_hold', 'reserved'].includes(req.body?.status)) throw conflict('USE_RESERVATIONS', 'Holds and reservations are made from the Reservations flow.');
    const v = propertyValidator(req.body, true).done();
    if ((v.status ?? 'available') === 'available') await checkLimit(db, req.tenant, 'listings');
    const agentId = v.agent_id && v.agent_id !== req.user.id ? v.agent_id : req.user.id;
    if (agentId !== req.user.id) { await userInTenant(req.user, agentId); await requirePerm(db, req.user, 'properties.update', agentId); }
    const project = v.project_id ? await loadProject(req.user, v.project_id) : null;
    const id = uuidv7(); const at = nowIso();
    const n = (await db.get('SELECT COUNT(*) n FROM properties WHERE tenant_id = ?', req.user.tenant_id)).n + 1;
    const ref = `DR-${String(n).padStart(5, '0')}`;
    // BR-090: a project's authority decides who controls availability for its units, unless the listing is an unverified import.
    const authority = v.authority === 'unverified' ? 'unverified' : project ? project.authority : (v.authority ?? 'platform');
    await db.run(`INSERT INTO properties(id, tenant_id, ref, title, type, listing_type, status, price, currency, bedrooms, bathrooms, area_sqft, community, project, developer, city, completion, authority, availability_confidence, last_verified_at, permit_no, agent_id, created_at, updated_at, project_id, permit_expiry)
      VALUES (?,?,?,?,?,?,?,?,'AED',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, req.user.tenant_id, ref, v.title, v.type, v.listing_type, v.status ?? 'available', v.price,
      v.bedrooms ?? null, v.bathrooms ?? null, v.area_sqft ?? null, v.community ?? project?.community ?? null, project?.name ?? v.project ?? null, project?.developer ?? v.developer ?? null,
      v.city ?? project?.city ?? 'Dubai', project?.completion ?? v.completion ?? 'ready',
      authority, authority === 'unverified' ? 'unverified' : 'confirmed', authority === 'unverified' ? null : at, v.permit_no ?? null, agentId, at, at, project?.id ?? null, v.permit_expiry ?? null);
    await audit(ctx, req.user, 'property.created', 'property', id, { ref, authority, project: project?.name });
    return respond(201, { item: await db.get('SELECT * FROM properties WHERE id = ?', id) });
  });

  router.patch('/api/properties/:id', async (req) => {
    const p = await db.get('SELECT * FROM properties WHERE id = ? AND tenant_id = ?', req.params.id, req.user.tenant_id);
    if (!p) throw notFound('Property');
    await requirePerm(db, req.user, 'properties.update', p.agent_id);
    if (['on_hold', 'reserved'].includes(req.body?.status)) throw conflict('USE_RESERVATIONS', 'Holds and reservations are made from the Reservations flow.');
    const v = propertyValidator(req.body, false).bool('verify').done();
    const verify = v.verify; delete v.verify;
    if (v.agent_id) { await userInTenant(req.user, v.agent_id); await requirePerm(db, req.user, 'properties.update', v.agent_id); }
    const active = await db.get(`SELECT id FROM reservations WHERE property_id = ? AND status IN ('held','pending_confirmation','confirmed')`, p.id);
    if (v.status && active) throw conflict('ACTIVE_RESERVATION', 'This unit has an active reservation. Cancel or complete it first.');
    if (v.status === 'available' && p.status !== 'available') await checkLimit(db, req.tenant, 'listings');
    const projectId = v.project_id !== undefined ? v.project_id : p.project_id;
    const project = projectId ? await loadProject(req.user, projectId) : null;
    if (project) {
      // Authority comes from the project (BR-090); only "verify" (unverified → project authority) is allowed.
      if (v.authority && v.authority !== 'unverified' && v.authority !== project.authority && !(verify && p.authority === 'unverified')) throw conflict('AUTHORITY_FROM_PROJECT', `Availability for ${project.name} is set on the project.`);
      if (v.project_id || (verify && p.authority === 'unverified')) v.authority = project.authority;
      if (v.project_id) { v.project = project.name; v.developer = v.developer ?? project.developer; }
    }
    const sets = Object.keys(v).map((k) => `${k} = ?`); const params = Object.values(v);
    if (verify) { sets.push(`availability_confidence = 'confirmed'`, 'last_verified_at = ?'); params.push(nowIso()); }
    if (sets.length) await db.run(`UPDATE properties SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, nowIso(), p.id);
    await audit(ctx, req.user, 'property.updated', 'property', p.id, { ...v, verify });
    return { item: await db.get('SELECT * FROM properties WHERE id = ?', p.id) };
  });

  /* ---------------- Deals ---------------- */
  const loadDeal = async (user, id) => {
    const d = await db.get(`SELECT d.*, c.first_name || ' ' || c.last_name contact_name, c.phone contact_phone, p.title property_title, p.ref property_ref, u.name owner_name, u.color owner_color
      FROM deals d JOIN contacts c ON c.id = d.contact_id LEFT JOIN properties p ON p.id = d.property_id LEFT JOIN users u ON u.id = d.owner_id WHERE d.id = ? AND d.tenant_id = ?`, id, user.tenant_id);
    if (!d || !await canOnOwner(db, user, 'deals.read', d.owner_id)) throw notFound('Deal');
    return d;
  };

  router.get('/api/deals', async (req) => {
    const f = await ownerFilter(db, req.user, 'deals.read', 'd.owner_id');
    const where = ['d.tenant_id = ?', f.sql]; const params = [req.user.tenant_id, ...f.params];
    if (req.query.stage && DEAL_STAGES.includes(req.query.stage)) { where.push('d.stage = ?'); params.push(req.query.stage); }
    if (req.query.owner) { where.push('d.owner_id = ?'); params.push(req.query.owner); }
    if (req.query.open === '1') where.push(`d.stage NOT IN ('won','lost')`);
    const rows = await db.all(`SELECT d.*, c.first_name || ' ' || c.last_name contact_name, p.title property_title, p.ref property_ref, u.name owner_name, u.color owner_color
      FROM deals d JOIN contacts c ON c.id = d.contact_id LEFT JOIN properties p ON p.id = d.property_id LEFT JOIN users u ON u.id = d.owner_id
      WHERE ${where.join(' AND ')} ORDER BY d.updated_at DESC LIMIT 500`, ...params);
    return { items: rows };
  });

  router.post('/api/deals', async (req) => {
    const v = validator(req.body).str('title', { required: true, max: 160 }).str('contact_id', { required: true }).str('property_id').int('value', { min: 0, max: 1e13 })
      .int('commission_bp', { min: 0, max: 2000 }).date('expected_close').str('owner_id').done();
    const contact = await db.get('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?', v.contact_id, req.user.tenant_id);
    if (!contact || !await canOnOwner(db, req.user, 'leads.read', contact.owner_id)) throw badRequest('Choose one of your contacts.', { contact_id: 'not found' });
    if (v.property_id && !await db.get('SELECT id FROM properties WHERE id = ? AND tenant_id = ?', v.property_id, req.user.tenant_id)) throw badRequest('Choose an existing property.', { property_id: 'not found' });
    const ownerId = v.owner_id || req.user.id;
    if (ownerId !== req.user.id) { await userInTenant(req.user, ownerId); await requirePerm(db, req.user, 'deals.update', ownerId); }
    const id = uuidv7(); const at = nowIso();
    await db.tx(async () => {
      await db.run(`INSERT INTO deals(id, tenant_id, title, contact_id, property_id, owner_id, stage, value, currency, commission_bp, expected_close, created_at, updated_at) VALUES (?,?,?,?,?,?,'new',?,'AED',?,?,?,?)`,
        id, req.user.tenant_id, v.title, v.contact_id, v.property_id ?? null, ownerId, v.value ?? 0, v.commission_bp ?? 200, v.expected_close ?? null, at, at);
      await db.run('INSERT INTO deal_stage_history(id, deal_id, from_stage, to_stage, actor_id, at) VALUES (?,?,?,?,?,?)', uuidv7(), id, null, 'new', req.user.id, at);
      await audit(ctx, req.user, 'deal.created', 'deal', id);
    });
    return respond(201, { item: await loadDeal(req.user, id) });
  });

  router.get('/api/deals/:id', async (req) => {
    const d = await loadDeal(req.user, req.params.id);
    const history = await db.all(`SELECT h.*, u.name actor_name FROM deal_stage_history h LEFT JOIN users u ON u.id = h.actor_id WHERE deal_id = ? ORDER BY at`, d.id);
    const activities = await db.all(`SELECT a.*, u.name user_name FROM activities a JOIN users u ON u.id = a.user_id WHERE a.deal_id = ? ORDER BY occurred_at DESC`, d.id);
    const events = await db.all(`SELECT id, title, type, start_at, status FROM events WHERE deal_id = ? ORDER BY start_at DESC`, d.id);
    return { item: d, history, activities, events };
  });

  router.patch('/api/deals/:id', async (req) => {
    const d = await loadDeal(req.user, req.params.id);
    await requirePerm(db, req.user, 'deals.update', d.owner_id);
    if (['won', 'lost'].includes(d.stage)) throw conflict('CLOSED_DEAL', 'Closed deals can’t be edited. Reopen it first.');
    const v = validator(req.body).str('title', { max: 160 }).str('property_id').int('value', { min: 0, max: 1e13 }).int('commission_bp', { min: 0, max: 2000 }).date('expected_close').done();
    if (v.property_id && !await db.get('SELECT id FROM properties WHERE id = ? AND tenant_id = ?', v.property_id, req.user.tenant_id)) throw badRequest('Choose an existing property.', { property_id: 'not found' });
    const sets = Object.keys(v).map((k) => `${k} = ?`);
    if (sets.length) await db.run(`UPDATE deals SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...Object.values(v), nowIso(), d.id);
    await audit(ctx, req.user, 'deal.updated', 'deal', d.id, v);
    return { item: await loadDeal(req.user, d.id) };
  });

  router.post('/api/deals/:id/stage', async (req) => {
    const d = await loadDeal(req.user, req.params.id);
    await requirePerm(db, req.user, 'deals.update', d.owner_id);
    const { stage, reason } = validator(req.body).str('stage', { required: true }).str('reason', { max: 500 }).done();
    const t = dealTransition(d, stage, { reason, isManagement: isManagement(req.user) });
    if (!t.ok) throw conflict(t.code, t.message);
    const at = nowIso(); const notes = [];
    await db.tx(async () => {
      const closing = stage === 'won' || stage === 'lost';
      await db.run(`UPDATE deals SET stage = ?, closed_at = ?, lost_reason = ?, updated_at = ? WHERE id = ?`, stage, closing ? at : null, stage === 'lost' ? reason : null, at, d.id);
      await db.run('INSERT INTO deal_stage_history(id, deal_id, from_stage, to_stage, actor_id, reason, at) VALUES (?,?,?,?,?,?,?)', uuidv7(), d.id, d.stage, stage, req.user.id, reason ?? null, at);
      await audit(ctx, req.user, t.reopen ? 'deal.reopened' : 'deal.stage_changed', 'deal', d.id, { from: d.stage, to: stage, reason });
      if (stage === 'won') {
        // BR-086: a unit held for someone else can't be sold through this deal; this deal's own hold converts.
        const res = d.property_id ? await db.get(`SELECT * FROM reservations WHERE property_id = ? AND status IN ('held','pending_confirmation','confirmed')`, d.property_id) : null;
        if (res && res.deal_id !== d.id) throw conflict('UNIT_RESERVED_ELSEWHERE', 'This unit is reserved for another deal. Cancel that reservation first.');
        if (res) { await db.run(`UPDATE reservations SET status = 'converted', expires_at = NULL, updated_at = ? WHERE id = ?`, at, res.id); notes.push('Reservation converted.'); }
        const owner = await db.get('SELECT * FROM users WHERE id = ?', d.owner_id);
        await award(ctx, owner, 'deal_won', d.id, POINT_RULES.deal_won, `Deal won: ${d.title}`);
        const p = await db.get('SELECT * FROM properties WHERE id = ?', d.property_id);
        if (p && p.authority === 'platform') {
          await db.run('UPDATE properties SET status = ?, updated_at = ? WHERE id = ?', p.listing_type === 'rent' ? 'rented' : 'sold', at, p.id);
          notes.push(`Listing ${p.ref} marked ${p.listing_type === 'rent' ? 'rented' : 'sold'}.`);
        } else if (p) notes.push(`Listing ${p.ref} is controlled externally — its status was not changed here.`);
        for (const id of await managementIds(db, req.user.tenant_id, owner?.team_id)) if (id !== req.user.id) {
          await notify(ctx, id, { type: 'deal_won', title: `${owner?.name ?? 'An agent'} won a deal`, body: `${d.title} · ${fmtAed(d.value)}`, link: `#/pipeline?deal=${d.id}`, dedupeKey: `deal_won:${d.id}` });
        }
        const general = await db.get(`SELECT id FROM channels WHERE tenant_id = ? AND kind = 'public' ORDER BY created_at LIMIT 1`, req.user.tenant_id);
        if (general) await ctx.postSystemMessage(general.id, `${owner?.name ?? 'The team'} closed “${d.title}” for ${fmtAed(d.value)}.`);
      }
    });
    return { item: await loadDeal(req.user, d.id), notes };
  });

  /* ---------------- Activities ---------------- */
  router.get('/api/activities', async (req) => {
    const f = await ownerFilter(db, req.user, 'leads.read', 'a.user_id');
    const params = [req.user.tenant_id, ...f.params]; let extra = '';
    if (req.query.user) { extra += ' AND a.user_id = ?'; params.push(req.query.user); }
    const rows = await db.all(`SELECT a.*, u.name user_name, c.first_name || ' ' || c.last_name contact_name FROM activities a JOIN users u ON u.id = a.user_id
      LEFT JOIN contacts c ON c.id = a.contact_id WHERE a.tenant_id = ? AND ${f.sql} ${extra} ORDER BY a.occurred_at DESC LIMIT 100`, ...params);
    return { items: rows };
  });

  router.post('/api/activities', async (req) => {
    const v = validator(req.body).oneOf('type', ['call', 'email', 'whatsapp', 'note'], { required: true }).str('summary', { required: true, max: 2000 })
      .str('lead_id').str('deal_id').int('duration_min', { min: 0, max: 600 }).date('occurred_at').done();
    let contactId = null;
    if (v.lead_id) { const l = await loadLead(req.user, v.lead_id); await requirePerm(db, req.user, 'leads.update', l.owner_id); contactId = l.contact_id; }
    if (v.deal_id) { const d = await loadDeal(req.user, v.deal_id); await requirePerm(db, req.user, 'deals.update', d.owner_id); contactId = d.contact_id; }
    const occurred = v.occurred_at && v.occurred_at <= nowIso() ? v.occurred_at : nowIso();
    const id = uuidv7();
    await db.run('INSERT INTO activities(id, tenant_id, user_id, type, contact_id, lead_id, deal_id, summary, duration_min, occurred_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, req.user.tenant_id, req.user.id, v.type, contactId, v.lead_id ?? null, v.deal_id ?? null, v.summary, v.duration_min ?? null, occurred, nowIso());
    if (v.lead_id && v.type !== 'note') await db.run(`UPDATE leads SET first_contact_at = COALESCE(first_contact_at, ?) WHERE id = ?`, occurred, v.lead_id);
    const pts = await award(ctx, req.user, 'activity', id, POINT_RULES.activity[v.type], `Logged ${v.type}`, occurred);
    return respond(201, { id, points: pts });
  });
}
