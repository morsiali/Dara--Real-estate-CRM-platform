// Projects (availability authority), reservations (E2) and Dubai compliance reminders (Part G — all rules [Verify]).
import { respond, notFound, forbidden, conflict, badRequest } from '../http.js';
import { uuidv7, nowIso } from '../db.js';
import { validator } from '../validate.js';
import { canOnOwner, ownerFilter, requireScope, isManagement, scopeOf, visibleUserIds } from '../rbac.js';
import { reservationTransition, RESERVATION_ACTIVE, HOLD_HOURS, MAX_RENEWALS } from '../services/rules.js';
import { notify, audit, managementIds } from '../services/notify.js';

const RES_SELECT = `SELECT r.*, p.ref property_ref, p.title property_title, p.price property_price, p.status property_status, pr.name project_name,
  u.name agent_name, u.color agent_color, t.name team_name, c.first_name || ' ' || c.last_name contact_name, d.title deal_title
  FROM reservations r JOIN properties p ON p.id = r.property_id LEFT JOIN projects pr ON pr.id = p.project_id JOIN users u ON u.id = r.agent_id
  LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN contacts c ON c.id = r.contact_id LEFT JOIN deals d ON d.id = r.deal_id`;

/** Returns a unit to Available when no active reservation remains (only for platform/externally mirrored listings we hold). */
function releaseUnit(db, propertyId) {
  const active = db.get(`SELECT COUNT(*) n FROM reservations WHERE property_id = ? AND status IN ('held','pending_confirmation','confirmed')`, propertyId).n;
  if (!active) db.run(`UPDATE properties SET status = 'available', updated_at = ? WHERE id = ? AND status IN ('on_hold','reserved')`, nowIso(), propertyId);
}

/** AC-RES-02: expire holds whose timer elapsed; unit returns to Available; agent notified exactly once. */
export function sweepReservations(ctx, now = nowIso()) {
  const { db } = ctx;
  const due = db.all(`SELECT * FROM reservations WHERE status IN ('held','pending_confirmation') AND expires_at IS NOT NULL AND expires_at <= ?`, now);
  for (const r of due) {
    db.tx(() => {
      const ch = db.run(`UPDATE reservations SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('held','pending_confirmation')`, now, r.id);
      if (!ch.changes) return;
      releaseUnit(db, r.property_id);
      const p = db.get('SELECT ref FROM properties WHERE id = ?', r.property_id);
      notify(ctx, r.agent_id, { type: 'reservation_expired', title: `Hold expired on ${p.ref}`, body: 'The unit is available again.', link: '#/reservations', dedupeKey: `res_expired:${r.id}` });
      audit({ ...ctx, tenantId: r.tenant_id }, { id: null, tenant_id: r.tenant_id }, 'reservation.expired', 'reservation', r.id);
    });
  }
  return due.length;
}

/** Part G expiry reminders: broker card (BRN), advertising permits, trade licence. Thresholds are proposed defaults. */
export const REMINDER_DAYS = { brn: 30, permit: 14, licence: 60 };
export function sweepCompliance(ctx, now = new Date()) {
  const { db } = ctx; const iso = now.toISOString();
  const within = (days) => new Date(now.getTime() + days * 864e5).toISOString();
  let sent = 0;
  for (const u of db.all(`SELECT * FROM users WHERE active = 1 AND brn_expiry IS NOT NULL AND brn_expiry <= ?`, within(REMINDER_DAYS.brn))) {
    const expired = u.brn_expiry < iso;
    const title = expired ? `Broker card (BRN) expired on ${u.brn_expiry.slice(0, 10)}` : `Broker card (BRN) expires ${u.brn_expiry.slice(0, 10)}`;
    for (const id of new Set([u.id, ...managementIds(db, u.tenant_id)])) if (notify(ctx, id, { type: 'compliance', title: id === u.id ? title : `${u.name}: ${title}`, link: '#/workspace', dedupeKey: `brn:${u.id}:${u.brn_expiry}:${expired ? 'x' : 's'}` })) sent++;
  }
  for (const p of db.all(`SELECT * FROM properties WHERE permit_expiry IS NOT NULL AND permit_expiry <= ? AND status IN ('available','on_hold','reserved')`, within(REMINDER_DAYS.permit))) {
    if (p.agent_id && notify(ctx, p.agent_id, { type: 'compliance', title: `Advertising permit for ${p.ref} ${p.permit_expiry < iso ? 'has expired' : 'expires ' + p.permit_expiry.slice(0, 10)}`, link: '#/listings', dedupeKey: `permit:${p.id}:${p.permit_expiry}:${p.permit_expiry < iso ? 'x' : 's'}` })) sent++;
  }
  for (const t of db.all(`SELECT * FROM tenants WHERE is_platform = 0 AND trade_licence_expiry IS NOT NULL AND trade_licence_expiry <= ?`, within(REMINDER_DAYS.licence))) {
    for (const a of db.all(`SELECT id FROM users WHERE tenant_id = ? AND role = 'admin' AND active = 1`, t.id)) {
      if (notify(ctx, a.id, { type: 'compliance', title: `Trade licence ${t.trade_licence_expiry < iso ? 'expired' : 'expires'} ${t.trade_licence_expiry.slice(0, 10)}`, link: '#/workspace', dedupeKey: `licence:${t.id}:${t.trade_licence_expiry}` })) sent++;
    }
  }
  return sent;
}

