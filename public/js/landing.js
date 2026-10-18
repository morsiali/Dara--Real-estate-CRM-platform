// Landing interactions: live tower, role tabs, calculator, sign-in.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// CSP forbids inline style attributes, so data-* hints are applied through the CSSOM.
for (const el of $$('[data-c]')) el.style.setProperty('--c', el.dataset.c);
for (const el of $$('.ce[data-pos]')) {
  const [col, row, len] = el.dataset.pos.split(',').map(Number);
  el.style.setProperty('inset-inline-start', `calc(${col * 20}% + 4px)`); el.style.setProperty('width', 'calc(20% - 8px)');
  el.style.setProperty('top', `${row * 36 + 4}px`); el.style.setProperty('height', `${len * 36 - 8}px`);
}
for (const el of $$('.time-split [data-w]')) el.style.setProperty('flex', `0 0 ${el.dataset.w}%`);

/* ---------- Tower: 16 floors × 6 units, one orchestrated load sequence ---------- */
const tower = $('#tower');
if (tower) {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const FLOORS = 16, UNITS = 6; const cells = [];
  for (let f = FLOORS - 1; f >= 0; f--) {
    for (let u = 0; u < UNITS; u++) {
      const r = rnd();
      const cls = r < 0.42 ? 'sold' : r < 0.58 ? 'res' : r < 0.66 ? 'hold' : '';
      const c = document.createElement('span');
      c.className = `cell ${cls}`;
      c.style.setProperty('--d', `${(FLOORS - 1 - f) * 55 + u * 12}ms`);
      tower.append(c); cells.push({ el: c, f, u });
    }
  }
  const stage = $('.tower-stage');
  if (!reduced) {
    tower.classList.add('anim'); stage.classList.add('stage-anim');
    const pick = (f, u) => cells.find((c) => c.f === f && c.u === u).el;
    const steps = [
      { at: 1150, cell: pick(12, 3), to: 'res', card: '.f-1' },
      { at: 1900, cell: pick(7, 1), to: 'hold', card: '.f-2' },
      { at: 2650, cell: pick(4, 4), to: 'sold', card: '.f-3' },
    ];
    for (const s of steps) {
      setTimeout(() => {
        s.cell.className = `cell ${s.to} lit`;
        $(s.card)?.classList.add('in');
        setTimeout(() => s.cell.classList.remove('lit'), 900);
      }, s.at);
    }
  }
}

/* ---------- Role tabs (WAI-ARIA tabs with arrow keys) ---------- */
const tabs = $$('.role-tabs [role=tab]');
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
  }
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    const dir = document.dir === 'rtl' ? -1 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = tabs[(i + (e.key === 'ArrowRight' ? dir : -dir) + tabs.length) % tabs.length]; selectTab(n); n.focus(); }
  });
});

/* ---------- Calculator (illustrative; multiplies the user's own assumptions) ---------- */
const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
function aed(v) { return v >= 1e6 ? `AED ${nf(v / 1e6, 1)}M` : `AED ${nf(v / 1e3)}K`; }
function calc() {
  const months = +$('#c-months').value, seats = +$('#c-seats').value;
  const leads = Math.max(0, +$('#c-leads').value || 0), conv = Math.max(0, +$('#c-conv').value || 0), value = Math.max(0, +$('#c-value').value || 0), comm = Math.max(0, +$('#c-comm').value || 0);
  const deals = Math.round(seats * months * leads * (conv / 100));
  $('#o-months').textContent = `${months} month${months > 1 ? 's' : ''}`;
  $('#o-seats').textContent = `${seats} agents`;
  $('#o-deals').textContent = nf(deals);
  $('#o-comm').textContent = aed(deals * value * (comm / 100));
  $('#o-formula').textContent = `${seats} seats × ${months} months × ${nf(leads)} leads × ${nf(conv, 1)}% conversion = ${nf(deals)} deals; × AED ${nf(value)} × ${nf(comm, 2)}% commission`;
}
for (const id of ['#c-months', '#c-seats', '#c-leads', '#c-conv', '#c-value', '#c-comm']) $(id)?.addEventListener('input', calc);
if ($('#c-months')) calc();

/* ---------- Sign in ---------- */
const DEMO = { manager: 'manager@dara.demo', lead: 'lead@dara.demo', agent: 'agent@dara.demo', admin: 'admin@dara.demo', platform: 'platform@dara.demo', owner: 'owner@palmcoast.demo' };
const form = $('#signin-form'); const msg = $('#signin-msg'); const btn = $('#signin-btn');
function fill(role) { $('#email').value = DEMO[role]; $('#password').value = 'DaraDemo2026'; msg.textContent = ''; }
for (const b of $$('[data-fill]')) b.addEventListener('click', () => { fill(b.dataset.fill); btn.focus(); });
for (const a of $$('[data-demo]')) a.addEventListener('click', (e) => { e.preventDefault(); fill(a.dataset.demo); $('#signin').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); setTimeout(() => btn.focus({ preventScroll: true }), reduced ? 0 : 450); });

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#email').value.trim(); const password = $('#password').value;
  if (!email || !password) { msg.textContent = 'Enter your email and password.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…'; msg.textContent = '';
  try {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dara' }, body: JSON.stringify({ email, password }), credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || 'Sign-in failed.');
    btn.textContent = 'Opening your workspace…';
    location.href = '/app#/home';
  } catch (err) {
    msg.textContent = err.message === 'Failed to fetch' ? 'Can’t reach the server. Check that Dara is running.' : err.message;
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});

// Existing session → offer a shortcut; expired session → explain.
(async () => {
  const note = $('#session-note');
  if (new URLSearchParams(location.search).get('signin') === 'expired') { note.textContent = 'Your session ended. Sign in again to continue.'; note.hidden = false; }
  try {
    const r = await fetch('/api/auth/session', { credentials: 'same-origin' });
    const { user } = r.ok ? await r.json() : {};
    if (user) {
      note.textContent = ''; const a = document.createElement('a'); a.href = '/app#/home'; a.textContent = 'Go to your workspace';
      note.append(`Signed in as ${user.name}. `, a); note.hidden = false;
      const nav = $('#nav-signin'); nav.textContent = 'Workspace'; nav.href = '/app#/home';
    }
  } catch { /* offline: leave form */ }
})();

/* ---------- Plans (from the server's entitlement table, so the page never disagrees with enforcement) ---------- */
(async () => {
  const grid = $('#plan-grid'); if (!grid) return;
  try {
    const d = await (await fetch('/api/plans')).json();
    const blurb = { trial: `Try everything for ${d.trial_days} days`, starter: 'A focused boutique team', professional: 'Several teams with team leads', business: 'Multi-branch brokerages', enterprise: 'Developers and large networks' };
    for (const p of d.plans) {
      const card = document.createElement('article'); card.className = `plan-card${p.code === 'professional' ? ' featured' : ''}`;
      const h3 = document.createElement('h3'); h3.textContent = p.name;
      const sub = document.createElement('p'); sub.textContent = blurb[p.code] || '';
      const seats = document.createElement('p'); seats.className = 'plan-seats'; seats.textContent = p.seats ? `Up to ${p.seats} users` : 'Users by agreement';
      const listings = document.createElement('p'); listings.className = 'plan-list'; listings.textContent = p.listings ? `${p.listings.toLocaleString('en-US')} active listings` : 'Listings by agreement';
      const a = document.createElement('a'); a.className = p.code === 'trial' ? 'btn-mint' : 'btn-outline'; a.href = '#trial'; a.textContent = p.code === 'trial' ? 'Start trial' : p.code === 'enterprise' ? 'Talk to us' : 'Start with a trial';
      card.append(h3, sub, seats, listings, a); grid.append(card);
    }
  } catch { grid.textContent = 'Plans are temporarily unavailable.'; }
})();

/* ---------- Trial signup ---------- */
const trial = $('#trial-form');
trial?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#trial-msg'); const b = $('#trial-btn');
  const body = Object.fromEntries(['company', 'name', 'email', 'password', 'trade_licence_no', 'orn'].map((k) => [k, trial.elements[k].value.trim() || undefined]));
  body.accept_terms = $('#t-terms').checked;
  if (!body.company || !body.name || !body.email || !body.password) { msg.textContent = 'Fill in brokerage, name, email and password.'; return; }
  if (!body.accept_terms) { msg.textContent = 'Accept the trial terms to continue.'; return; }
  b.disabled = true; b.textContent = 'Creating your workspace…'; msg.textContent = '';
  try {
    const res = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dara' }, body: JSON.stringify(body), credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const det = data?.error?.details; const first = det && typeof det === 'object' ? Object.entries(det)[0] : null;
      throw new Error(first && data.error.code === 'VALIDATION_FAILED' ? `${data.error.message} (${first[0].replace('_', ' ')} ${first[1]})` : data?.error?.message || 'Could not create the workspace.');
    }
    location.href = '/app#/home';
  } catch (err) { msg.textContent = err.message; b.disabled = false; b.textContent = 'Create workspace'; }
});
