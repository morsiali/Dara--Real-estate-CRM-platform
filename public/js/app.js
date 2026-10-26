// App shell: session bootstrap, role-aware navigation, hash router, notifications, real-time stream.
import { get, post, patch } from './api.js';
import { h, mount, icon, avatar, toast, formModal, ago, clear } from './ui.js';
import { t, setLang, getLang, applyDir } from './i18n.js';
import * as views from './views/index.js';
import { forcedSetupScreen, securityDialog, verifyBanner, recoveryReminder } from './security.js';

export const store = {
  me: null, team: null, tenant: null, perms: {}, users: [], usersById: new Map(), online: new Set(),
  listeners: new Map(),
  on(evt, fn) { if (!this.listeners.has(evt)) this.listeners.set(evt, new Set()); this.listeners.get(evt).add(fn); return () => this.listeners.get(evt).delete(fn); },
  emit(evt, data) { for (const fn of this.listeners.get(evt) || []) { try { fn(data); } catch (e) { console.error(e); } } },
  can(action) { return (this.perms[action] || 'None') !== 'None'; },
  isMgmt() { return ['admin', 'manager'].includes(this.me?.role); },
  user(id) { return this.usersById.get(id); },
};

const NAV = [
  { group: 'nav.workspace', items: [
    { route: 'home', icon: 'home', key: 'nav.home' },
    { route: 'me', icon: 'user', key: 'nav.me' },
    { route: 'team', icon: 'team', key: 'nav.team', when: () => store.can('analytics.time') },
    { route: 'leaderboard', icon: 'trophy', key: 'nav.leaderboard' },
  ] },
  { group: 'nav.sales', items: [
    { route: 'leads', icon: 'lead', key: 'nav.leads' },
    { route: 'assistant', icon: 'layers', key: 'nav.assistant' },
    { route: 'pipeline', icon: 'pipeline', key: 'nav.pipeline' },
    { route: 'listings', icon: 'building', key: 'nav.listings' },
    { route: 'projects', icon: 'tower', key: 'nav.projects' },
    { route: 'reservations', icon: 'key', key: 'nav.reservations' },
  ] },
  { group: 'nav.work', items: [
    { route: 'tasks', icon: 'tasks', key: 'nav.tasks', badge: 'tasks' },
    { route: 'calendar', icon: 'calendar', key: 'nav.calendar' },
    { route: 'chat', icon: 'chat', key: 'nav.chat', badge: 'chat' },
    { route: 'time', icon: 'clock', key: 'nav.time', when: () => store.can('analytics.time') },
  ] },
  { group: 'nav.admin', when: () => store.can('users.manage') || store.can('audit.read'), items: [
    { route: 'workspace', icon: 'shield', key: 'nav.settings' },
    { route: 'people', icon: 'team', key: 'nav.people', when: () => store.can('users.manage') },
    { route: 'audit', icon: 'log', key: 'nav.audit', when: () => store.can('audit.read') },
  ] },
];

const els = {};
let cleanup = null;
const badges = { tasks: 0, chat: 0 };

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { route: parts[0] || 'home', id: parts[1] ? decodeURIComponent(parts[1]) : null, query: Object.fromEntries(new URLSearchParams(qs)) };
}
export const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

