// People & teams (user management) and the audit log.
import { get, post, patch } from '../api.js';
import { h, mount, load, avatar, badge, dateTime, ago, icon, label, empty, formModal, toast, confirmModal } from '../ui.js';
import { t } from '../i18n.js';
import { panel } from './shared.js';
import { loadUsers } from '../app.js';

const ROLES = ['agent', 'team_lead', 'manager', 'admin'];

export async function people(root, ctx) {
  const { store, setHeader } = ctx;
  const body = h('div');
  const isAdmin = store.me.role === 'admin';
  const allowedRoles = isAdmin ? ROLES : ['agent', 'team_lead'];
  const draw = () => {
    setHeader(t('people.title'), [h('button.btn.btn-primary', { onclick: () => addUser() }, icon('plus'), 'Add person'), isAdmin ? h('button.btn.btn-ghost', { onclick: () => addTeam() }, 'Add team') : null]);
    load(body, () => Promise.all([get('/users'), get('/teams'), get('/permissions')]), ([u, tm, perm]) => {
      const canEdit = (x) => isAdmin || ['agent', 'team_lead'].includes(x.role);
      return h('div.stack-lg',
        h('div.team-cards', tm.items.map((x) => h('div.team-card', h('strong', x.name), h('span', `${x.members} active members`), h('small', `Lead: ${x.lead_name || 'none'}`),
          isAdmin ? h('button.btn.btn-small.btn-ghost', { onclick: () => editTeam(x, u.items) }, t('common.edit')) : null))),
        panel(`People · ${u.items.length}`, h('div.table-wrap', h('table.data',
          h('thead', h('tr', ['Person', 'Role', 'Team', 'BRN', 'Status', 'Last active', ''].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', u.items.map((x) => h('tr', { class: x.active ? '' : 'inactive' },
            h('td', h('span.person', avatar(x.name, x.color, { size: 30, online: x.online }), h('span', h('strong', x.name), h('small', x.email)))),
            h('td', t('role.' + x.role)), h('td', x.team_name || '—'), h('td', x.brn ? h('span', x.brn, h('small.block', x.brn_expiry ? `exp. ${x.brn_expiry.slice(0, 10)}` : '')) : '—'), h('td', x.active ? badge('active') : badge('deactivated', 'lost')),
            h('td', x.online ? 'Online' : ago(x.last_seen_at)),
            h('td.right', canEdit(x) && x.id !== store.me.id ? h('div.btn-row',
              h('button.btn.btn-small.btn-ghost', { onclick: () => editUser(x, tm.items) }, t('common.edit')),
              h('button.btn.btn-small.btn-ghost', { class: x.active ? 'danger' : '', onclick: () => toggleActive(x) }, x.active ? 'Deactivate' : 'Reactivate')) : null))))))),
        panel('Role permissions', h('div.table-wrap', h('table.data.perm',
          h('thead', h('tr', h('th', { scope: 'col' }, 'Action'), perm.roles.map((r) => h('th', { scope: 'col' }, t('role.' + r))))),
          h('tbody', Object.entries(perm.matrix).map(([k, v]) => h('tr', h('td', label(k.replace('.', ' · '))), perm.roles.map((r) => h('td', h('span', { class: `scope s-${v[r].toLowerCase()}` }, v[r])))))))),
          { sub: 'Own = their records · Team = their team · Tenant = whole company · None = no access. Enforced on the server for every request.' }));
    });
  };
  const teamOpts = (teams) => [['', 'No team'], ...teams.map((x) => [x.id, x.name])];
  async function addUser() {
    const teams = (await get('/teams')).items;
    formModal({
      title: 'Add person', submitLabel: 'Create account', intro: 'They’ll be asked to choose a new password at first sign-in.',
      fields: [{ name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Work email', type: 'email', required: true },
        { name: 'role', label: 'Role', type: 'select', options: allowedRoles.map((r) => [r, t('role.' + r)]), value: 'agent' }, { name: 'team_id', label: 'Team', type: 'select', options: teamOpts(teams) },
        { name: 'title', label: 'Job title' }, { name: 'phone', label: 'Phone' },
        { name: 'brn', label: 'Broker card no. (BRN)', hint: 'Dubai — requirement to be verified.' }, { name: 'brn_expiry', label: 'BRN expiry', type: 'date' },
        { name: 'password', label: 'Temporary password', type: 'text', required: true, hint: 'At least 10 characters with letters and numbers. Share it privately.' }],
      submit: async (v) => { await post('/users', { ...v, brn_expiry: v.brn_expiry ? `${v.brn_expiry}T12:00:00.000Z` : undefined }); await loadUsers(); toast(`${v.name} added`); draw(); },
    });
  }
  function editUser(x, teams) {
    formModal({
      title: `Edit ${x.name}`, submitLabel: 'Save',
      fields: [{ name: 'role', label: 'Role', type: 'select', options: allowedRoles.map((r) => [r, t('role.' + r)]), value: x.role }, { name: 'team_id', label: 'Team', type: 'select', options: teamOpts(teams), value: x.team_id || '' },
        { name: 'title', label: 'Job title', value: x.title || '' }, { name: 'phone', label: 'Phone', value: x.phone || '' },
        { name: 'brn', label: 'Broker card no. (BRN)', value: x.brn || '' }, { name: 'brn_expiry', label: 'BRN expiry', type: 'date', value: x.brn_expiry ? x.brn_expiry.slice(0, 10) : '' },
        { name: 'password', label: 'Reset password (optional)', type: 'text', hint: 'Leave blank to keep the current password. Resetting signs them out.' }],
      submit: async (v) => { const body = { ...v, team_id: v.team_id ?? '', brn_expiry: v.brn_expiry ? `${v.brn_expiry}T12:00:00.000Z` : undefined }; if (!body.password) delete body.password; await patch(`/users/${x.id}`, body); await loadUsers(); toast('Saved'); draw(); },
    });
  }
  async function toggleActive(x) {
    const ok = await confirmModal({ title: x.active ? `Deactivate ${x.name}?` : `Reactivate ${x.name}?`, body: x.active ? 'They’ll be signed out and can’t sign in. Their records stay in place and can be reassigned.' : 'They’ll be able to sign in again.', confirmLabel: x.active ? 'Deactivate' : 'Reactivate', danger: x.active });
    if (!ok) return;
    try { await patch(`/users/${x.id}`, { active: !x.active }); await loadUsers(); toast(x.active ? 'Deactivated' : 'Reactivated'); draw(); } catch (e) { toast(e.message, 'error'); }
  }
  function addTeam() {
    formModal({ title: 'Add team', submitLabel: 'Create team', intro: 'A team chat channel is created automatically.',
      fields: [{ name: 'name', label: 'Team name', required: true }, { name: 'lead_id', label: 'Team lead', type: 'select', options: [['', 'Choose later'], ...store.users.filter((u) => u.active && ['agent', 'team_lead'].includes(u.role)).map((u) => [u.id, u.name])] }],
      submit: async (v) => { await post('/teams', v); await loadUsers(); toast('Team created'); draw(); } });
  }
  function editTeam(x, users) {
    formModal({ title: `Edit ${x.name}`, submitLabel: 'Save',
      fields: [{ name: 'name', label: 'Team name', value: x.name, required: true }, { name: 'lead_id', label: 'Team lead', type: 'select', options: [['', 'Unchanged'], ...users.filter((u) => u.active && ['agent', 'team_lead'].includes(u.role)).map((u) => [u.id, u.name])], value: x.lead_id || '' }],
      submit: async (v) => { await patch(`/teams/${x.id}`, v); await loadUsers(); toast('Saved'); draw(); } });
  }
  mount(root, body);
  draw();
}

