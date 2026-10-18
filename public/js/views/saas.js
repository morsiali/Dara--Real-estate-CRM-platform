// Projects, reservations, workspace (subscription, Dubai compliance, export) and the platform console.
import { get, post, patch } from '../api.js';
import { h, mount, load, money, num, avatar, badge, dateTime, shortDate, dateFmt, ago, icon, label, empty, formModal, toast, confirmModal, segmented } from '../ui.js';
import { t } from '../i18n.js';
import { panel, kpi } from './shared.js';
import { meter } from '../charts.js';

const AUTH_LABEL = { platform: 'We control availability', external: 'Developer controls availability' };
function countdown(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'expiring now';
  const hrs = Math.floor(ms / 3600e3); const mins = Math.floor((ms % 3600e3) / 60e3);
  return hrs >= 1 ? `${hrs} h ${mins} min left` : `${mins} min left`;
}

/* ================= Projects ================= */
export async function projects(root, ctx) {
  const { store, setHeader } = ctx;
  const canManage = store.can('projects.manage');
  const body = h('div');
  const draw = () => {
    setHeader(t('nav.projects'), [canManage ? h('button.btn.btn-primary', { onclick: () => editProject(null, draw) }, icon('plus'), 'Add project') : null]);
    load(body, () => get('/projects'), (d) => d.items.length ? h('div.stack',
      h('p.muted', 'Each project decides who controls unit availability. Its listings follow that setting — on developer-controlled projects, holds stay internal until the developer confirms.'),
      h('div.listing-grid', d.items.map((p) => h('article.listing',
        h('div.listing-top', h('span', { class: `auth-chip auth-${p.authority}` }, AUTH_LABEL[p.authority]), badge(p.completion === 'off_plan' ? 'off-plan' : 'ready', p.completion === 'off_plan' ? 'reservation' : 'available')),
        h('h3', p.name), h('p.listing-loc', [p.community, p.developer].filter(Boolean).join(' · ') || '—'),
        p.handover ? h('p.listing-meta', `Handover ${dateFmt(p.handover)}`) : null,
        h('div.unit-bar', { role: 'img', 'aria-label': `${p.available} available, ${p.held} held or reserved, ${p.closed} sold or rented of ${p.units}` },
          p.units ? [['available', p.available], ['held', p.held], ['closed', p.closed]].map(([k, n]) => n ? h(`span.ub-${k}`, { style: { flex: String(n) }, title: `${label(k)}: ${n}` }) : null) : null),
        h('p.listing-meta', `${p.units} units · ${p.available} available · ${p.held} held · ${p.closed} closed`),
        h('div.listing-foot', h('a.link', { href: `#/listings?project=${p.id}` }, 'View units'), canManage ? h('button.btn.btn-small.btn-ghost', { onclick: () => editProject(p, draw) }, t('common.edit')) : null)))))
      : empty('No projects yet', canManage ? 'Add your first project and choose who controls its availability.' : 'Management adds projects.', canManage ? h('button.btn.btn-primary', { onclick: () => editProject(null, draw) }, 'Add project') : null));
  };
  mount(root, body);
  draw();
}

function editProject(p, after) {
  formModal({
    title: p ? `Edit ${p.name}` : 'Add project', submitLabel: p ? 'Save project' : 'Add project',
    intro: p ? 'Changing who controls availability updates every listing in this project (unverified imports stay unverified).' : null,
    fields: [
      { name: 'name', label: 'Project name', required: true, value: p?.name, full: true },
      { name: 'developer', label: 'Developer', value: p?.developer }, { name: 'community', label: 'Community', value: p?.community },
      { name: 'authority', label: 'Who controls unit availability?', type: 'select', required: true, options: [['platform', 'We do — holds and reservations happen here'], ['external', 'The developer — our holds are internal until they confirm']], value: p?.authority || 'platform' },
      { name: 'completion', label: 'Completion', type: 'select', options: [['ready', 'Ready'], ['off_plan', 'Off-plan']], value: p?.completion || 'ready' },
      { name: 'handover', label: 'Expected handover', type: 'date', value: p?.handover ? p.handover.slice(0, 10) : '' },
    ],
    submit: async (v) => {
      const body = { ...v, handover: v.handover ? `${v.handover}T12:00:00.000Z` : undefined };
      if (p) { const r = await patch(`/projects/${p.id}`, body); toast(r.listings_updated ? `Project saved · ${r.listings_updated} listings updated` : 'Project saved'); }
      else { await post('/projects', body); toast('Project added'); }
      after();
    },
  });
}

