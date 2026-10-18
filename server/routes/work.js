// Team work management: tasks with manager review, calendar & meetings, monthly goals.
import { notFound, forbidden, conflict, badRequest, respond } from '../http.js';
import { uuidv7, nowIso } from '../db.js';
import { validator } from '../validate.js';
import { canOnOwner, ownerFilter, isManagement, visibleUserIds } from '../rbac.js';
import { taskTransition, overlaps } from '../services/rules.js';
import { notify, audit, managementIds } from '../services/notify.js';
import { award, POINT_RULES } from '../services/gamification.js';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const EVENT_TYPES = ['meeting', 'viewing', 'call', 'internal', 'focus'];

export function registerWork(router, ctx) {
  const { db } = ctx;
  const userById = async (id) => await db.get('SELECT * FROM users WHERE id = ?', id);

  /* ---------------- Tasks ---------------- */
  const TASK_SELECT = `SELECT t.*, a.name assignee_name, a.color assignee_color, c.name creator_name, r.name reviewer_name FROM tasks t
    JOIN users a ON a.id = t.assignee_id JOIN users c ON c.id = t.creator_id LEFT JOIN users r ON r.id = t.reviewer_id`;
  const loadTask = async (user, id) => {
    const t = await db.get(`${TASK_SELECT} WHERE t.id = ? AND t.tenant_id = ?`, id, user.tenant_id);
    if (!t || !(await canOnOwner(db, user, 'tasks.read', t.assignee_id) || t.creator_id === user.id)) throw notFound('Task');
    return t;
  };
  const reviewerOf = async (user, t) => (user.id !== t.assignee_id || isManagement(user)) && await canOnOwner(db, user, 'tasks.review', t.assignee_id);
  const decorate = async (user, t) => ({ ...t, can_review: await reviewerOf(user, t), is_assignee: t.assignee_id === user.id, overdue: !!(t.due_at && t.due_at < nowIso() && ['todo', 'in_progress', 'changes_requested'].includes(t.status)) });

  router.get('/api/tasks', async (req) => {
    const u = req.user; const view = req.query.view || 'mine';
    let where; let params;
    if (view === 'mine') { where = 't.assignee_id = ?'; params = [u.id]; }
    else if (view === 'created') { where = 't.creator_id = ? AND t.assignee_id != ?'; params = [u.id, u.id]; }
    else if (view === 'review') {
      const f = await ownerFilter(db, u, 'tasks.review', 't.assignee_id');
      where = `t.status = 'submitted' AND ${f.sql}` + (isManagement(u) ? '' : ' AND t.assignee_id != ?'); params = [...f.params, ...(isManagement(u) ? [] : [u.id])];
    } else { const f = await ownerFilter(db, u, 'tasks.read', 't.assignee_id'); where = f.sql; params = f.params; }
    if (req.query.status) { where += ' AND t.status = ?'; params.push(req.query.status); }
    if (req.query.assignee) { where += ' AND t.assignee_id = ?'; params.push(req.query.assignee); }
    const rows = await db.all(`${TASK_SELECT} WHERE t.tenant_id = ? AND ${where} ORDER BY CASE t.status WHEN 'submitted' THEN 0 WHEN 'changes_requested' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'todo' THEN 3 ELSE 4 END,
      COALESCE(t.due_at, '9999') LIMIT 500`, u.tenant_id, ...params);
    return { items: await Promise.all(rows.map((t) => decorate(u, t))) };
  });

  router.post('/api/tasks', async (req) => {
    const v = validator(req.body).str('title', { required: true, max: 200 }).str('description', { max: 4000 }).oneOf('priority', PRIORITIES)
      .date('due_at').str('assignee_id').oneOf('related_type', ['lead', 'deal', 'property']).str('related_id').done();
    const assigneeId = v.assignee_id || req.user.id;
    const assignee = await db.get('SELECT * FROM users WHERE id = ? AND tenant_id = ? AND active = 1', assigneeId, req.user.tenant_id);
    if (!assignee) throw badRequest('Choose an active team member.', { assignee_id: 'not found' });
    if (!await canOnOwner(db, req.user, 'tasks.assign', assignee.id)) throw forbidden('You can only assign tasks within your scope.');
    const id = uuidv7(); const at = nowIso();
    await db.run(`INSERT INTO tasks(id, tenant_id, title, description, priority, status, assignee_id, creator_id, due_at, related_type, related_id, created_at, updated_at)
      VALUES (?,?,?,?,?,'todo',?,?,?,?,?,?,?)`, id, req.user.tenant_id, v.title, v.description ?? null, v.priority ?? 'medium', assignee.id, req.user.id, v.due_at ?? null, v.related_type ?? null, v.related_id ?? null, at, at);
    if (assignee.id !== req.user.id) await notify(ctx, assignee.id, { type: 'task_assigned', title: `${req.user.name} assigned you a task`, body: v.title, link: `#/tasks?task=${id}`, dedupeKey: `task_assigned:${id}` });
    await audit(ctx, req.user, 'task.created', 'task', id, { assignee: assignee.id });
    return respond(201, { item: await decorate(req.user, await loadTask(req.user, id)) });
  });

  router.patch('/api/tasks/:id', async (req) => {
    const t = await loadTask(req.user, req.params.id);
    if (t.creator_id !== req.user.id && !isManagement(req.user)) throw forbidden('Only the creator or management can edit this task.');
    if (['approved', 'cancelled'].includes(t.status)) throw conflict('CLOSED_TASK', 'This task is closed.');
    const v = validator(req.body).str('title', { max: 200 }).str('description', { max: 4000 }).oneOf('priority', PRIORITIES).date('due_at').done();
    const sets = Object.keys(v).map((k) => `${k} = ?`);
    if (sets.length) await db.run(`UPDATE tasks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...Object.values(v), nowIso(), t.id);
    await audit(ctx, req.user, 'task.updated', 'task', t.id, v);
    return { item: await decorate(req.user, await loadTask(req.user, t.id)) };
  });

  router.post('/api/tasks/:id/transition', async (req) => {
    const t = await loadTask(req.user, req.params.id);
    const { action, note } = validator(req.body).str('action', { required: true }).str('note', { max: 2000 }).done();
    const isAssignee = t.assignee_id === req.user.id;
    let isReviewer = await reviewerOf(req.user, t);
    if (action === 'cancel' && t.creator_id === req.user.id) isReviewer = true;
    const r = taskTransition(t, action, { isAssignee, isReviewer, note });
    if (!r.ok) throw r.code === 'FORBIDDEN' ? forbidden(r.message) : conflict(r.code, r.message);
    const at = nowIso();
    await db.tx(async () => {
      if (action === 'submit') await db.run(`UPDATE tasks SET status = ?, submitted_at = ?, submission_note = ?, updated_at = ? WHERE id = ?`, r.to, at, note ?? null, at, t.id);
      else if (action === 'approve') await db.run(`UPDATE tasks SET status = ?, approved_at = ?, reviewer_id = ?, review_note = ?, updated_at = ? WHERE id = ?`, r.to, at, req.user.id, note ?? null, at, t.id);
      else if (action === 'request_changes') await db.run(`UPDATE tasks SET status = ?, reviewer_id = ?, review_note = ?, updated_at = ? WHERE id = ?`, r.to, req.user.id, note, at, t.id);
      else await db.run(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`, r.to, at, t.id);
      await audit(ctx, req.user, `task.${action}`, 'task', t.id, { from: t.status, to: r.to, note });
      const assignee = await userById(t.assignee_id);
      if (action === 'submit') {
        const recipients = t.creator_id !== t.assignee_id ? [t.creator_id] : (await managementIds(db, req.user.tenant_id, assignee.team_id)).filter((id) => id !== assignee.id);
        for (const id of recipients) await notify(ctx, id, { type: 'task_submitted', title: `${assignee.name} submitted a task for review`, body: t.title, link: `#/tasks?view=review&task=${t.id}`, dedupeKey: `task_submitted:${t.id}:${at}` });
      }
      if (action === 'approve') {
        await award(ctx, assignee, 'task_approved', t.id, POINT_RULES.task_approved[t.priority], `Task approved: ${t.title}`);
        if (t.due_at && t.submitted_at && t.submitted_at <= t.due_at) await award(ctx, assignee, 'task_on_time', t.id, POINT_RULES.task_on_time_bonus, 'Submitted before due time');
        await notify(ctx, assignee.id, { type: 'task_approved', title: `${req.user.name} approved your task`, body: t.title, link: `#/tasks?task=${t.id}`, dedupeKey: `task_approved:${t.id}` });
      }
      if (action === 'request_changes') await notify(ctx, assignee.id, { type: 'task_changes', title: `${req.user.name} requested changes`, body: note, link: `#/tasks?task=${t.id}`, dedupeKey: `task_changes:${t.id}:${at}` });
    });
    return { item: await decorate(req.user, await loadTask(req.user, t.id)) };
  });

  /* ---------------- Calendar ---------------- */
  const attendeesOf = async (eventId) => await db.all(`SELECT ea.user_id, ea.response, u.name, u.color FROM event_attendees ea JOIN users u ON u.id = ea.user_id WHERE ea.event_id = ?`, eventId);
  const loadEvent = async (user, id) => {
    const e = await db.get(`SELECT e.*, u.name organizer_name, u.color organizer_color FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.id = ? AND e.tenant_id = ?`, id, user.tenant_id);
    if (!e) throw notFound('Event');
    const attendees = await attendeesOf(e.id);
    if (!await canOnOwner(db, user, 'events.read', e.organizer_id) && !attendees.some((a) => a.user_id === user.id)) throw notFound('Event');
    return { ...e, attendees, can_edit: e.organizer_id === user.id || isManagement(user) };
  };

  /** Finds scheduled/accepted events overlapping [start,end) for the given users. */
  async function conflictsFor(userIds, start, end, excludeId = '') {
    if (!userIds.length) return [];
    const L = userIds.map(() => '?').join(',');
    return (await db.all(`SELECT DISTINCT e.id, e.title, e.start_at, e.end_at, u.name person FROM events e
      JOIN (SELECT id ev, organizer_id uid FROM events UNION SELECT event_id, user_id FROM event_attendees WHERE response != 'declined') x ON x.ev = e.id
      JOIN users u ON u.id = x.uid
      WHERE x.uid IN (${L}) AND e.status = 'scheduled' AND e.id != ? AND e.start_at < ? AND e.end_at > ?`, ...userIds, excludeId, end, start))
      .filter((c) => overlaps(start, end, c.start_at, c.end_at));
  }

  router.get('/api/events', async (req) => {
    const from = req.query.from || new Date(Date.now() - 7 * 864e5).toISOString();
    const to = req.query.to || new Date(Date.now() + 35 * 864e5).toISOString();
    let ids = await visibleUserIds(db, req.user, 'events.read');
    if (req.query.user) { if (!ids.includes(req.query.user)) throw forbidden(); ids = [req.query.user]; }
    const L = ids.map(() => '?').join(',');
    const rows = await db.all(`SELECT DISTINCT e.*, u.name organizer_name, u.color organizer_color FROM events e JOIN users u ON u.id = e.organizer_id
      LEFT JOIN event_attendees ea ON ea.event_id = e.id
      WHERE e.tenant_id = ? AND e.start_at < ? AND e.end_at > ? AND (e.organizer_id IN (${L}) OR ea.user_id IN (${L}) ${req.query.user ? '' : 'OR ea.user_id = ?'})
      ORDER BY e.start_at`, req.user.tenant_id, to, from, ...ids, ...ids, ...(req.query.user ? [] : [req.user.id]));
    return { items: await Promise.all(rows.map(async (e) => ({ ...e, attendees: await attendeesOf(e.id), can_edit: e.organizer_id === req.user.id || isManagement(req.user) }))) };
  });

  router.get('/api/events/:id', async (req) => ({ item: await loadEvent(req.user, req.params.id) }));

  const eventValidator = (body, required) => validator(body).str('title', { required, max: 200 }).oneOf('type', EVENT_TYPES, { required })
    .date('start_at', { required }).date('end_at', { required }).str('location', { max: 200 }).list('attendee_ids', { max: 30 })
    .str('contact_id').str('deal_id').str('property_id');

  router.post('/api/events', async (req) => {
    const v = eventValidator(req.body, true).done();
    if (v.end_at <= v.start_at) throw badRequest('End time must be after the start time.', { end_at: 'must be after start' });
    const attendees = [...new Set((v.attendee_ids || []).filter((id) => id !== req.user.id))];
    for (const id of attendees) if (!await db.get('SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1', id, req.user.tenant_id)) throw badRequest('One of the attendees is not an active team member.', { attendee_ids: 'invalid' });
    if (v.property_id && !await db.get('SELECT id FROM properties WHERE id = ? AND tenant_id = ?', v.property_id, req.user.tenant_id)) throw badRequest('Property not found.', { property_id: 'not found' });
    if (v.deal_id) { const d = await db.get('SELECT owner_id FROM deals WHERE id = ? AND tenant_id = ?', v.deal_id, req.user.tenant_id); if (!d || !await canOnOwner(db, req.user, 'deals.read', d.owner_id)) throw badRequest('Deal not found.', { deal_id: 'not found' }); }
    const clashes = await conflictsFor([req.user.id, ...attendees], v.start_at, v.end_at);
    if (clashes.length && !req.body.allow_conflicts) throw conflict('CALENDAR_CONFLICT', 'This time overlaps other events. Pick another time or save anyway.', { conflicts: clashes });
    const id = uuidv7(); const at = nowIso();
    await db.tx(async () => {
      await db.run(`INSERT INTO events(id, tenant_id, title, type, start_at, end_at, location, organizer_id, contact_id, deal_id, property_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'scheduled',?,?)`,
        id, req.user.tenant_id, v.title, v.type, v.start_at, v.end_at, v.location ?? null, req.user.id, v.contact_id ?? null, v.deal_id ?? null, v.property_id ?? null, at, at);
      for (const uid of attendees) {
        await db.run(`INSERT INTO event_attendees(event_id, user_id, response) VALUES (?,?,'pending')`, id, uid);
        await notify(ctx, uid, { type: 'event_invite', title: `${req.user.name} invited you: ${v.title}`, body: new Date(v.start_at).toISOString(), link: `#/calendar?event=${id}`, dedupeKey: `invite:${id}` });
      }
      await audit(ctx, req.user, 'event.created', 'event', id, { type: v.type });
    });
    return respond(201, { item: await loadEvent(req.user, id), conflicts: clashes });
  });

  router.patch('/api/events/:id', async (req) => {
    const e = await loadEvent(req.user, req.params.id);
    if (!e.can_edit) throw forbidden('Only the organizer or management can change this event.');
    if (e.status !== 'scheduled') throw conflict('EVENT_CLOSED', 'Only scheduled events can be changed.');
    const v = eventValidator(req.body, false).done();
    const start = v.start_at ?? e.start_at; const end = v.end_at ?? e.end_at;
    if (end <= start) throw badRequest('End time must be after the start time.', { end_at: 'must be after start' });
    const attendees = v.attendee_ids ? [...new Set(v.attendee_ids.filter((id) => id !== e.organizer_id))] : e.attendees.map((a) => a.user_id);
    if (v.start_at || v.end_at || v.attendee_ids) {
      const clashes = await conflictsFor([e.organizer_id, ...attendees], start, end, e.id);
      if (clashes.length && !req.body.allow_conflicts) throw conflict('CALENDAR_CONFLICT', 'This time overlaps other events. Pick another time or save anyway.', { conflicts: clashes });
    }
    await db.tx(async () => {
      const fields = { title: v.title, type: v.type, start_at: v.start_at, end_at: v.end_at, location: v.location };
      const sets = Object.entries(fields).filter(([, x]) => x !== undefined);
      if (sets.length) await db.run(`UPDATE events SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...sets.map(([, x]) => x), nowIso(), e.id);
      if (v.attendee_ids) {
        for (const a of e.attendees) if (!attendees.includes(a.user_id)) await db.run('DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?', e.id, a.user_id);
        for (const uid of attendees) {
          if (!await db.get('SELECT id FROM users WHERE id = ? AND tenant_id = ?', uid, req.user.tenant_id)) throw badRequest('Invalid attendee.', { attendee_ids: 'invalid' });
          const r = await db.run(`INSERT INTO event_attendees(event_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING`, e.id, uid);
          if (r.changes) await notify(ctx, uid, { type: 'event_invite', title: `${req.user.name} invited you: ${v.title ?? e.title}`, link: `#/calendar?event=${e.id}`, dedupeKey: `invite:${e.id}` });
        }
      }
      if (v.start_at || v.end_at) {
        for (const uid of attendees) await notify(ctx, uid, { type: 'event_moved', title: `Rescheduled: ${v.title ?? e.title}`, body: start, link: `#/calendar?event=${e.id}`, dedupeKey: `moved:${e.id}:${start}` });
        await db.run(`UPDATE event_attendees SET response = 'pending' WHERE event_id = ?`, e.id);
      }
      await audit(ctx, req.user, 'event.updated', 'event', e.id, v);
    });
    return { item: await loadEvent(req.user, e.id) };
  });

  router.post('/api/events/:id/rsvp', async (req) => {
    const e = await loadEvent(req.user, req.params.id);
    const { response } = validator(req.body).oneOf('response', ['accepted', 'declined'], { required: true }).done();
    const r = await db.run('UPDATE event_attendees SET response = ? WHERE event_id = ? AND user_id = ?', response, e.id, req.user.id);
    if (!r.changes) throw forbidden('You are not invited to this event.');
    await notify(ctx, e.organizer_id, { type: 'event_rsvp', title: `${req.user.name} ${response} “${e.title}”`, link: `#/calendar?event=${e.id}`, dedupeKey: `rsvp:${e.id}:${req.user.id}:${response}` });
    return { item: await loadEvent(req.user, e.id) };
  });

  router.post('/api/events/:id/outcome', async (req) => {
    const e = await loadEvent(req.user, req.params.id);
    if (!e.can_edit) throw forbidden('Only the organizer or management can record the outcome.');
    const { status, outcome } = validator(req.body).oneOf('status', ['completed', 'cancelled', 'no_show'], { required: true }).str('outcome', { max: 2000 }).done();
    if (e.status !== 'scheduled') throw conflict('EVENT_CLOSED', `This event is already ${e.status.replace('_', ' ')}.`);
    if (status !== 'cancelled' && e.start_at > nowIso()) throw conflict('EVENT_NOT_STARTED', 'You can record what happened once the event has started.');
    await db.tx(async () => {
      await db.run('UPDATE events SET status = ?, outcome = ?, updated_at = ? WHERE id = ?', status, outcome ?? null, nowIso(), e.id);
      if (status === 'completed') {
        const organizer = await userById(e.organizer_id);
        const pts = { viewing: POINT_RULES.viewing_completed, meeting: POINT_RULES.meeting_completed, call: POINT_RULES.call_completed }[e.type];
        if (pts) await award(ctx, organizer, `${e.type}_completed`, e.id, pts, `${e.type[0].toUpperCase() + e.type.slice(1)} completed: ${e.title}`);
      }
      if (status === 'cancelled') for (const a of e.attendees) await notify(ctx, a.user_id, { type: 'event_cancelled', title: `Cancelled: ${e.title}`, link: '#/calendar', dedupeKey: `cancel:${e.id}` });
      await audit(ctx, req.user, `event.${status}`, 'event', e.id, { outcome });
    });
    return { item: await loadEvent(req.user, e.id) };
  });

  /* ---------------- Goals ---------------- */
  router.get('/api/goals', async (req) => {
    const userId = req.query.user || req.user.id;
    if (!await canOnOwner(db, req.user, 'dashboard.member', userId)) throw notFound('Goals');
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 7);
    return { month, items: await db.all('SELECT metric, target FROM goals WHERE user_id = ? AND month = ?', userId, month) };
  });

  router.put('/api/goals', async (req) => {
    const v = validator(req.body).str('user_id', { required: true }).str('month', { required: true }).oneOf('metric', ['won_volume', 'deals_won', 'viewings_done', 'calls_logged'], { required: true })
      .int('target', { required: true, min: 1, max: 1e13 }).done();
    if (!/^\d{4}-\d{2}$/.test(v.month)) throw badRequest('Month must look like 2026-10.', { month: 'invalid' });
    const target = await db.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', v.user_id, req.user.tenant_id);
    if (!target || !await canOnOwner(db, req.user, 'goals.set', target.id) || (target.id === req.user.id && !isManagement(req.user))) throw forbidden('You can’t set goals for this person.');
    await db.run(`INSERT INTO goals(id, user_id, month, metric, target, set_by) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, month, metric) DO UPDATE SET target = excluded.target, set_by = excluded.set_by`,
      uuidv7(), v.user_id, v.month, v.metric, v.target, req.user.id);
    await notify(ctx, v.user_id, { type: 'goal_set', title: `${req.user.name} set your ${v.month} goals`, link: '#/me', dedupeKey: `goal:${v.month}:${v.metric}:${v.target}` });
    await audit(ctx, req.user, 'goal.set', 'user', v.user_id, v);
    return { ok: true };
  });
}