export async function audit(root, ctx) {
  const { setHeader } = ctx;
  let entity = '';
  const body = h('div');
  const draw = () => {
    setHeader(t('audit.title'), [h('select', { 'aria-label': 'Filter by record type', onchange: (e) => { entity = e.target.value; draw(); } },
      ['', 'lead', 'deal', 'task', 'event', 'property', 'user', 'team', 'announcement', 'channel'].map((x) => h('option', { value: x, selected: x === entity }, x ? label(x) : 'All records')))]);
    load(body, () => get(`/audit${entity ? `?entity=${entity}` : ''}`), (d) => d.items.length ? panel('Latest 200 events', h('div.table-wrap', h('table.data',
      h('thead', h('tr', ['When', 'Who', 'Action', 'Record', 'Details'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', d.items.map((a) => h('tr', h('td', dateTime(a.at)), h('td', a.actor_name || 'System'), h('td', h('code', a.action)), h('td', `${label(a.entity)} ${a.entity_id ? a.entity_id.slice(-6) : ''}`), h('td.small', a.data ? summarize(a.data) : '')))))))
      : empty('No audit events'));
  };
  mount(root, body);
  draw();
}
function summarize(data) {
  try { const o = JSON.parse(data); return Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ').slice(0, 160); } catch { return ''; }
}