/* ================= Reservations ================= */
export async function reservations(root, ctx) {
  const { store, setHeader } = ctx;
  let filter = 'active';
  const body = h('div'); const tabs = h('div.filters');
  let timer;
  const draw = () => {
    setHeader(t('nav.reservations'), [h('a.btn.btn-primary', { href: '#/listings' }, icon('plus'), 'Hold a unit')]);
    mount(tabs, segmented([['active', 'Active'], ['pending_confirmation', 'Awaiting confirmation'], ['', 'All']], filter, (f) => { filter = f; draw(); }, 'Reservation filter'));
    load(body, () => get(`/reservations${filter ? `?status=${filter}` : ''}`), (d) => d.items.length ? h('div.stack',
      h('p.muted', `Holds last ${d.hold_hours} hours and can be renewed ${d.max_renewals} time by management. Only one active reservation per unit — the database enforces it.`),
      h('div.table-wrap', h('table.data',
        h('thead', h('tr', ['Unit', 'Status', 'Client / deal', 'Agent', 'Timer', 'Reference', ''].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', d.items.map((r) => h('tr',
          h('td', h('strong', r.property_ref), h('small.block', `${r.property_title}${r.project_name ? '' : ''}`), h('small.block', money(r.property_price))),
          h('td', badge(r.status), r.label ? h('small.block.warn-text', r.label) : null),
          h('td', r.contact_name || '—', r.deal_title ? h('small.block', r.deal_title) : null),
          h('td', h('span.person-sm', avatar(r.agent_name, r.agent_color, { size: 22 }), r.agent_name), r.team_name ? h('small.block', r.team_name) : null),
          h('td', ['held', 'pending_confirmation'].includes(r.status) ? h('span', { class: Date.parse(r.expires_at) - Date.now() < 6 * 3600e3 ? 'warn' : '', dataset: { expires: r.expires_at } }, countdown(r.expires_at)) : '—',
            r.renewals ? h('small.block', `renewed ${r.renewals}×`) : null),
          h('td', r.external_ref || (r.deposit_note ? h('small', r.deposit_note) : '—'), r.oqood_ref ? h('small.block', `Oqood ${r.oqood_ref}`) : null),
          h('td.right', h('div.btn-row', actions(store, r, draw)))))))))
      : empty(filter === 'active' ? 'No active holds' : 'Nothing here', 'Hold a unit from Listings or from a deal.'));
  };
  mount(root, h('div.stack', tabs, body));
  draw();
  timer = setInterval(() => { for (const el of body.querySelectorAll('[data-expires]')) el.textContent = countdown(el.dataset.expires); }, 30_000);
  return () => clearInterval(timer);
}