function buildShell() {
  const shell = document.getElementById('shell');
  els.nav = h('nav.side-nav', { 'aria-label': 'Main' });
  els.notifBtn = h('button.icon-btn.notif-btn', { 'aria-label': t('common.notifications'), 'aria-haspopup': 'true', onclick: toggleNotifs }, icon('bell'), h('span.count', { hidden: true }));
  els.notifPanel = h('div.notif-panel', { hidden: true, role: 'dialog', 'aria-label': t('common.notifications') });
  els.title = h('h1.page-title');
  els.actions = h('div.page-actions');
  els.main = h('main#main.content', { tabindex: '-1' });
  const me = store.me;
  const userMenu = h('details.user-menu',
    h('summary', { 'aria-label': 'Account' }, avatar(me.name, me.color, { size: 34 })),
    h('div.user-pop',
      h('div.user-head', h('strong', me.name), h('span', `${t('role.' + me.role)}${store.team ? ' · ' + store.team.name : ''}`)),
      h('button.menu-item', { onclick: changePassword }, icon('key'), t('common.password')),
      h('button.menu-item', { onclick: () => { userMenu.open = false; securityDialog(store); } }, icon('lock'), t('common.mfa'), h('span.menu-state', me.mfa_enabled ? 'On' : 'Off')),
      h('button.menu-item', { onclick: () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); patch('/auth/me', { locale: getLang() }).catch(() => {}); rebuild(); } }, icon('globe'), t('common.language')),
      h('button.menu-item', { onclick: signOut }, icon('logout'), t('common.signout'))));
  els.menuBtn = h('button.icon-btn.menu-toggle', { 'aria-label': 'Menu', 'aria-expanded': 'false', onclick: () => { const open = shell.classList.toggle('nav-open'); els.menuBtn.setAttribute('aria-expanded', String(open)); } }, icon('menu'));
  mount(shell,
    h('aside.sidebar',
      h('a.brand', { href: '#/home' }, h('span.brand-mark', { html: '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1d47d6"/><path d="M9 25V11l7-4 7 4v14" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><rect x="13.5" y="15" width="5" height="10" rx="1" fill="#34d399"/></svg>' }), h('span.brand-name', 'Dara')),
      h('div.tenant-name', store.tenant?.name || ''),
      els.nav,
      h('div.side-foot', h('span.synthetic', 'Demo workspace · synthetic data'))),
    h('div.main-col',
      h('header.topbar', els.menuBtn, h('div.title-wrap', els.title), els.actions, h('div.top-tools', els.notifBtn, els.notifPanel, userMenu)),
      subscriptionBanner(),
      verifyBanner(store.me),
      els.main));
  shell.removeAttribute('aria-busy');
  shell.addEventListener('click', (e) => { if (e.target.closest('.side-nav a')) shell.classList.remove('nav-open'); });
  document.addEventListener('click', (e) => { if (!els.notifPanel.hidden && !e.target.closest('.notif-panel, .notif-btn')) els.notifPanel.hidden = true; });
  renderNav();
}

const PLATFORM_NAV = [{ group: 'nav.platformGroup', items: [{ route: 'platform', icon: 'globe', key: 'nav.platform' }] }];

function renderNav() {
  const { route } = parseHash();
  clear(els.nav);
  for (const g of store.me.platform_admin ? PLATFORM_NAV : NAV) {
    if (g.when && !g.when()) continue;
    const items = g.items.filter((i) => !i.when || i.when());
    els.nav.append(h('div.nav-group', h('span.nav-label', t(g.group)), h('ul', items.map((i) => {
      const active = route === i.route || (i.route === 'leads' && route === 'lead') || (i.route === 'me' && route === 'member' && parseHash().id === store.me.id);
      const count = i.badge ? badges[i.badge] : 0;
      return h('li', h('a', { href: `#/${i.route}`, class: active ? 'active' : '', 'aria-current': active ? 'page' : null }, icon(i.icon), h('span', t(i.key)), count ? h('span.nav-count', { 'aria-label': `${count} pending` }, String(count)) : null));
    }))));
  }
}

/** Trial countdown / read-only notice (Part F3). */
function subscriptionBanner() {
  const tn = store.tenant;
  if (!tn || tn.is_platform) return null;
  if (tn.access === 'read_only') return h('div.sub-banner.ro', { role: 'status' }, h('strong', 'Read-only workspace. '), 'Your subscription isn’t active, so changes are paused. Everything stays viewable', store.can('data.export') ? [' and ', h('a', { href: '/api/export' }, 'exportable')] : null, '. Contact Dara to reactivate.');
  if (tn.status === 'trial' && tn.trial_ends_at) {
    const days = Math.max(0, Math.ceil((Date.parse(tn.trial_ends_at) - Date.now()) / 864e5));
    return h('div.sub-banner', { role: 'status' }, `Trial: ${days} day${days === 1 ? '' : 's'} left. `, store.can('workspace.manage') ? h('a', { href: '#/workspace' }, 'See plan and usage') : null);
  }
  return null;
}

export function setHeader(title, actions = []) {
  els.title.textContent = title;
  document.title = `${title} · Dara`;
  mount(els.actions, actions);
}

async function render() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const r = parseHash();
  renderNav();
  setHeader('');
  if (store.me.platform_admin && r.route !== 'platform') { location.hash = '#/platform'; return; }
  const view = views.routes[r.route] || views.routes.home;
  clear(els.main);
  els.main.scrollTop = 0;
  try { cleanup = (await view(els.main, { ...r, store, setHeader, go })) || null; }
  catch (e) { console.error(e); mount(els.main, h('div.state.state-error', h('strong', 'This page failed to open.'), h('p', e.message))); }
  els.main.focus({ preventScroll: true });
}

/* ---------- Notifications ---------- */
async function refreshNotifs() {
  try {
    const d = await get('/notifications');
    const c = els.notifBtn.querySelector('.count');
    c.hidden = !d.unread; c.textContent = d.unread > 9 ? '9+' : String(d.unread);
    els.notifBtn.setAttribute('aria-label', `${t('common.notifications')}${d.unread ? ` (${d.unread} unread)` : ''}`);
    mount(els.notifPanel,
      h('div.notif-head', h('strong', t('common.notifications')), d.unread ? h('button.link-btn', { onclick: async () => { await post('/notifications/read-all'); refreshNotifs(); } }, t('common.markAll')) : null),
      d.items.length ? h('ul.notif-list', d.items.map((n) => h('li', { class: n.read_at ? '' : 'unread' },
        h('button.notif-item', { onclick: async () => { els.notifPanel.hidden = true; await post(`/notifications/${n.id}/read`).catch(() => {}); if (n.link) go(n.link); refreshNotifs(); } },
          h('span.n-title', n.title), n.body ? h('span.n-body', n.body) : null, h('span.n-time', ago(n.created_at)))))) : h('p.muted.pad', 'You’re all caught up.'));
  } catch { /* shown on next attempt */ }
}
function toggleNotifs() { els.notifPanel.hidden = !els.notifPanel.hidden; if (!els.notifPanel.hidden) refreshNotifs(); }

async function refreshBadges() {
  try {
    const [tasks, chans] = await Promise.all([
      get('/tasks?view=mine'),
      get('/channels'),
    ]);
    let review = 0;
    if (store.can('tasks.review')) review = (await get('/tasks?view=review')).items.length;
    badges.tasks = tasks.items.filter((x) => ['todo', 'changes_requested'].includes(x.status)).length + review;
    badges.chat = chans.items.reduce((s, c) => s + (c.unread || 0), 0);
    for (const id of chans.online) store.online.add(id);
    renderNav();
  } catch { /* non-critical */ }
}

/* ---------- Real-time stream ---------- */
function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    store.emit('message', m);
    if (m.user_id !== store.me.id && !(parseHash().route === 'chat' && parseHash().id === m.channel_id)) { badges.chat++; renderNav(); }
  });
  es.addEventListener('notification', (e) => { const n = JSON.parse(e.data); toast(n.title, 'info'); refreshNotifs(); store.emit('notification', n); refreshBadges(); });
  es.addEventListener('presence', (e) => { const p = JSON.parse(e.data); p.online ? store.online.add(p.userId) : store.online.delete(p.userId); store.emit('presence', p); });
  es.addEventListener('points', (e) => { const p = JSON.parse(e.data); toast(`+${p.points} points · ${p.reason}`, 'points'); store.emit('points', p); });
  es.onerror = () => { /* EventSource reconnects automatically (retry: 3000) */ };
  return es;
}
export function bumpChatBadge(n) { badges.chat = Math.max(0, n); renderNav(); }
export const refreshNav = () => refreshBadges();

/* ---------- Account actions ---------- */
function changePassword() {
  formModal({
    title: t('common.password'), submitLabel: 'Update password',
    fields: [
      { name: 'current', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'next', label: 'New password', type: 'password', required: true, hint: 'At least 10 characters, with letters and numbers.', autocomplete: 'new-password' },
    ],
    submit: async (v) => { await post('/auth/password', v); toast('Password updated. Other sessions were signed out.'); },
  });
}
async function signOut() { await post('/auth/logout').catch(() => {}); location.href = '/'; }

export async function loadUsers() {
  const d = await get('/users');
  store.users = d.items; store.usersById = new Map(d.items.map((u) => [u.id, u]));
  for (const u of d.items) if (u.online) store.online.add(u.id);
}

function rebuild() { applyDir(); buildShell(); render(); }

async function boot() {
  applyDir();
  try {
    const me = await get('/auth/me');
    Object.assign(store, { me: me.user, team: me.team, tenant: me.tenant, perms: me.permissions });
  } catch { location.href = '/#signin'; return; }
  if (store.me.mfa_setup_required) { forcedSetupScreen(document.getElementById('shell'), store.me, store.tenant?.name); return; }
  if (store.me.locale && store.me.locale !== getLang()) { try { if (!localStorage.getItem('dara.lang')) setLang(store.me.locale); } catch { /* ignore */ } }
  if (!store.me.platform_admin) await loadUsers().catch(() => {});
  buildShell();
  window.addEventListener('hashchange', render);
  await render();
  refreshNotifs(); if (!store.me.platform_admin) refreshBadges();
  connectStream();
  if (!store.me.platform_admin) setInterval(refreshBadges, 60_000);
  recoveryReminder();
  if (parseHash().query.verified === '1') { toast('Email confirmed. You can now invite your team.'); history.replaceState(null, '', '#/home'); }
  if (store.me.must_change_password) { toast('Choose a new password to secure your account.', 'info'); changePassword(); }
}

boot();
