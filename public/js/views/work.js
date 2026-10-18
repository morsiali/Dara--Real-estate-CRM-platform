// Tasks with review workflow, calendar (week/month) with meeting outcomes, real-time team chat.
import { get, post, patch } from '../api.js';
import { h, mount, load, avatar, badge, dateTime, timeFmt, shortDate, ago, icon, label, empty, formModal, toast, confirmModal, modal, segmented, loading, errorState, clear,
  localParts, dubaiIso, toLocalInput, fromLocalInput, weekday, money } from '../ui.js';
import { t } from '../i18n.js';
import { panel, TYPE_COLORS } from './shared.js';
import { bumpChatBadge, refreshNav } from '../app.js';

/* ================= Tasks ================= */
export async function tasks(root, ctx) {
  const { store, setHeader, go } = ctx;
  const canReview = store.perms['tasks.review'] !== 'None';
  const scopeAll = store.perms['tasks.read'] !== 'Own';
  let view = ctx.query.view || 'mine';
  const tabs = [['mine', 'Assigned to me'], ['created', 'Assigned by me'], ...(canReview ? [['review', 'Awaiting my review']] : []), ...(scopeAll ? [['all', 'All in my scope']] : [])];
  const listEl = h('div');
  const tabsEl = h('div.filters');
  setHeader(t('tasks.title'), [h('button.btn.btn-primary', { onclick: () => assignTask(store, null, draw) }, icon('plus'), t('tasks.add'))]);
  const draw = () => {
    mount(tabsEl, segmented(tabs, view, (v) => { view = v; draw(); }, 'Task list'));
    const qs = new URLSearchParams({ view, ...(ctx.query.assignee && view !== 'mine' ? { assignee: ctx.query.assignee } : {}) });
    load(listEl, () => get(`/tasks?${qs}`), (d) => {
      if (!d.items.length) return empty(view === 'review' ? 'Nothing waiting for your review' : view === 'mine' ? 'No tasks assigned to you' : 'No tasks here', view === 'created' ? 'Assign work to your team and track it here.' : null);
      const groups = [['Needs action', (x) => ['todo', 'in_progress', 'changes_requested'].includes(x.status)], ['Submitted for review', (x) => x.status === 'submitted'], ['Done', (x) => ['approved', 'cancelled'].includes(x.status)]];
      return h('div.stack', groups.map(([title, test]) => {
        const items = d.items.filter(test); if (!items.length) return null;
        return panel(`${title} · ${items.length}`, h('ul.task-list', items.map((x) => taskRow(store, x, draw, ctx.query.task === x.id))));
      }));
    }).then(() => { if (ctx.query.task) listEl.querySelector('.task.focus')?.scrollIntoView({ block: 'center' }); });
  };
  mount(root, h('div.stack', tabsEl, listEl));
  draw();
  if (ctx.query.assign) assignTask(store, ctx.query.assign, draw);
}

function taskRow(store, x, after, focus) {
  const act = async (action, needNote, noteLabel) => {
    let note;
    if (needNote) { note = await confirmModal({ title: label(action), body: x.title, confirmLabel: label(action), reasonLabel: noteLabel }); if (!note) return; }
    try { await post(`/tasks/${x.id}/transition`, { action, note }); toast({ start: 'Task started', submit: 'Submitted for review', approve: 'Task approved', request_changes: 'Changes requested', cancel: 'Task cancelled' }[action]); after(); refreshNav(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const buttons = [];
  if (x.is_assignee && ['todo', 'changes_requested'].includes(x.status)) buttons.push(h('button.btn.btn-small.btn-ghost', { onclick: () => act('start') }, 'Start'));
  if (x.is_assignee && ['todo', 'in_progress', 'changes_requested'].includes(x.status)) buttons.push(h('button.btn.btn-small.btn-primary', { onclick: () => act('submit', true, 'What did you do? (shown to your reviewer)') }, 'Submit for review'));
  if (x.can_review && x.status === 'submitted') {
    buttons.push(h('button.btn.btn-small.btn-primary', { onclick: () => act('approve') }, 'Approve'));
    buttons.push(h('button.btn.btn-small.btn-ghost', { onclick: () => act('request_changes', true, 'What needs to change?') }, 'Request changes'));
  }
  if ((x.can_review || x.creator_id === store.me.id) && !['approved', 'cancelled'].includes(x.status)) buttons.push(h('button.btn.btn-small.btn-ghost.danger', { onclick: async () => { if (await confirmModal({ title: 'Cancel task?', body: x.title, confirmLabel: 'Cancel task', danger: true })) act('cancel'); } }, 'Cancel task'));
  return h(`li.task${focus ? '.focus' : ''}`, { class: `prio-${x.priority}` },
    h('div.task-main',
      h('div.task-title', h('strong', x.title), badge(x.priority, `p_${x.priority}`), badge(x.status), x.overdue ? h('span.badge.b-overdue', 'Overdue') : null),
      h('div.task-meta', h('span.person-sm', avatar(x.assignee_name, x.assignee_color, { size: 20 }), x.assignee_name), h('span', `from ${x.creator_name}`),
        x.due_at ? h('span', { class: x.overdue ? 'warn' : '' }, `due ${dateTime(x.due_at)}`) : null, x.reviewer_name && ['approved', 'changes_requested'].includes(x.status) ? h('span', `reviewed by ${x.reviewer_name}`) : null),
      x.description ? h('p.task-desc', x.description) : null,
      x.submission_note ? h('p.task-note', h('b', 'Submission: '), x.submission_note) : null,
      x.review_note ? h('p.task-note.review', h('b', 'Review: '), x.review_note) : null),
    h('div.task-actions', buttons));
}

function assignTask(store, preset, after) {
  const scope = store.perms['tasks.assign'];
  const people = store.users.filter((u) => u.active && (scope === 'Tenant' || (scope === 'Team' && u.team_id === store.me.team_id) || u.id === store.me.id));
  const due = new Date(Date.now() + 864e5); const p = localParts(due.toISOString());
  formModal({
    title: t('tasks.add'), submitLabel: 'Assign task',
    fields: [
      { name: 'assignee_id', label: 'Assign to', type: 'select', required: true, options: people.map((u) => [u.id, u.id === store.me.id ? `${u.name} (me)` : `${u.name} — ${t('role.' + u.role)}`]), value: preset || store.me.id },
      { name: 'title', label: 'Task', required: true, full: true, placeholder: 'e.g. Re-verify availability for DR-00012' },
      { name: 'description', label: 'Details', type: 'textarea' },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'urgent'], value: 'medium' },
      { name: 'due_at', label: 'Due (Dubai time)', type: 'datetime-local', value: toLocalInput(dubaiIso(p.y, p.m, p.d, 18)) },
    ],
    submit: async (v) => { await post('/tasks', { ...v, due_at: fromLocalInput(v.due_at) }); toast(v.assignee_id === store.me.id ? 'Task added' : 'Task assigned. They’ve been notified.'); after(); refreshNav(); },
  });
}

/* ================= Calendar ================= */
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
export async function calendar(root, ctx) {
  const { store, setHeader } = ctx;
  const nowP = localParts(new Date().toISOString());
  let mode = 'week';
  let anchor = { y: nowP.y, m: nowP.m, d: nowP.d };
  let who = '';
  const canSeeOthers = store.perms['events.read'] !== 'Own';
  const people = store.users.filter((u) => u.active && (store.perms['events.read'] === 'Tenant' || u.team_id === store.me.team_id));
  const body = h('div');
  const rangeOf = () => {
    if (mode === 'week') {
      const dow = (new Date(Date.UTC(anchor.y, anchor.m, anchor.d)).getUTCDay() + 6) % 7;
      const start = Date.UTC(anchor.y, anchor.m, anchor.d - dow);
      return { days: [...Array(7)].map((_, i) => { const d = new Date(start + i * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; }) };
    }
    const first = new Date(Date.UTC(anchor.y, anchor.m, 1)); const dow = (first.getUTCDay() + 6) % 7;
    const start = Date.UTC(anchor.y, anchor.m, 1 - dow);
    return { days: [...Array(42)].map((_, i) => { const d = new Date(start + i * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; }) };
  };
  const shift = (n) => { const d = new Date(Date.UTC(anchor.y, anchor.m + (mode === 'month' ? n : 0), anchor.d + (mode === 'week' ? n * 7 : 0))); anchor = { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; draw(); };
  const draw = () => {
    const { days } = rangeOf();
    const from = dubaiIso(days[0].y, days[0].m, days[0].d); const last = days.at(-1); const to = dubaiIso(last.y, last.m, last.d + 1);
    const title = mode === 'week' ? `${shortDate(from)} – ${shortDate(dubaiIso(last.y, last.m, last.d, 12))}` : new Intl.DateTimeFormat('en-AE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(anchor.y, anchor.m, 15)));
    setHeader(t('calendar.title'), [
      h('div.cal-nav', h('button.icon-btn', { 'aria-label': 'Previous', onclick: () => shift(-1) }, '‹'), h('button.btn.btn-small.btn-ghost', { onclick: () => { anchor = { y: nowP.y, m: nowP.m, d: nowP.d }; draw(); } }, 'Today'), h('button.icon-btn', { 'aria-label': 'Next', onclick: () => shift(1) }, '›'), h('strong.cal-title', title)),
      segmented([['week', 'Week'], ['month', 'Month']], mode, (m) => { mode = m; draw(); }, 'Calendar view'),
      canSeeOthers ? h('select', { 'aria-label': 'Whose calendar', onchange: (e) => { who = e.target.value; draw(); } }, h('option', { value: '' }, 'Me + everyone I can see'), people.map((u) => h('option', { value: u.id, selected: who === u.id }, u.name))) : null,
      h('button.btn.btn-primary', { onclick: () => newEvent(store, {}, draw) }, icon('plus'), t('calendar.add'))]);
    load(body, () => get(`/events?from=${from}&to=${to}${who ? `&user=${who}` : ''}`), (d) => {
      const evs = d.items.filter((e) => !who || e.organizer_id === who || e.attendees.some((a) => a.user_id === who));
      const onDay = (day) => evs.filter((e) => { const p = localParts(e.start_at); return p.y === day.y && p.m === day.m && p.d === day.d; });
      const isToday = (day) => day.y === nowP.y && day.m === nowP.m && day.d === nowP.d;
      const legendEl = h('div.legend', Object.entries(TYPE_COLORS).map(([k, c]) => h('span.legend-item', h('i', { style: { background: c } }), label(k))), h('span.legend-item.muted', 'Faded = cancelled · striped = no-show'));
      const evClass = (e) => `cal-ev ev-${e.type} st-${e.status}`;
      if (mode === 'month') {
        return h('div.stack', legendEl, h('div.month-grid', { role: 'grid' },
          ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => h('div.month-dow', { role: 'columnheader' }, n)),
          days.map((day) => { const list = onDay(day); return h('div.month-cell', { class: `${day.m !== anchor.m ? 'other' : ''} ${isToday(day) ? 'today' : ''}`, role: 'gridcell' },
            h('button.month-day', { onclick: () => { anchor = day; mode = 'week'; draw(); }, 'aria-label': `Open week of ${day.d}` }, String(day.d)),
            list.slice(0, 3).map((e) => h('button', { class: evClass(e), style: { '--c': TYPE_COLORS[e.type] }, onclick: () => openEvent(store, e.id, draw) }, `${timeFmt(e.start_at)} ${e.title}`)),
            list.length > 3 ? h('button.more', { onclick: () => { anchor = day; mode = 'week'; draw(); } }, `+${list.length - 3} more`) : null); })));
      }
      const PX = 52; // px per hour
      const grid = h('div.week-grid', { style: { '--rows': String(HOURS.length) } },
        h('div.week-corner'),
        days.map((day) => h('div.week-head', { class: isToday(day) ? 'today' : '' }, h('span', weekday(dubaiIso(day.y, day.m, day.d, 12))), h('strong', String(day.d)))),
        h('div.week-hours', HOURS.map((hr) => h('span', { style: { height: `${PX}px` } }, `${String(hr).padStart(2, '0')}:00`))),
        days.map((day) => h('div.week-col', { class: isToday(day) ? 'today' : '', style: { height: `${HOURS.length * PX}px` },
          onclick: (e) => { if (e.target !== e.currentTarget) return; const y = e.offsetY; const hr = HOURS[0] + Math.floor(y / PX); const min = (y % PX) > PX / 2 ? 30 : 0; newEvent(store, { start: dubaiIso(day.y, day.m, day.d, hr, min) }, draw); } },
          layoutLanes(onDay(day)).map(({ e, lane, lanes }) => {
            const s = localParts(e.start_at); const en = localParts(e.end_at);
            const top = Math.max(0, (s.h + s.min / 60 - HOURS[0]) * PX); const end = Math.min(HOURS.length, en.h + en.min / 60 - HOURS[0] + (en.d !== s.d ? 24 : 0)) * PX;
            const height = Math.max(20, end - top - 2);
            return h('button', { class: `${evClass(e)}${height < 40 ? ' compact' : ''}`, style: { top: `${top}px`, height: `${height}px`, '--c': TYPE_COLORS[e.type], '--lane': String(lane), '--lanes': String(lanes) }, onclick: () => openEvent(store, e.id, draw), title: `${e.title} · ${timeFmt(e.start_at)}–${timeFmt(e.end_at)}${e.organizer_id !== store.me.id ? ' · ' + e.organizer_name : ''}` },
              height < 40 ? h('strong', `${timeFmt(e.start_at)} ${e.title}`) : [h('strong', e.title), h('small', `${timeFmt(e.start_at)}–${timeFmt(e.end_at)}${e.organizer_id !== store.me.id ? ' · ' + e.organizer_name : ''}`)]);
          }),
          isToday(day) ? (() => { const n = localParts(new Date().toISOString()); const y = (n.h + n.min / 60 - HOURS[0]) * PX; return y > 0 && y < HOURS.length * PX ? h('div.now-line', { style: { top: `${y}px` } }) : null; })() : null)));
      const agenda = h('ol.agenda.cal-agenda', days.flatMap((day) => { const list = onDay(day); if (!list.length) return []; return [h('li.agenda-day', `${weekday(dubaiIso(day.y, day.m, day.d, 12))} ${day.d}`), ...list.map((e) => h('li', { class: `ev-${e.type}` }, h('span.agenda-time', timeFmt(e.start_at)), h('button.link-btn', { onclick: () => openEvent(store, e.id, draw) }, e.title), badge(e.status)))]; }));
      return h('div.stack', legendEl, h('div.week-wrap', grid), agenda.children.length ? agenda : h('p.muted.cal-agenda', 'No events this week.'));
    });
  };
  mount(root, body);
  draw();
  if (ctx.query.event) openEvent(store, ctx.query.event, draw);
  if (ctx.query.new) newEvent(store, { type: ctx.query.new, deal_id: ctx.query.deal }, draw);
}

/** Side-by-side lanes for overlapping events within a day (clusters share a lane count). */
function layoutLanes(list) {
  const evs = [...list].sort((a, b) => a.start_at.localeCompare(b.start_at) || b.end_at.localeCompare(a.end_at));
  const out = []; let cluster = []; let clusterEnd = ''; let laneEnds = [];
  const flush = () => { const n = Math.max(1, laneEnds.length); for (const c of cluster) c.lanes = n; out.push(...cluster); cluster = []; laneEnds = []; };
  for (const e of evs) {
    if (cluster.length && e.start_at >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= e.start_at);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(e.end_at); } else laneEnds[lane] = e.end_at;
    cluster.push({ e, lane, lanes: 1 });
    if (e.end_at > clusterEnd || cluster.length === 1) clusterEnd = cluster.length === 1 ? e.end_at : (e.end_at > clusterEnd ? e.end_at : clusterEnd);
  }
  flush();
  return out;
}

async function newEvent(store, preset, after, existing) {
  const start = preset.start || (() => { const p = localParts(new Date(Date.now() + 3600e3).toISOString()); return dubaiIso(p.y, p.m, p.d, p.h, 0); })();
  const end = existing?.end_at || new Date(Date.parse(start) + 3600e3).toISOString();
  const people = store.users.filter((u) => u.active && u.id !== store.me.id);
  let props = [];
  try { props = (await get('/properties?status=available')).items; } catch { /* optional */ }
  const save = async (v, allow) => {
    const body = { title: v.title, type: v.type, start_at: fromLocalInput(v.start_at), end_at: fromLocalInput(v.end_at), location: v.location, attendee_ids: v.attendee_ids, property_id: v.property_id || undefined, deal_id: preset.deal_id || undefined, allow_conflicts: allow };
    if (existing) await patch(`/events/${existing.id}`, body); else await post('/events', body);
  };
  formModal({
    title: existing ? 'Edit event' : 'Schedule', submitLabel: existing ? 'Save changes' : 'Schedule', wide: true,
    fields: [
      { name: 'title', label: 'Title', required: true, value: existing?.title || (preset.type === 'viewing' ? 'Viewing — ' : ''), full: true },
      { name: 'type', label: 'Type', type: 'select', options: [['viewing', 'Viewing'], ['meeting', 'Client meeting'], ['call', 'Call'], ['internal', 'Internal meeting'], ['focus', 'Focus time']], value: existing?.type || preset.type || 'meeting' },
      { name: 'location', label: 'Location', value: existing?.location || '' },
      { name: 'start_at', label: 'Starts (Dubai time)', type: 'datetime-local', required: true, value: toLocalInput(existing?.start_at || start) },
      { name: 'end_at', label: 'Ends', type: 'datetime-local', required: true, value: toLocalInput(end) },
      { name: 'property_id', label: 'Listing (viewings)', type: 'select', options: [['', 'None'], ...props.map((p) => [p.id, `${p.ref} — ${p.title}`])], value: existing?.property_id || '' },
      { name: 'attendee_ids', label: 'Invite team members', type: 'multiselect', options: people.map((u) => [u.id, u.name]), value: existing ? existing.attendees.map((a) => a.user_id) : [] },
    ],
    submit: async (v) => {
      try { await save(v, false); }
      catch (e) {
        if (e.code !== 'CALENDAR_CONFLICT') throw e;
        const list = (e.details?.conflicts || []).map((c) => `• ${c.person}: ${c.title} (${timeFmt(c.start_at)}–${timeFmt(c.end_at)})`).join('\n');
        const ok = await confirmModal({ title: 'Time overlaps other events', body: `${list}\n\nSave anyway?`, confirmLabel: 'Save anyway' });
        if (!ok) throw new Error('Not saved — pick another time.');
        await save(v, true);
      }
      toast(existing ? 'Event updated. Attendees were notified.' : 'Scheduled. Invites sent.'); after();
    },
  });
}

async function openEvent(store, id, after) {
  const bodyEl = h('div', loading());
  const m = modal({ title: 'Event', body: bodyEl });
  const reload = () => { m.close(); after(); };
  try {
    const { item: e } = await get(`/events/${id}`);
    m.dialog.querySelector('h2').textContent = e.title;
    const mine = e.attendees.find((a) => a.user_id === store.me.id);
    const started = e.start_at <= new Date().toISOString();
    const outcome = async (status) => {
      const note = await confirmModal({ title: `Mark as ${label(status)}`, body: e.title, confirmLabel: `Mark ${label(status).toLowerCase()}`, reasonLabel: status === 'completed' ? 'Outcome — what was agreed?' : 'Note' });
      if (!note) return;
      try { await post(`/events/${e.id}/outcome`, { status, outcome: note }); toast(status === 'completed' ? 'Outcome recorded' : `Marked ${label(status)}`); reload(); } catch (err) { toast(err.message, 'error'); }
    };
    mount(bodyEl, h('div.stack',
      h('dl.facts', fact('When', `${dateTime(e.start_at)} – ${timeFmt(e.end_at)}`), fact('Type', label(e.type)), fact('Status', badge(e.status)), e.location ? fact('Where', e.location) : null,
        fact('Organizer', e.organizer_name), e.outcome ? fact('Outcome', e.outcome) : null),
      e.attendees.length ? h('div', h('h3.sub-h', 'Attendees'), h('ul.attendees', e.attendees.map((a) => h('li', avatar(a.name, a.color, { size: 24, online: store.online.has(a.user_id) }), h('span', a.name), badge(a.response, `r_${a.response}`))))) : null,
      h('div.btn-row',
        mine && e.status === 'scheduled' ? [h('button.btn.btn-small', { onclick: async () => { await post(`/events/${e.id}/rsvp`, { response: 'accepted' }); toast('Accepted'); reload(); } }, 'Accept'), h('button.btn.btn-small.btn-ghost', { onclick: async () => { await post(`/events/${e.id}/rsvp`, { response: 'declined' }); toast('Declined'); reload(); } }, 'Decline')] : null,
        e.can_edit && e.status === 'scheduled' ? [
          started ? h('button.btn.btn-small.btn-primary', { onclick: () => outcome('completed') }, 'Record outcome') : null,
          started ? h('button.btn.btn-small.btn-ghost', { onclick: () => outcome('no_show') }, 'No-show') : null,
          h('button.btn.btn-small.btn-ghost', { onclick: () => { m.close(); newEvent(store, {}, after, e); } }, 'Reschedule / edit'),
          h('button.btn.btn-small.btn-ghost.danger', { onclick: () => outcome('cancelled') }, 'Cancel event')] : null),
      e.can_edit && e.status === 'scheduled' && !started ? h('p.muted', 'You can record the outcome once the event has started.') : null));
  } catch (err) { mount(bodyEl, errorState(err)); }
}
const fact = (k, v) => h('div.fact', h('dt', k), h('dd', v));

/* ================= Chat ================= */
export async function chat(root, ctx) {
  const { store, setHeader, go } = ctx;
  setHeader(t('chat.title'), [h('button.btn.btn-ghost', { onclick: () => startDm(store, go) }, icon('plus'), 'New message'),
    store.perms['channels.create'] !== 'None' ? h('button.btn.btn-ghost', { onclick: () => createChannel(store, go) }, 'New channel') : null]);
  let channels = [];
  let activeId = ctx.id;
  const listEl = h('nav.chan-list', { 'aria-label': 'Conversations' });
  const threadEl = h('div.thread');
  const layout = h('div.chat', { class: activeId ? 'has-active' : '' }, listEl, threadEl);
  mount(root, layout);

  if (ctx.query.dm) { try { const r = await post('/channels/dm', { user_id: ctx.query.dm }); go(`#/chat/${r.item.id}`); return; } catch (e) { toast(e.message, 'error'); } }

  const renderList = () => {
    const groups = [['Channels', channels.filter((c) => c.kind !== 'dm')], ['Direct messages', channels.filter((c) => c.kind === 'dm')]];
    mount(listEl, groups.map(([title, items]) => h('div.chan-group', h('span.nav-label', title), items.length ? h('ul', items.map((c) => h('li', h('a', { href: `#/chat/${c.id}`, class: c.id === activeId ? 'active' : '', 'aria-current': c.id === activeId ? 'page' : null },
      c.kind === 'dm' ? avatar(c.name, c.other?.color, { size: 24, online: store.online.has(c.other?.id) }) : h('span.hash', c.kind === 'team' ? '◆' : '#'),
      h('span.chan-name', c.name), c.unread ? h('span.nav-count', String(c.unread)) : null)))) : h('p.muted.pad-s', title === 'Direct messages' ? 'No direct messages yet.' : 'No channels.'))));
    bumpChatBadge(channels.reduce((s, c) => s + (c.id === activeId ? 0 : c.unread || 0), 0));
  };
  try { channels = (await get('/channels')).items; } catch (e) { mount(layout, errorState(e)); return; }
  if (!activeId) activeId = (channels.find((c) => c.kind === 'public') || channels[0])?.id;
  renderList();

  let loadedFor = null; let messagesEl; let oldest = null;
  const messageEl = (m, prev) => {
    const sameAuthor = prev && prev.user_id === m.user_id && m.kind === 'user' && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60e3;
    if (m.kind === 'system') return h('li.msg.system', h('span', m.body), h('time', { datetime: m.created_at }, timeFmt(m.created_at)));
    const u = store.user(m.user_id) || { name: m.user_name, color: m.user_color };
    return h(`li.msg${sameAuthor ? '.cont' : ''}${m.user_id === store.me.id ? '.mine' : ''}`,
      sameAuthor ? h('span.msg-gutter') : avatar(u.name, u.color, { size: 32 }),
      h('div.msg-body', sameAuthor ? null : h('div.msg-head', h('strong', u.name), h('time', { datetime: m.created_at }, dateTime(m.created_at))), h('p', highlightMentions(m.body))));
  };
  const withDividers = (list) => {
    const out = []; let lastDay = '';
    list.forEach((m, i) => { const day = shortDate(m.created_at); if (day !== lastDay) { out.push(h('li.day-div', h('span', day))); lastDay = day; } out.push(messageEl(m, list[i - 1])); });
    return out;
  };
  let currentList = [];
  const openChannel = async () => {
    const c = channels.find((x) => x.id === activeId);
    if (!c) { mount(threadEl, empty('Pick a conversation', 'Choose a channel or start a direct message.')); return; }
    loadedFor = c.id;
    messagesEl = h('ol.messages', { 'aria-live': 'polite', 'aria-label': `Messages in ${c.name}` });
    const input = h('textarea.composer-input', { rows: 1, placeholder: `Message ${c.kind === 'dm' ? c.name : '#' + c.name} — @name to mention, Enter to send`, 'aria-label': 'Message', maxlength: 4000 });
    const send = async () => {
      const text = input.value.trim(); if (!text) return;
      input.disabled = true;
      try { await post(`/channels/${c.id}/messages`, { body: text }); input.value = ''; input.style.setProperty('height', 'auto'); }
      catch (e) { toast(e.message, 'error'); }
      finally { input.disabled = false; input.focus(); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    input.addEventListener('input', () => { input.style.setProperty('height', 'auto'); input.style.setProperty('height', `${Math.min(160, input.scrollHeight)}px`); });
    const members = c.kind === 'dm' ? null : h('small.muted', c.topic || '');
    const older = h('button.link-btn.older', { hidden: true, onclick: async () => {
      const d = await get(`/channels/${c.id}/messages?before=${encodeURIComponent(oldest)}`);
      currentList = [...d.items, ...currentList]; oldest = currentList[0]?.created_at; older.hidden = !d.has_more;
      const h0 = messagesEl.scrollHeight; mount(messagesEl, withDividers(currentList)); messagesEl.scrollTop = messagesEl.scrollHeight - h0;
    } }, 'Load earlier messages');
    mount(threadEl,
      h('header.thread-head', h('a.back-link', { href: '#/chat', 'aria-label': 'Back to conversations' }, '‹'), h('div', h('strong', c.kind === 'dm' ? c.name : `${c.kind === 'team' ? '◆' : '#'} ${c.name}`), members)),
      h('div.messages-wrap', older, messagesEl),
      h('form.composer', { onsubmit: (e) => { e.preventDefault(); send(); } }, input, h('button.btn.btn-primary', { type: 'submit', 'aria-label': 'Send' }, icon('send'))));
    mount(messagesEl, loading());
    try {
      const d = await get(`/channels/${c.id}/messages`);
      currentList = d.items; oldest = d.items[0]?.created_at; older.hidden = !d.has_more;
      mount(messagesEl, currentList.length ? withDividers(currentList) : h('li.muted.pad', 'No messages yet — say hello.'));
      messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
      await post(`/channels/${c.id}/read`); c.unread = 0; renderList();
    } catch (e) { mount(messagesEl, errorState(e, openChannel)); }
    input.focus();
  };
  await openChannel();

  const off = store.on('message', (m) => {
    const c = channels.find((x) => x.id === m.channel_id);
    if (!c) { get('/channels').then((d) => { channels = d.items; renderList(); }); return; }
    c.last_message_at = m.created_at;
    if (m.channel_id === loadedFor && messagesEl) {
      if (!currentList.length) clear(messagesEl);
      const prev = currentList.at(-1); currentList.push(m);
      if (!prev || shortDate(prev.created_at) !== shortDate(m.created_at)) messagesEl.append(h('li.day-div', h('span', shortDate(m.created_at))));
      messagesEl.append(messageEl(m, prev));
      const wrap = messagesEl.parentElement; wrap.scrollTop = wrap.scrollHeight;
      if (m.user_id !== store.me.id) post(`/channels/${m.channel_id}/read`).catch(() => {});
    } else if (m.user_id !== store.me.id) { c.unread = (c.unread || 0) + 1; }
    renderList();
  });
  const offP = store.on('presence', () => renderList());
  return () => { off(); offP(); };
}

function highlightMentions(text) {
  const parts = text.split(/(@[A-Za-z؀-ۿ]+(?: [A-Z][a-z]+)?)/g);
  return parts.map((p) => (p.startsWith('@') ? h('span.mention', p) : p));
}

function startDm(store, go) {
  formModal({
    title: 'New message', submitLabel: 'Open conversation',
    fields: [{ name: 'user_id', label: 'To', type: 'select', required: true, options: [['', 'Choose a person…'], ...store.users.filter((u) => u.id !== store.me.id && u.active).map((u) => [u.id, `${u.name} — ${t('role.' + u.role)}`])] }],
    submit: async (v) => { const r = await post('/channels/dm', v); go(`#/chat/${r.item.id}`); },
  });
}
function createChannel(store, go) {
  formModal({
    title: 'New channel', submitLabel: 'Create channel',
    fields: [{ name: 'name', label: 'Name', required: true, placeholder: 'e.g. off-plan-launches' }, { name: 'topic', label: 'Topic' },
      { name: 'kind', label: 'Who can see it', type: 'select', options: [...(store.isMgmt() ? [['public', 'Everyone in the company']] : []), ...(store.me.team_id ? [['team', `My team (${store.team?.name || ''}) + management`]] : [])] }],
    submit: async (v) => { const r = await post('/channels', v); toast('Channel created'); go(`#/chat/${r.item.id}`); },
  });
}
