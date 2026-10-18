// Leads (list + detail with explainable matching), pipeline (kanban), listings.
import { get, post, patch } from '../api.js';
import { h, mount, load, money, num, avatar, badge, dateTime, shortDate, ago, icon, label, empty, formModal, toast, confirmModal, modal, segmented, loading, errorState, clear } from '../ui.js';
import { t } from '../i18n.js';
import { panel, STAGE_COLORS } from './shared.js';
import { holdUnit } from './saas.js';

const PTYPES = ['apartment', 'villa', 'townhouse', 'penthouse', 'office', 'retail', 'land'];
const SOURCES = ['manual', 'website', 'portal', 'referral', 'walk_in', 'phone', 'social', 'event'];
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'nurturing', 'disqualified', 'converted'];
const NEXT_STATUS = { new: ['contacted', 'qualified', 'nurturing', 'disqualified'], contacted: ['qualified', 'nurturing', 'disqualified'], qualified: ['nurturing', 'disqualified'], nurturing: ['contacted', 'qualified', 'disqualified'], disqualified: ['nurturing'], converted: [] };
const OPEN = ['new', 'viewing', 'offer', 'negotiation', 'reservation'];
const aed = (major) => (major == null || major === '' ? undefined : Math.round(Number(major) * 100));

function assignableUsers(store) {
  const scope = store.perms['leads.assign'];
  return store.users.filter((u) => u.active && ['agent', 'team_lead'].includes(u.role) && (scope === 'Tenant' || (scope === 'Team' && u.team_id === store.me.team_id)));
}

/* ================= Leads list ================= */
export async function leads(root, ctx) {
  const { store, setHeader, go } = ctx;
  let status = ctx.query.status || ''; let q = ''; let owner = '';
  const listEl = h('div');
  const search = h('input.search', { type: 'search', placeholder: 'Search name, phone or email', 'aria-label': 'Search leads', oninput: debounce((e) => { q = e.target.value.trim(); draw(); }, 250) });
  const canAssign = store.perms['leads.assign'] !== 'None';
  const ownerSel = canAssign ? h('select', { 'aria-label': 'Filter by owner', onchange: (e) => { owner = e.target.value; draw(); } }, h('option', { value: '' }, 'All owners'), assignableUsers(store).map((u) => h('option', { value: u.id }, u.name))) : null;
  setHeader(t('leads.title'), [h('button.btn.btn-primary', { onclick: () => addLead(store, (id) => go(`#/lead/${id}`)) }, icon('plus'), t('leads.add'))]);
  const statusBar = h('div.filters');
  const draw = () => {
    mount(statusBar, segmented([['', t('common.all')], ...LEAD_STATUSES.map((s) => [s, label(s)])], status, (s) => { status = s; draw(); }, 'Lead status'), search, ownerSel);
    const qs = new URLSearchParams({ ...(status && { status }), ...(q && { q }), ...(owner && { owner }) });
    load(listEl, () => get(`/leads?${qs}`), (d) => d.items.length ? h('div.table-wrap', h('table.data.clickable',
      h('thead', h('tr', ['Lead', 'Status', 'Looking for', 'Budget', 'Source', 'Owner', 'Created'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', d.items.map((l) => h('tr', { tabindex: '0', onclick: () => go(`#/lead/${l.id}`), onkeydown: (e) => { if (e.key === 'Enter') go(`#/lead/${l.id}`); } },
        h('td', h('strong', `${l.first_name} ${l.last_name}`), h('small.block', l.phone || l.email || '')),
        h('td', badge(l.status)),
        h('td', `${l.transaction_type === 'rent' ? 'Rent' : 'Buy'} · ${l.property_types.map(label).join(', ') || 'Any type'}${l.locations.length ? ' · ' + l.locations.join(', ') : ''}${l.bedrooms_min != null ? ` · ${l.bedrooms_min}+ bd` : ''}`),
        h('td.num', l.budget_max ? money(l.budget_max) : '—'),
        h('td', label(l.source)),
        h('td', l.owner_name ? h('span.person-sm', avatar(l.owner_name, l.owner_color, { size: 22 }), l.owner_name) : 'Unassigned'),
        h('td', ago(l.created_at))))))) : empty(q || status ? 'No leads match these filters' : 'No leads yet', 'Add a lead or wait for new enquiries to be assigned to you.',
        h('button.btn.btn-primary', { onclick: () => addLead(store, (id) => go(`#/lead/${id}`)) }, t('leads.add'))));
  };
  mount(root, h('div.stack', statusBar, listEl));
  draw();
}