export function registerInventory(router, ctx) {
  const { db } = ctx;

  /* ---------------- Projects ---------------- */
  router.get('/api/projects', (req) => ({
    items: db.all(`SELECT pr.*, (SELECT COUNT(*) FROM properties p WHERE p.project_id = pr.id) units,
      (SELECT COUNT(*) FROM properties p WHERE p.project_id = pr.id AND p.status = 'available') available,
      (SELECT COUNT(*) FROM properties p WHERE p.project_id = pr.id AND p.status IN ('on_hold','reserved')) held,
      (SELECT COUNT(*) FROM properties p WHERE p.project_id = pr.id AND p.status IN ('sold','rented')) closed
      FROM projects pr WHERE pr.tenant_id = ? ORDER BY pr.name`, req.user.tenant_id),
  }));

  const projectValidator = (b, required) => validator(b).str('name', { required, max: 120 }).str('developer', { max: 120 }).str('community', { max: 120 }).str('city', { max: 60 })
    .oneOf('completion', ['ready', 'off_plan']).date('handover').oneOf('authority', ['platform', 'external'], { required });

  router.post('/api/projects', (req) => {
    requireScope(req.user, 'projects.manage');
    const v = projectValidator(req.body, true).done();
    if (db.get('SELECT id FROM projects WHERE tenant_id = ? AND lower(name) = lower(?)', req.user.tenant_id, v.name)) throw conflict('PROJECT_EXISTS', 'A project with this name already exists.', { name: 'taken' });
    const id = uuidv7(); const at = nowIso();
    db.run(`INSERT INTO projects(id, tenant_id, name, developer, community, city, completion, handover, authority, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, req.user.tenant_id, v.name, v.developer ?? null, v.community ?? null, v.city ?? 'Dubai', v.completion ?? 'ready', v.handover ?? null, v.authority, at, at);
    audit(ctx, req.user, 'project.created', 'project', id, { authority: v.authority });
    return respond(201, { item: db.get('SELECT * FROM projects WHERE id = ?', id) });
  });

  router.patch('/api/projects/:id', (req) => {
    requireScope(req.user, 'projects.manage');
    const pr = db.get('SELECT * FROM projects WHERE id = ? AND tenant_id = ?', req.params.id, req.user.tenant_id);
    if (!pr) throw notFound('Project');
    const v = projectValidator(req.body, false).done();
    let cascaded = 0;
    db.tx(() => {
      const sets = Object.keys(v).map((k) => `${k} = ?`);
      if (sets.length) db.run(`UPDATE projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...Object.values(v), nowIso(), pr.id);
      // Listings inherit the project's authority. Unverified imports stay unverified until checked.
      if (v.authority && v.authority !== pr.authority) {
        cascaded = db.run(`UPDATE properties SET authority = ?, updated_at = ? WHERE project_id = ? AND authority != 'unverified'`, v.authority, nowIso(), pr.id).changes;
      }
      if (v.completion) db.run('UPDATE properties SET completion = ? WHERE project_id = ?', v.completion, pr.id);
      audit(ctx, req.user, 'project.updated', 'project', pr.id, { ...v, listings_updated: cascaded });
    });
    return { item: db.get('SELECT * FROM projects WHERE id = ?', pr.id), listings_updated: cascaded };
  });

  /* ---------------- Reservations (E2) ---------------- */
  const decorate = (user, r) => ({
    ...r,
    label: r.authority === 'external' && ['held', 'pending_confirmation'].includes(r.status) ? 'Internal hold — not confirmed with developer' : null,
    can_manage: r.agent_id === user.id || canOnOwner(db, user, 'reservations.create', r.agent_id),
    can_confirm: scopeOf(user, 'reservations.confirm') !== 'None',
    can_renew: scopeOf(user, 'reservations.renew') !== 'None' && r.status === 'held' && r.renewals < MAX_RENEWALS,
  });
  const loadRes = (user, id) => {
    const r = db.get(`${RES_SELECT} WHERE r.id = ? AND r.tenant_id = ?`, id, user.tenant_id);
    if (!r || !canOnOwner(db, user, 'reservations.read', r.agent_id)) throw notFound('Reservation');
    return decorate(user, r);
  };

  router.get('/api/reservations', (req) => {
    sweepReservations(ctx);
    const f = ownerFilter(db, req.user, 'reservations.read', 'r.agent_id');
    const where = ['r.tenant_id = ?', f.sql]; const params = [req.user.tenant_id, ...f.params];
    if (req.query.status === 'active') where.push(`r.status IN ('held','pending_confirmation','confirmed')`);
    else if (req.query.status) { where.push('r.status = ?'); params.push(req.query.status); }
    if (req.query.property) { where.push('r.property_id = ?'); params.push(req.query.property); }
    const rows = db.all(`${RES_SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE r.status WHEN 'pending_confirmation' THEN 0 WHEN 'held' THEN 1 WHEN 'confirmed' THEN 2 ELSE 3 END, r.expires_at, r.created_at DESC LIMIT 300`, ...params);
    return { items: rows.map((r) => decorate(req.user, r)), hold_hours: HOLD_HOURS, max_renewals: MAX_RENEWALS };
  });

  router.get('/api/reservations/:id', (req) => ({ item: loadRes(req.user, req.params.id) }));

  router.post('/api/reservations', (req) => {
    const v = validator(req.body).str('property_id', { required: true }).str('deal_id').str('notes', { max: 1000 }).str('oqood_ref', { max: 60 }).done();
    requireScope(req.user, 'reservations.create');
    sweepReservations(ctx);
    const p = db.get('SELECT * FROM properties WHERE id = ? AND tenant_id = ?', v.property_id, req.user.tenant_id);
    if (!p) throw notFound('Property');
    let deal = null;
    if (v.deal_id) {
      deal = db.get('SELECT * FROM deals WHERE id = ? AND tenant_id = ?', v.deal_id, req.user.tenant_id);
      if (!deal || !canOnOwner(db, req.user, 'deals.update', deal.owner_id)) throw badRequest('Choose one of your open deals.', { deal_id: 'not found' });
      if (['won', 'lost'].includes(deal.stage)) throw conflict('CLOSED_DEAL', 'That deal is closed.');
    }
    const agentId = deal?.owner_id || req.user.id;
    const t = reservationTransition({ status: null }, 'hold', { property: p });
    if (!t.ok) throw conflict(t.code, t.message);
    const id = uuidv7(); const at = nowIso();
    const expires = new Date(Date.now() + HOLD_HOURS * 3600e3).toISOString();
    try {
      db.tx(() => {
        // The partial unique index ux_reservation_active is the real guard (AC-RES-01); this read only improves the message.
        db.run(`INSERT INTO reservations(id, tenant_id, property_id, deal_id, contact_id, agent_id, status, authority, expires_at, deposit_note, oqood_ref, created_at, updated_at)
          VALUES (?,?,?,?,?,?,'held',?,?,?,?,?,?)`, id, req.user.tenant_id, p.id, deal?.id ?? null, deal?.contact_id ?? null, agentId, p.authority, expires, v.notes ?? null, v.oqood_ref ?? null, at, at);
        db.run(`UPDATE properties SET status = 'on_hold', updated_at = ? WHERE id = ?`, at, p.id);
        if (deal && ['new', 'viewing', 'offer', 'negotiation'].includes(deal.stage)) {
          db.run(`UPDATE deals SET stage = 'reservation', updated_at = ? WHERE id = ?`, at, deal.id);
          db.run('INSERT INTO deal_stage_history(id, deal_id, from_stage, to_stage, actor_id, reason, at) VALUES (?,?,?,?,?,?,?)', uuidv7(), deal.id, deal.stage, 'reservation', req.user.id, 'Unit held', at);
        }
        audit(ctx, req.user, 'reservation.held', 'reservation', id, { property: p.ref, authority: p.authority, expires_at: expires });
      });
    } catch (e) {
      if (String(e.message).includes('UNIQUE') || String(e.code).includes('CONSTRAINT')) {
        const holder = db.get(`SELECT t.name team FROM reservations r JOIN users u ON u.id = r.agent_id LEFT JOIN teams t ON t.id = u.team_id
          WHERE r.property_id = ? AND r.status IN ('held','pending_confirmation','confirmed')`, p.id);
        audit(ctx, req.user, 'reservation.conflict', 'property', p.id);
        throw conflict('RESERVATION_CONFLICT', `This unit is already held${holder?.team ? ` by team ${holder.team}` : ''}.`, { team: holder?.team ?? null });
      }
      throw e;
    }
    return respond(201, { item: loadRes(req.user, id) });
  });

  router.post('/api/reservations/:id/:action', (req) => {
    const r = loadRes(req.user, req.params.id);
    const action = req.params.action;
    const v = validator(req.body).str('external_ref', { max: 80 }).str('reason', { max: 500 }).str('deposit_note', { max: 500 }).str('oqood_ref', { max: 60 }).done();
    const isOwnerSide = r.agent_id === req.user.id || canOnOwner(db, req.user, 'reservations.create', r.agent_id);
    const t = reservationTransition(r, action, {
      isOwnerSide, canConfirm: scopeOf(req.user, 'reservations.confirm') !== 'None', canRenew: scopeOf(req.user, 'reservations.renew') !== 'None', isManagement: isManagement(req.user),
      externalRef: v.external_ref, reason: v.reason, depositNote: v.deposit_note,
    });
    if (!t.ok) throw t.code === 'FORBIDDEN' ? forbidden(t.message) : conflict(t.code, t.message);
    const at = nowIso();
    db.tx(() => {
      if (action === 'submit') db.run(`UPDATE reservations SET status = 'pending_confirmation', deposit_note = ?, oqood_ref = COALESCE(?, oqood_ref), updated_at = ? WHERE id = ?`, v.deposit_note, v.oqood_ref ?? null, at, r.id);
      if (action === 'confirm') {
        db.run(`UPDATE reservations SET status = 'confirmed', external_ref = ?, confirmed_by = ?, expires_at = NULL, updated_at = ? WHERE id = ?`, v.external_ref, req.user.id, at, r.id);
        db.run(`UPDATE properties SET status = 'reserved', updated_at = ? WHERE id = ?`, at, r.property_id);
        notify(ctx, r.agent_id, { type: 'reservation_confirmed', title: `Reservation confirmed: ${r.property_ref}`, body: `Reference ${v.external_ref}`, link: '#/reservations', dedupeKey: `res_confirmed:${r.id}` });
      }
      if (action === 'renew') db.run(`UPDATE reservations SET renewals = renewals + 1, expires_at = ?, updated_at = ? WHERE id = ?`, new Date(Date.parse(r.expires_at) + HOLD_HOURS * 3600e3).toISOString(), at, r.id);
      if (action === 'cancel') { db.run(`UPDATE reservations SET status = 'cancelled', cancel_reason = ?, expires_at = NULL, updated_at = ? WHERE id = ?`, v.reason, at, r.id); releaseUnit(db, r.property_id); }
      if (action === 'submit') for (const id of managementIds(db, req.user.tenant_id)) notify(ctx, id, { type: 'reservation_submitted', title: `Confirm reservation: ${r.property_ref}`, body: `${r.agent_name} · ${v.deposit_note}`, link: '#/reservations', dedupeKey: `res_submitted:${r.id}` });
      audit(ctx, req.user, `reservation.${action === 'cancel' ? 'cancelled' : action === 'submit' ? 'submitted' : action === 'confirm' ? 'confirmed' : 'renewed'}`, 'reservation', r.id, { external_ref: v.external_ref, reason: v.reason });
    });
    return { item: loadRes(req.user, r.id) };
  }, {});

  /* ---------------- Compliance (Dubai, [Verify]) ---------------- */
  router.get('/api/compliance', (req) => {
    const ids = visibleUserIds(db, req.user, 'compliance.read');
    const L = ids.map(() => '?').join(',') || "''";
    const soon = (d) => new Date(Date.now() + d * 864e5).toISOString();
    const now = nowIso();
    const state = (exp, days) => (!exp ? 'missing' : exp < now ? 'expired' : exp <= soon(days) ? 'expiring' : 'valid');
    const people = db.all(`SELECT id, name, role, brn, brn_expiry FROM users WHERE id IN (${L}) AND active = 1 AND role IN ('agent','team_lead','manager') ORDER BY brn_expiry IS NULL DESC, brn_expiry`, ...ids)
      .map((u) => ({ ...u, state: state(u.brn_expiry, REMINDER_DAYS.brn) }));
    const permits = db.all(`SELECT id, ref, title, permit_no, permit_expiry, agent_id FROM properties WHERE tenant_id = ? AND status IN ('available','on_hold','reserved') AND agent_id IN (${L})
      ORDER BY permit_expiry IS NULL DESC, permit_expiry LIMIT 200`, req.user.tenant_id, ...ids).map((p) => ({ ...p, state: p.permit_no ? state(p.permit_expiry, REMINDER_DAYS.permit) : 'missing' }));
    const t = req.tenant;
    return {
      note: 'Dubai regulatory fields are tracked for reminders only. Requirements must be verified with RERA/DLD and counsel before they are enforced.',
      workspace: { trade_licence_no: t.trade_licence_no, trade_licence_expiry: t.trade_licence_expiry, orn: t.orn, state: state(t.trade_licence_expiry, REMINDER_DAYS.licence) },
      people, permits, reminder_days: REMINDER_DAYS,
    };
  });
}