function actions(store, r, after) {
  const run = async (action, body, ok) => { try { await post(`/reservations/${r.id}/${action}`, body); toast(ok); after(); } catch (e) { toast(e.message, 'error'); } };
  const out = [];
  if (r.status === 'held' && r.can_manage) out.push(h('button.btn.btn-small.btn-primary', { onclick: () => formModal({ title: `Submit ${r.property_ref} for confirmation`, submitLabel: 'Submit', intro: 'Management confirms once the developer or registration reference is in hand.',
    fields: [{ name: 'deposit_note', label: 'Deposit reference', required: true, placeholder: 'e.g. cheque no. / transfer ref' }, { name: 'oqood_ref', label: 'Oqood reference (off-plan, if any)', hint: 'Tracked only — verify registration rules with counsel.' }],
    submit: async (v) => { await post(`/reservations/${r.id}/submit`, v); toast('Submitted for confirmation'); after(); } }) }, 'Submit'));
  if (r.status === 'pending_confirmation' && r.can_confirm) out.push(h('button.btn.btn-small.btn-primary', { onclick: () => formModal({ title: `Confirm ${r.property_ref}`, submitLabel: 'Confirm reservation',
    intro: r.authority === 'external' ? 'This unit is developer-controlled. Record the developer’s confirmation reference.' : 'Record the confirmation reference.',
    fields: [{ name: 'external_ref', label: 'Developer / registration reference', required: true }],
    submit: async (v) => { await post(`/reservations/${r.id}/confirm`, v); toast('Reservation confirmed'); after(); } }) }, 'Confirm'));
  if (r.can_renew) out.push(h('button.btn.btn-small.btn-ghost', { onclick: async () => { if (await confirmModal({ title: 'Renew hold?', body: `Extends ${r.property_ref} by 48 hours. A hold can be renewed once.`, confirmLabel: 'Renew' })) run('renew', {}, 'Hold renewed'); } }, 'Renew'));
  if (['held', 'pending_confirmation'].includes(r.status) && (r.can_manage || store.isMgmt()) || (r.status === 'confirmed' && store.isMgmt())) {
    out.push(h('button.btn.btn-small.btn-ghost.danger', { onclick: async () => { const reason = await confirmModal({ title: `Cancel reservation on ${r.property_ref}?`, body: 'The unit becomes available again.', confirmLabel: 'Cancel reservation', danger: true, reasonLabel: 'Reason' }); if (reason) run('cancel', { reason }, 'Reservation cancelled'); } }, 'Cancel'));
  }
  return out;
}

/** Hold dialog used from Listings and the deal dialog. */
export async function holdUnit(store, property, after, deal = null) {
  let deals = [];
  if (!deal) { try { deals = (await get('/deals?open=1')).items.filter((d) => d.owner_id === store.me.id || store.perms['deals.update'] !== 'Own'); } catch { /* optional */ } }
  formModal({
    title: `Hold ${property.ref || property.property_ref}`, submitLabel: 'Place 48-hour hold',
    intro: property.authority === 'external' ? 'Developer-controlled unit: this is an internal hold only, not a confirmed reservation with the developer.' : 'The unit shows as On hold for everyone until the hold is confirmed, cancelled or expires.',
    fields: [
      ...(deal ? [] : [{ name: 'deal_id', label: 'For deal (optional)', type: 'select', options: [['', 'No deal yet'], ...deals.map((d) => [d.id, `${d.title} — ${d.owner_name}`])], full: true }]),
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    submit: async (v) => {
      await post('/reservations', { property_id: property.id || property.property_id, deal_id: deal?.id || v.deal_id || undefined, notes: v.notes });
      toast('Unit held for 48 hours'); after?.();
    },
  });
}

/* ================= Workspace (admin/manager) ================= */
export async function workspace(root, ctx) {
  const { store, setHeader } = ctx;
  const isAdmin = store.can('workspace.manage');
  const body = h('div');
  const draw = () => {
    setHeader(t('nav.settings'), [isAdmin ? h('a.btn.btn-ghost', { href: '/api/export', download: '' }, 'Export all data (JSON)') : null]);
    load(body, () => Promise.all([get('/workspace'), get('/compliance')]), ([w, c]) => {
      const ws = w.item; const s = ws.subscription;
      const stateBadge = (st) => badge(st, { valid: 'available', expiring: 'on_hold', expired: 'lost', missing: 'new' }[st]);
      const daysLeft = s.trial_ends_at ? Math.ceil((Date.parse(s.trial_ends_at) - Date.now()) / 864e5) : null;
      return h('div.stack-lg',
        h('div.two-col',
          panel('Subscription', h('div.stack',
            h('div.plan-head', h('strong', s.plan_name), badge(s.status, s.status === 'active' ? 'active' : s.status === 'trial' ? 'submitted' : 'lost'), s.proposed ? h('small.muted', 'Plan limits are proposed') : null),
            s.status === 'trial' && daysLeft != null ? h('p', daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in the trial.` : 'The trial has ended — the workspace is read-only.') : null,
            s.access === 'read_only' ? h('p.warn', 'Read-only: you can view and export everything, but changes are paused until the subscription is active.') : null,
            ...[['Active users', 'seats'], ['Active listings', 'listings']].map(([lbl, k]) => h('div.goal-row', h('div.goal-head', h('span', lbl), h('strong', s.limits[k] == null ? `${num(s.usage[k])} · by contract` : `${num(s.usage[k])} / ${num(s.limits[k])}`)),
              s.limits[k] ? meter(s.usage[k], s.limits[k], { color: s.percent[k] >= 80 ? '#eda100' : undefined }) : null,
              s.percent[k] >= 80 ? h('small.warn-text', s.percent[k] >= 100 ? 'Limit reached — new additions are blocked.' : 'Over 80% of the plan limit.') : null)),
            h('p.muted.small', 'To change plan, contact Dara. Payments are not taken in this version.'))),
          panel('Brokerage details', h('div.stack',
            h('dl.facts', h('div.fact', h('dt', 'Name'), h('dd', ws.name)), h('div.fact', h('dt', 'Workspace ID'), h('dd', ws.slug || '—')),
              h('div.fact', h('dt', 'Trade licence'), h('dd', ws.trade_licence_no || '—')), h('div.fact', h('dt', 'Licence expiry'), h('dd', ws.trade_licence_expiry ? dateFmt(ws.trade_licence_expiry) : '—', ' ', stateBadge(c.workspace.state))),
              h('div.fact', h('dt', 'RERA office no. (ORN)'), h('dd', ws.orn || '—')), h('div.fact', h('dt', 'Created'), h('dd', dateFmt(ws.created_at)))),
            isAdmin ? h('div', h('button.btn.btn-small', { onclick: () => editWorkspace(ws, draw) }, 'Edit details')) : null))),
        panel('Broker cards (BRN)', c.people.length ? h('div.table-wrap', h('table.data',
          h('thead', h('tr', ['Person', 'Role', 'BRN', 'Expiry', 'Status'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', c.people.map((p) => h('tr', h('td', p.name), h('td', t('role.' + p.role)), h('td', p.brn || '—'), h('td', p.brn_expiry ? dateFmt(p.brn_expiry) : '—'), h('td', stateBadge(p.state)))))))
          : empty('No people in scope'), { sub: `Reminders go out ${c.reminder_days.brn} days before expiry. Edit BRNs under People & teams.` }),
        panel('Advertising permits on live listings', c.permits.length ? h('div.table-wrap', h('table.data',
          h('thead', h('tr', ['Listing', 'Permit no.', 'Expiry', 'Status'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', c.permits.slice(0, 60).map((p) => h('tr', h('td', h('strong', p.ref), h('small.block', p.title)), h('td', p.permit_no || '—'), h('td', p.permit_expiry ? dateFmt(p.permit_expiry) : '—'), h('td', stateBadge(p.state)))))))
          : empty('No live listings'), { sub: `Reminders go out ${c.reminder_days.permit} days before expiry.` }),
        h('p.muted.small', c.note));
    });
  };
  mount(root, body);
  draw();
}

function editWorkspace(ws, after) {
  formModal({
    title: 'Brokerage details', submitLabel: 'Save details', intro: 'These fields are tracked for reminders. Confirm current RERA/DLD requirements with counsel.',
    fields: [
      { name: 'name', label: 'Brokerage name', required: true, value: ws.name, full: true },
      { name: 'trade_licence_no', label: 'Trade licence no.', value: ws.trade_licence_no }, { name: 'trade_licence_expiry', label: 'Licence expiry', type: 'date', value: ws.trade_licence_expiry ? ws.trade_licence_expiry.slice(0, 10) : '' },
      { name: 'orn', label: 'RERA office registration no. (ORN)', value: ws.orn },
    ],
    submit: async (v) => { await patch('/workspace', { ...v, trade_licence_expiry: v.trade_licence_expiry ? `${v.trade_licence_expiry}T12:00:00.000Z` : undefined }); toast('Details saved'); after(); },
  });
}

/* ================= Platform console (Dara staff) ================= */
export async function platform(root, ctx) {
  const { setHeader } = ctx;
  const body = h('div');
  const draw = () => {
    setHeader(t('nav.platform'), []);
    load(body, () => Promise.all([get('/platform/summary'), get('/platform/tenants')]), ([s, d]) => h('div.stack-lg',
      h('p.dash-sub', 'Brokerage workspaces on Dara. You manage subscriptions here; brokerage data is never visible to platform accounts.'),
      h('div.kpis', kpi('Workspaces', num(s.workspaces), { accent: true }), kpi('Active seats', num(s.seats)), kpi('On trial', num(s.by_status.trial || 0)),
        kpi('Active', num(s.by_status.active || 0)), kpi('Past due', num(s.by_status.past_due || 0)), kpi('Read-only', num(s.read_only))),
      panel('Workspaces', h('div.table-wrap', h('table.data',
        h('thead', h('tr', ['Brokerage', 'Plan', 'Status', 'Seats', 'Listings', 'Admins', 'Last active', ''].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', d.items.map((x) => h('tr', { class: x.access === 'read_only' ? 'inactive' : '' },
          h('td', h('strong', x.name), h('small.block', `${x.slug} · since ${shortDate(x.created_at)}`)),
          h('td', x.plan_name), h('td', badge(x.status, x.status === 'active' ? 'active' : x.status === 'trial' ? 'submitted' : 'lost'), x.status === 'trial' && x.trial_ends_at ? h('small.block', `ends ${shortDate(x.trial_ends_at)}`) : null),
          h('td.num', x.limits.seats == null ? `${x.usage.seats}` : `${x.usage.seats} / ${x.limits.seats}`), h('td.num', x.limits.listings == null ? `${x.usage.listings}` : `${x.usage.listings} / ${x.limits.listings}`),
          h('td', x.admins.map((a) => h('small.block', `${a.name} · ${a.email}`))), h('td', ago(x.last_active)),
          h('td.right', h('button.btn.btn-small', { onclick: () => changeSubscription(x, d, draw) }, 'Change')))))))),
      h('p.muted.small', 'Plan names and limits are proposed and unvalidated. No payment provider is connected; status changes here are manual and are logged in the brokerage’s own audit trail.')));
  };
  mount(root, body);
  draw();
}

function changeSubscription(x, d, after) {
  formModal({
    title: `Subscription — ${x.name}`, submitLabel: 'Apply change', intro: 'The brokerage’s administrators are notified and the change is written to their audit log. Downgrades never delete data.',
    fields: [
      { name: 'plan', label: 'Plan', type: 'select', options: d.plans.map((p) => [p.code, `${p.name}${p.seats ? ` — ${p.seats} seats` : ' — by contract'}`]), value: x.plan },
      { name: 'status', label: 'Status', type: 'select', options: d.statuses.map((s) => [s, label(s)]), value: x.status },
      { name: 'trial_ends_at', label: 'Trial ends', type: 'date', value: x.trial_ends_at ? x.trial_ends_at.slice(0, 10) : '' },
      { name: 'reason', label: 'Reason (shown to the brokerage)', type: 'textarea', required: true },
    ],
    submit: async (v) => { await patch(`/platform/tenants/${x.id}`, { ...v, trial_ends_at: v.trial_ends_at ? `${v.trial_ends_at}T20:00:00.000Z` : undefined }); toast('Subscription updated'); after(); },
  });
}