function addLead(store, after) {
  const canAssign = store.perms['leads.assign'] !== 'None';
  const people = assignableUsers(store);
  formModal({
    title: t('leads.add'), submitLabel: 'Create lead', wide: true,
    fields: [
      { type: 'section', label: 'Contact' },
      { name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name' },
      { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+971 …', hint: 'Phone or email is required.' }, { name: 'email', label: 'Email', type: 'email' },
      { type: 'section', label: 'Requirement' },
      { name: 'transaction_type', label: 'Looking to', type: 'select', options: [['buy', 'Buy'], ['rent', 'Rent']], value: 'buy' },
      { name: 'budget_max', label: 'Maximum budget (AED)', type: 'number', min: 0, step: 1000, hint: 'For rentals: annual rent.' },
      { name: 'property_types', label: 'Property types', type: 'multiselect', options: PTYPES },
      { name: 'locations', label: 'Preferred communities (comma-separated)', placeholder: 'Dubai Marina, JBR', full: true },
      { name: 'bedrooms_min', label: 'Minimum bedrooms', type: 'number', min: 0, max: 20 },
      { name: 'source', label: 'Source', type: 'select', options: SOURCES, value: 'manual' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
      ...(canAssign ? [{ type: 'section', label: 'Assignment' }, { name: 'assign', label: 'Assign to', type: 'select', options: [['self', 'Me'], ['round_robin', `Round-robin in ${store.team?.name || 'my team'}`], ['manual', 'A specific person']], value: 'self' },
        { name: 'owner_id', label: 'Person (when “a specific person”)', type: 'select', options: [['', '—'], ...people.map((u) => [u.id, u.name])] }] : []),
    ],
    submit: async (v) => {
      const body = { ...v, budget_max: aed(v.budget_max), locations: v.locations ? v.locations.split(',').map((s) => s.trim()).filter(Boolean) : [] };
      if (body.assign !== 'manual') delete body.owner_id;
      if (body.assign === 'manual' && !body.owner_id) throw Object.assign(new Error('Choose the person to assign to.'), { details: { owner_id: 'Required' } });
      const r = await post('/leads', body);
      toast(`Lead created and assigned to ${r.item.owner_name}`);
      after(r.item.id);
    },
  });
}

/* ================= Lead detail ================= */
export async function lead(root, ctx) {
  const { store, setHeader, go } = ctx;
  const body = h('div');
  const draw = () => load(body, () => get(`/leads/${ctx.id}`), (d) => {
    const l = d.item;
    const canUpdate = l.owner_id === store.me.id || store.perms['leads.update'] !== 'Own';
    const canAssign = store.perms['leads.assign'] !== 'None';
    setHeader(`${l.first_name} ${l.last_name}`, [
      h('a.btn.btn-ghost', { href: '#/leads' }, '← All leads'),
      canUpdate ? h('button.btn.btn-ghost', { onclick: () => logActivity({ lead_id: l.id }, draw) }, icon('phone'), 'Log activity') : null,
      canUpdate && NEXT_STATUS[l.status].length ? h('button.btn.btn-ghost', { onclick: () => changeStatus(l, draw) }, 'Change status') : null,
      canAssign && l.status !== 'converted' ? h('button.btn.btn-ghost', { onclick: () => reassign(store, l, draw) }, 'Reassign') : null,
      canUpdate && l.status === 'qualified' ? h('button.btn.btn-primary', { onclick: () => convert(l, null, go) }, 'Convert to deal') : null,
    ]);
    const timeline = [
      ...d.history.map((x) => ({ at: x.at, kind: 'status', text: x.from_status ? `Status ${label(x.from_status)} → ${label(x.to_status)}${x.reason ? ` (${x.reason})` : ''}` : 'Lead created', who: x.actor_name })),
      ...d.assignments.map((x) => ({ at: x.at, kind: 'assign', text: `Assigned to ${x.to_name} (${label(x.method)})`, who: x.actor_name })),
      ...d.activities.map((x) => ({ at: x.occurred_at, kind: x.type, text: x.summary, who: x.user_name })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const matchesEl = h('div');
    const matchesPanel = panel('Matching listings', matchesEl, { sub: 'Must: available, budget, type, buy/rent. Prefer: location and bedrooms. Every reason is shown.' });
    loadMatches(matchesEl, l, canUpdate, go);
    return h('div.detail-grid',
      h('div.stack',
        panel('Requirement', h('dl.facts',
          fact('Status', badge(l.status)), fact('Looking to', l.transaction_type === 'rent' ? 'Rent' : 'Buy'), fact('Budget', l.budget_max ? money(l.budget_max, { compact: false }) : 'Not set'),
          fact('Types', l.property_types.map(label).join(', ') || 'Any'), fact('Communities', l.locations.join(', ') || 'Any'), fact('Bedrooms', l.bedrooms_min != null ? `${l.bedrooms_min}+` : 'Any'),
          fact('Source', label(l.source) + (l.campaign ? ` · ${l.campaign}` : '')), fact('Owner', l.owner_name || 'Unassigned'), fact('First contact', l.first_contact_at ? dateTime(l.first_contact_at) : 'Not yet'),
          l.disqualify_reason ? fact('Disqualified because', l.disqualify_reason) : null, l.notes ? fact('Notes', l.notes) : null),
          { actions: canUpdate && l.status !== 'converted' ? h('button.btn.btn-small', { onclick: () => editRequirement(l, draw) }, t('common.edit')) : null }),
        panel('Contact', h('dl.facts', fact('Phone', l.phone || '—'), fact('Email', l.email || '—'), fact('Roles', (l.roles || []).map(label).join(', ')))),
        d.deals.length ? panel('Deals', h('ul.list-plain', d.deals.map((x) => h('li.row-link', h('a', { href: `#/pipeline?deal=${x.id}` }, h('span', x.title), h('small', money(x.value))), badge(x.stage))))) : null,
        panel('Timeline', timeline.length ? h('ol.timeline', timeline.map((x) => h('li', { class: `tl-${x.kind}` }, h('span.tl-dot'), h('div', h('p', x.text), h('small', `${x.who || 'System'} · ${dateTime(x.at)}`))))) : empty('No activity yet'))),
      h('div.stack', matchesPanel));
  });
  mount(root, body);
  draw();
}
const fact = (k, v) => h('div.fact', h('dt', k), h('dd', v));

async function loadMatches(el, l, canUpdate, go) {
  let includeUnverified = false;
  const run = () => load(el, () => get(`/leads/${l.id}/matches${includeUnverified ? '?includeUnverified=1' : ''}`), (d) => h('div.stack',
    h('label.inline-check', h('input', { type: 'checkbox', checked: includeUnverified, onchange: (e) => { includeUnverified = e.target.checked; run(); } }), ' Include unverified imports'),
    d.items.length ? h('ul.matches', d.items.map((m) => h('li.match',
      h('div.match-head', h('strong', m.property.title), h('span.price', money(m.property.price))),
      h('small', `${m.property.ref} · ${m.property.community} · ${m.property.bedrooms ?? '—'} bd · ${num(m.property.area_sqft)} sq ft · ${label(m.property.authority)} inventory`),
      h('ul.reasons', m.reasons.map((r) => h('li', r))),
      canUpdate && l.status === 'qualified' ? h('button.btn.btn-small', { onclick: () => convert(l, m.property, go) }, 'Start deal with this listing') : null)))
      : empty('No listings match the must-have criteria', 'Widen the budget or property types, or include unverified imports.')));
  run();
}

function changeStatus(l, after) {
  formModal({
    title: 'Change lead status', submitLabel: 'Update status',
    fields: [{ name: 'status', label: 'New status', type: 'select', required: true, options: NEXT_STATUS[l.status].map((s) => [s, label(s)]) }, { name: 'reason', label: 'Reason (required to disqualify)', type: 'textarea' }],
    submit: async (v) => { await post(`/leads/${l.id}/status`, v); toast(`Status set to ${label(v.status)}`); after(); },
  });
}
function reassign(store, l, after) {
  formModal({
    title: 'Reassign lead', submitLabel: 'Reassign',
    fields: [{ name: 'owner_id', label: 'New owner', type: 'select', required: true, options: [['', 'Choose…'], ...assignableUsers(store).filter((u) => u.id !== l.owner_id).map((u) => [u.id, `${u.name} — ${u.team_name || ''}`])] }],
    submit: async (v) => { await post(`/leads/${l.id}/assign`, v); toast('Lead reassigned. The new owner was notified.'); after(); },
  });
}
function editRequirement(l, after) {
  formModal({
    title: 'Edit requirement', submitLabel: 'Save requirement',
    fields: [
      { name: 'transaction_type', label: 'Looking to', type: 'select', options: [['buy', 'Buy'], ['rent', 'Rent']], value: l.transaction_type },
      { name: 'budget_max', label: 'Maximum budget (AED)', type: 'number', min: 0, step: 1000, value: l.budget_max ? l.budget_max / 100 : '' },
      { name: 'property_types', label: 'Property types', type: 'multiselect', options: PTYPES, value: l.property_types },
      { name: 'locations', label: 'Communities (comma-separated)', value: l.locations.join(', '), full: true },
      { name: 'bedrooms_min', label: 'Minimum bedrooms', type: 'number', min: 0, value: l.bedrooms_min ?? '' },
      { name: 'notes', label: 'Notes', type: 'textarea', value: l.notes || '' },
    ],
    submit: async (v) => { await patch(`/leads/${l.id}`, { ...v, budget_max: aed(v.budget_max), locations: (v.locations || '').split(',').map((s) => s.trim()).filter(Boolean) }); toast('Requirement saved'); after(); },
  });
}
function convert(l, property, go) {
  formModal({
    title: 'Convert to deal', submitLabel: 'Create deal', intro: property ? `Linked listing: ${property.ref} — ${property.title}` : 'You can link a listing later from the pipeline.',
    fields: [{ name: 'title', label: 'Deal title', value: `${l.first_name} ${l.last_name} — ${property ? property.project || property.title : l.transaction_type === 'rent' ? 'rental' : 'purchase'}`, full: true },
      { name: 'value', label: 'Expected transaction value (AED)', type: 'number', min: 0, step: 1000, value: property ? property.price / 100 : '' }],
    submit: async (v) => { const r = await post(`/leads/${l.id}/convert`, { title: v.title, value: aed(v.value), property_id: property?.id }); toast('Deal created'); go(`#/pipeline?deal=${r.deal_id}`); },
  });
}
export function logActivity(target, after) {
  formModal({
    title: 'Log activity', submitLabel: 'Log it',
    fields: [{ name: 'type', label: 'Type', type: 'select', options: [['call', 'Call'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['note', 'Note']], value: 'call' },
      { name: 'duration_min', label: 'Duration (minutes, calls)', type: 'number', min: 0, max: 600 }, { name: 'summary', label: 'What happened', type: 'textarea', required: true }],
    submit: async (v) => { const r = await post('/activities', { ...target, ...v }); toast(r.points ? `Logged · +${r.points} points` : 'Logged (daily activity points cap reached)'); after?.(); },
  });
}

/* ================= Pipeline ================= */
export async function pipeline(root, ctx) {
  const { store, setHeader } = ctx;
  let owner = '';
  const board = h('div');
  const people = store.users.filter((u) => ['agent', 'team_lead'].includes(u.role) && (store.perms['deals.read'] === 'Tenant' || (store.perms['deals.read'] === 'Team' && u.team_id === store.me.team_id)));
  const ownerSel = store.perms['deals.read'] !== 'Own' ? h('select', { 'aria-label': 'Filter by owner', onchange: (e) => { owner = e.target.value; draw(); } }, h('option', { value: '' }, 'Everyone in scope'), people.map((u) => h('option', { value: u.id }, u.name))) : null;
  setHeader(t('pipeline.title'), [ownerSel, h('button.btn.btn-primary', { onclick: () => newDeal(store, draw) }, icon('plus'), t('pipeline.add'))]);
  let dragId = null;
  const draw = () => load(board, () => get(`/deals${owner ? `?owner=${owner}` : ''}`), (d) => {
    const byStage = Object.fromEntries([...OPEN, 'won', 'lost'].map((s) => [s, d.items.filter((x) => x.stage === s)]));
    const card = (x) => h('article.deal-card', { draggable: 'true', tabindex: '0', dataset: { id: x.id }, style: { '--stage': STAGE_COLORS[x.stage] },
      ondragstart: (e) => { dragId = x.id; e.dataTransfer.setData('text/plain', x.id); e.currentTarget.classList.add('dragging'); },
      ondragend: (e) => e.currentTarget.classList.remove('dragging'),
      onclick: () => openDeal(store, x.id, draw), onkeydown: (e) => { if (e.key === 'Enter') openDeal(store, x.id, draw); } },
      h('strong', x.title), h('span.deal-val', x.value ? money(x.value) : 'Value not set'),
      h('small', [x.property_ref, x.contact_name].filter(Boolean).join(' · ')),
      h('div.deal-foot', h('span.person-sm', avatar(x.owner_name, x.owner_color, { size: 20 }), x.owner_name), x.expected_close ? h('small', `close ${shortDate(x.expected_close)}`) : null));
    const column = (s) => {
      const items = byStage[s]; const total = items.reduce((a, x) => a + x.value, 0);
      return h('section.kcol', { 'aria-label': `${label(s)} stage`,
        ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave: (e) => e.currentTarget.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); const id = e.dataTransfer.getData('text/plain') || dragId; const deal = d.items.find((x) => x.id === id); if (deal && deal.stage !== s) moveStage(store, deal, s, draw); } },
        h('header.kcol-head', h('span.kdot', { style: { background: STAGE_COLORS[s] } }), h('strong', label(s)), h('span.kcount', String(items.length)), h('small', money(total))),
        h('div.kcol-body', items.length ? items.map(card) : h('p.kempty', 'Drop a deal here')));
    };
    const closed = (s) => h('details.closed-col', h('summary', h('span.kdot', { style: { background: STAGE_COLORS[s] } }), `${label(s)} · ${byStage[s].length} · ${money(byStage[s].reduce((a, x) => a + x.value, 0))}`),
      h('div.kcol-body', byStage[s].slice(0, 30).map(card)));
    return h('div.stack',
      h('p.muted', 'Drag a card to another stage, or open it to change stage with the keyboard. Winning needs a linked listing and value; losing needs a reason.'),
      h('div.kanban', OPEN.map(column), h('section.kcol.kcol-won', { 'aria-label': 'Won and lost',
        ondragover: (e) => { e.preventDefault(); }, ondrop: (e) => { e.preventDefault(); const deal = d.items.find((x) => x.id === (e.dataTransfer.getData('text/plain') || dragId)); if (deal) moveStage(store, deal, 'won', draw); } },
      h('header.kcol-head', h('strong', 'Closed')), h('div.kcol-body', closed('won'), closed('lost')))));
  });
  mount(root, board);
  draw();
  if (ctx.query.deal) openDeal(store, ctx.query.deal, draw);
}

async function moveStage(store, deal, stage, after) {
  let reason;
  if (stage === 'lost') { reason = await confirmModal({ title: `Mark “${deal.title}” lost?`, body: 'The deal closes and leaves the open pipeline.', confirmLabel: 'Mark lost', danger: true, reasonLabel: 'Why was it lost?' }); if (!reason) return; }
  else if (stage === 'won') { const ok = await confirmModal({ title: `Mark “${deal.title}” won?`, body: `Closes the deal at ${money(deal.value, { compact: false })}. Platform-controlled listings are marked sold or rented.`, confirmLabel: 'Mark won' }); if (!ok) return; }
  else if (['won', 'lost'].includes(deal.stage)) { reason = await confirmModal({ title: 'Reopen deal?', body: 'Closed deals reopen into negotiation. Management only.', confirmLabel: 'Reopen', reasonLabel: 'Reason for reopening' }); if (!reason) return; stage = 'negotiation'; }
  try {
    const r = await post(`/deals/${deal.id}/stage`, { stage, reason });
    toast(`Moved to ${label(stage)}${r.notes?.length ? ' · ' + r.notes.join(' ') : ''}`);
    after();
  } catch (e) { toast(e.message, 'error'); }
}

async function openDeal(store, id, after) {
  const bodyEl = h('div', loading());
  const m = modal({ title: 'Deal', body: bodyEl, wide: true });
  try {
    const d = await get(`/deals/${id}`);
    const x = d.item;
    m.dialog.querySelector('h2').textContent = x.title;
    const closedDeal = ['won', 'lost'].includes(x.stage);
    const stageSel = h('select', { 'aria-label': 'Stage' }, [...OPEN, 'won', 'lost'].map((s) => h('option', { value: s, selected: s === x.stage }, label(s))));
    mount(bodyEl, h('div.detail-grid',
      h('div.stack',
        h('dl.facts', fact('Stage', badge(x.stage)), fact('Value', x.value ? money(x.value, { compact: false }) : 'Not set'), fact('Commission rate', `${(x.commission_bp / 100).toFixed(2)}%`),
          fact('Gross commission', x.value ? money(Math.round((x.value * x.commission_bp) / 10000), { compact: false }) : '—'), fact('Listing', x.property_title ? `${x.property_ref} — ${x.property_title}` : 'Not linked'),
          fact('Client', `${x.contact_name}${x.contact_phone ? ' · ' + x.contact_phone : ''}`), fact('Owner', x.owner_name), fact('Expected close', x.expected_close ? shortDate(x.expected_close) : '—'),
          x.closed_at ? fact('Closed', dateTime(x.closed_at)) : null, x.lost_reason ? fact('Lost because', x.lost_reason) : null),
        h('div.btn-row',
          (!closedDeal || store.isMgmt()) ? h('div.inline-form', stageSel, h('button.btn.btn-primary', { onclick: () => { m.close(); moveStage(store, x, stageSel.value, after); } }, closedDeal ? 'Reopen' : 'Move stage')) : null,
          !closedDeal ? h('button.btn.btn-ghost', { onclick: () => { m.close(); editDeal(x, after); } }, 'Edit details') : null,
          h('button.btn.btn-ghost', { onclick: () => logActivity({ deal_id: x.id }, () => { m.close(); openDeal(store, id, after); }) }, 'Log activity'),
          h('a.btn.btn-ghost', { href: `#/calendar?new=viewing&deal=${x.id}`, onclick: () => m.close() }, 'Book viewing'),
          !closedDeal && x.property_id && store.can('reservations.create') ? h('button.btn.btn-ghost', { onclick: () => { m.close(); holdUnit(store, { id: x.property_id, ref: x.property_ref }, after, x); } }, 'Hold unit') : null)),
      h('div.stack',
        h('h3.sub-h', 'Stage history'), h('ol.timeline', d.history.slice().reverse().map((s) => h('li', h('span.tl-dot'), h('div', h('p', s.from_stage ? `${label(s.from_stage)} → ${label(s.to_stage)}` : 'Created'), h('small', `${s.actor_name || 'System'} · ${dateTime(s.at)}${s.reason ? ' · ' + s.reason : ''}`))))),
        h('h3.sub-h', 'Activity'), d.activities.length || d.events.length ? h('ol.timeline', [...d.activities.map((a) => ({ at: a.occurred_at, t: `${label(a.type)}: ${a.summary}`, w: a.user_name })), ...d.events.map((e) => ({ at: e.start_at, t: `${label(e.type)} — ${e.title} (${label(e.status)})`, w: '' }))]
          .sort((a, b) => b.at.localeCompare(a.at)).map((a) => h('li', h('span.tl-dot'), h('div', h('p', a.t), h('small', `${a.w ? a.w + ' · ' : ''}${dateTime(a.at)}`))))) : h('p.muted', 'No activity yet.'))));
  } catch (e) { mount(bodyEl, errorState(e)); }
}

async function editDeal(x, after) {
  const props = (await get('/properties?status=available')).items;
  formModal({
    title: 'Edit deal', submitLabel: 'Save deal',
    fields: [
      { name: 'title', label: 'Title', value: x.title, full: true },
      { name: 'property_id', label: 'Listing', type: 'select', options: [['', 'Not linked'], ...(x.property_id && !props.some((p) => p.id === x.property_id) ? [[x.property_id, `${x.property_ref} — ${x.property_title}`]] : []), ...props.map((p) => [p.id, `${p.ref} — ${p.title} (${money(p.price)})`])], value: x.property_id || '' },
      { name: 'value', label: 'Transaction value (AED)', type: 'number', min: 0, step: 1000, value: x.value ? x.value / 100 : '' },
      { name: 'commission_pct', label: 'Commission rate (%)', type: 'number', min: 0, max: 20, step: 0.25, value: x.commission_bp / 100 },
      { name: 'expected_close', label: 'Expected close', type: 'date', value: x.expected_close ? x.expected_close.slice(0, 10) : '' },
    ],
    submit: async (v) => {
      await patch(`/deals/${x.id}`, { title: v.title, property_id: v.property_id, value: aed(v.value), commission_bp: v.commission_pct != null ? Math.round(v.commission_pct * 100) : undefined, expected_close: v.expected_close ? `${v.expected_close}T12:00:00.000Z` : undefined });
      toast('Deal saved'); after();
    },
  });
}

async function newDeal(store, after) {
  const [contacts, props] = await Promise.all([get('/contacts'), get('/properties?status=available')]);
  formModal({
    title: t('pipeline.add'), submitLabel: 'Create deal',
    intro: 'Most deals start from a qualified lead (Leads → Convert to deal). Use this for repeat clients.',
    fields: [
      { name: 'contact_id', label: 'Client', type: 'select', required: true, options: [['', 'Choose a contact…'], ...contacts.items.map((c) => [c.id, `${c.first_name} ${c.last_name}`])] },
      { name: 'title', label: 'Title', required: true, full: true },
      { name: 'property_id', label: 'Listing', type: 'select', options: [['', 'Not linked yet'], ...props.items.map((p) => [p.id, `${p.ref} — ${p.title} (${money(p.price)})`])] },
      { name: 'value', label: 'Expected value (AED)', type: 'number', min: 0, step: 1000 },
    ],
    submit: async (v) => { await post('/deals', { ...v, value: aed(v.value) }); toast('Deal created'); after(); },
  });
}

/* ================= Listings ================= */
export async function listings(root, ctx) {
  const { store, setHeader } = ctx;
  const f = { status: ctx.query.project ? '' : 'available', listing_type: '', type: '', authority: '', mine: '', q: '', project_id: ctx.query.project || '' };
  const grid = h('div');
  let projectsList = [];
  try { projectsList = (await get('/projects')).items; } catch { /* optional */ }
  setHeader(t('listings.title'), [h('button.btn.btn-primary', { onclick: () => editListing(store, null, draw, projectsList) }, icon('plus'), t('listings.add'))]);
  const sel = (key, opts, aria) => h('select', { 'aria-label': aria, onchange: (e) => { f[key] = e.target.value; draw(); } }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));
  const filters = h('div.filters',
    h('input.search', { type: 'search', placeholder: 'Search title, community or ref', 'aria-label': 'Search listings', oninput: debounce((e) => { f.q = e.target.value.trim(); draw(); }, 250) }),
    sel('status', [['', 'Any status'], ...['available', 'on_hold', 'reserved', 'sold', 'rented', 'off_market'].map((s) => [s, label(s)])], 'Status'),
    sel('project_id', [['', 'All projects'], ...projectsList.map((p) => [p.id, p.name])], 'Project'),
    sel('listing_type', [['', 'Sale & rent'], ['sale', 'For sale'], ['rent', 'For rent']], 'Listing type'),
    sel('type', [['', 'All types'], ...PTYPES.map((s) => [s, label(s)])], 'Property type'),
    sel('authority', [['', 'Any control'], ['platform', 'We control'], ['external', 'Developer controls'], ['unverified', 'Unverified import']], 'Inventory authority'),
    h('label.inline-check', h('input', { type: 'checkbox', onchange: (e) => { f.mine = e.target.checked ? '1' : ''; draw(); } }), ' Mine only'));
  const canHold = store.can('reservations.create');
  const draw = () => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    load(grid, () => get(`/properties?${qs}`), (d) => d.items.length ? h('div.listing-grid', d.items.map((p) => h('article.listing',
      h('div.listing-top', h('span.ref', p.ref), badge(p.status), h('span', { class: `conf conf-${p.availability_confidence}`, title: p.last_verified_at ? `Last verified ${dateTime(p.last_verified_at)}` : 'Never verified' }, `${label(p.availability_confidence)}`)),
      h('h3', p.title), h('p.listing-price', money(p.price, { compact: false }), p.listing_type === 'rent' ? h('small', ' / year') : null),
      h('p.listing-meta', [p.bedrooms != null ? (p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} bd`) : null, p.bathrooms != null ? `${p.bathrooms} ba` : null, p.area_sqft ? `${num(p.area_sqft)} sq ft` : null, label(p.completion)].filter(Boolean).join(' · ')),
      h('p.listing-loc', `${p.community || ''}${p.project ? ' · ' + p.project : ''}`),
      h('p.listing-auth', `${p.authority === 'platform' ? 'We control availability' : p.authority === 'external' ? 'Developer controls availability — our holds are internal' : 'Unverified import — hidden from matching'}${p.project_name && p.authority !== 'unverified' ? ' (set by project)' : ''}${p.permit_no ? ' · permit ' + p.permit_no : ''}`),
      p.reservation_id ? h('p.res-chip', { class: `res-${p.reservation_status}` }, `${label(p.reservation_status)} by ${p.reservation_agent}`, p.reservation_expires_at ? ` · until ${dateTime(p.reservation_expires_at)}` : '', ' ', h('a', { href: '#/reservations' }, 'Open')) : null,
      h('div.listing-foot', h('span.person-sm', p.agent_name || '—'), h('div.btn-row',
        canHold && p.status === 'available' && p.authority !== 'unverified' ? h('button.btn.btn-small.btn-primary', { onclick: () => holdUnit(store, p, draw) }, 'Hold unit') : null,
        p.can_edit && (p.availability_confidence !== 'confirmed' || p.authority === 'unverified') ? h('button.btn.btn-small', { onclick: async () => { try { await patch(`/properties/${p.id}`, { verify: true, ...(p.authority === 'unverified' && !p.project_id ? { authority: 'platform' } : {}) }); toast(`${p.ref} verified`); draw(); } catch (e) { toast(e.message, 'error'); } } }, 'Mark verified') : null,
        p.can_edit ? h('button.btn.btn-small.btn-ghost', { onclick: () => editListing(store, p, draw, projectsList) }, t('common.edit')) : null)))))
      : empty('No listings match', 'Change the filters or add a listing.'));
  };
  mount(root, h('div.stack', filters, grid));
  draw();
}

function editListing(store, p, after, projectsList = []) {
  const agents = store.users.filter((u) => u.active && ['agent', 'team_lead'].includes(u.role));
  const canPickAgent = store.perms['properties.update'] !== 'Own';
  const held = p && ['on_hold', 'reserved'].includes(p.status);
  formModal({
    title: p ? `Edit ${p.ref}` : t('listings.add'), submitLabel: p ? 'Save listing' : 'Add listing', wide: true,
    intro: held ? 'This unit has an active reservation, so its status is managed from Reservations.' : null,
    fields: [
      { name: 'title', label: 'Title', required: true, value: p?.title, full: true },
      { name: 'project_id', label: 'Project', type: 'select', options: [['', 'No project (standalone)'], ...projectsList.map((x) => [x.id, `${x.name} — ${x.authority === 'external' ? 'developer controls' : 'we control'}`])], value: p?.project_id || '', hint: 'Units in a project follow its availability setting.' },
      { name: 'type', label: 'Type', type: 'select', required: true, options: PTYPES, value: p?.type || 'apartment' },
      { name: 'listing_type', label: 'Listing', type: 'select', options: [['sale', 'For sale'], ['rent', 'For rent (annual)']], value: p?.listing_type || 'sale' },
      { name: 'price', label: 'Price (AED)', type: 'number', required: true, min: 1, step: 1000, value: p ? p.price / 100 : '' },
      ...(held ? [] : [{ name: 'status', label: 'Status', type: 'select', options: ['available', 'sold', 'rented', 'off_market'], value: p?.status || 'available' }]),
      { name: 'bedrooms', label: 'Bedrooms (0 = studio)', type: 'number', min: 0, value: p?.bedrooms ?? '' },
      { name: 'bathrooms', label: 'Bathrooms', type: 'number', min: 0, value: p?.bathrooms ?? '' },
      { name: 'area_sqft', label: 'Area (sq ft)', type: 'number', min: 1, value: p?.area_sqft ?? '' },
      { name: 'completion', label: 'Completion (standalone units)', type: 'select', options: [['ready', 'Ready'], ['off_plan', 'Off-plan']], value: p?.completion || 'ready' },
      { name: 'community', label: 'Community', value: p?.community },
      { name: 'developer', label: 'Developer (standalone units)', value: p?.developer },
      { name: 'authority', label: 'Who controls availability? (standalone units)', type: 'select', options: [['platform', 'We do'], ['external', 'Developer / external system'], ['unverified', 'Unverified import']], value: p?.authority || 'platform' },
      { name: 'permit_no', label: 'Advertising permit no.', value: p?.permit_no, hint: 'Record before advertising publicly. Requirements to be verified.' },
      { name: 'permit_expiry', label: 'Permit expiry', type: 'date', value: p?.permit_expiry ? p.permit_expiry.slice(0, 10) : '' },
      ...(canPickAgent ? [{ name: 'agent_id', label: 'Listing agent', type: 'select', options: agents.map((u) => [u.id, u.name]), value: p?.agent_id || store.me.id }] : []),
    ],
    submit: async (v) => {
      const body = { ...v, price: aed(v.price), permit_expiry: v.permit_expiry ? `${v.permit_expiry}T12:00:00.000Z` : undefined };
      // Project units take availability control from the project; only "unverified" can be set on them.
      if (body.project_id && body.authority !== 'unverified') delete body.authority;
      if (p && body.status === p.status) delete body.status;
      if (p && !body.project_id && !p.project_id) delete body.project_id;
      if (body.project_id) { delete body.developer; delete body.completion; }
      if (p) await patch(`/properties/${p.id}`, body); else await post('/properties', body);
      toast(p ? 'Listing saved' : 'Listing added'); after();
    },
  });
}

export function debounce(fn, ms) { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }
