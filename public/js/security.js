// Account security UI: email-verification banner, two-step sign-in setup (QR + manual key), recovery codes,
// forced setup screen for administrators, and the "Two-step sign-in" account dialog.
import { get, post } from './api.js';
import { h, mount, modal, toast, icon } from './ui.js';

/** QR code as an SVG built with DOM APIs (CSP-safe: no inline styles, no innerHTML). */
function qrSvg(text, size = 196) {
  const NS = 'http://www.w3.org/2000/svg';
  if (typeof window.qrcode !== 'function') return null;
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(); const q = 4; // quiet zone
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n + q * 2} ${n + q * 2}`); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code for your authenticator app');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#fff'); svg.append(bg);
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); path.setAttribute('fill', '#0c1630'); svg.append(path);
  return svg;
}

const groupKey = (s) => s.replace(/(.{4})/g, '$1 ').trim();

function copyBtn(text, labelText = 'Copy') {
  const b = h('button.btn.btn-ghost.btn-small', { type: 'button' }, icon('copy', 16), labelText);
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); b.lastChild.textContent = 'Copied'; setTimeout(() => { b.lastChild.textContent = labelText; }, 1600); }
    catch { toast('Copy isn’t available here — select the text instead.', 'error'); }
  });
  return b;
}

function downloadCodes(codes, email) {
  const body = `Dara recovery codes for ${email}\nGenerated ${new Date().toISOString().slice(0, 10)}\n\nEach code works once. Keep them somewhere safe and offline.\n\n${codes.join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
  const a = h('a', { href: url, download: 'dara-recovery-codes.txt' }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Recovery codes panel; resolves when the person confirms they've saved them. */
function recoveryPanel(codes, email, onDone) {
  const confirm = h('input', { type: 'checkbox', id: 'rc-saved' });
  const done = h('button.btn.btn-primary', { type: 'button', disabled: true, onclick: onDone }, 'Done');
  confirm.addEventListener('change', () => { done.disabled = !confirm.checked; });
  return h('div.mfa-step',
    h('p', 'Save these recovery codes. If you lose your phone, each code signs you in once. This is the only time they’re shown.'),
    h('ol.recovery-codes', codes.map((c) => h('li', h('code', c)))),
    h('div.btn-row', copyBtn(codes.join('\n'), 'Copy all'), h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => downloadCodes(codes, email) }, icon('download', 16), 'Download .txt')),
    h('label.check-line', confirm, ' I’ve saved my recovery codes somewhere safe'),
    h('div.btn-row.end', done));
}

/**
 * Two-step setup inside a container. Calls onEnabled() after the person has confirmed their recovery codes.
 */
async function setupInto(container, me, onEnabled) {
  mount(container, h('p.muted', 'Preparing…'));
  let setup;
  try { setup = await post('/auth/mfa/setup'); }
  catch (e) { mount(container, h('div.form-error', { role: 'alert' }, e.message)); return; }
  const code = h('input#mfa-setup-code', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, 'aria-describedby': 'mfa-setup-err', placeholder: '123456' });
  const err = h('span.field-error#mfa-setup-err', { 'aria-live': 'polite' });
  const verify = h('button.btn.btn-primary', { type: 'submit' }, 'Verify and turn on');
  const qr = qrSvg(setup.otpauth_uri);
  const form = h('form.mfa-step', { novalidate: true },
    h('ol.mfa-steps',
      h('li', 'Open an authenticator app on your phone — Google Authenticator, Microsoft Authenticator, 1Password or similar.'),
      h('li', 'Scan this code, or enter the setup key by hand.'),
      h('li', 'Type the 6-digit code the app shows.')),
    h('div.mfa-qr',
      qr ? h('div.qr-box', qr) : null,
      h('div.mfa-key',
        h('span.hint', 'Setup key'),
        h('code.setup-key', groupKey(setup.secret)),
        h('div.btn-row', copyBtn(setup.secret, 'Copy key'), h('a.btn.btn-ghost.btn-small', { href: setup.otpauth_uri }, 'Open in app')),
        h('span.hint', `Account: ${me.email} · Time-based, 6 digits, 30 seconds`))),
    h('div.field', h('label', { for: 'mfa-setup-code' }, 'Code from the app'), code, err),
    h('div.btn-row.end', verify));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = '';
    if (!/^\d{6}$/.test(code.value.trim())) { err.textContent = 'Enter the 6 digits shown in the app.'; code.focus(); return; }
    verify.disabled = true; verify.textContent = 'Checking…';
    try {
      const r = await post('/auth/mfa/enable', { code: code.value.trim() });
      mount(container, recoveryPanel(r.recovery_codes, me.email, onEnabled));
      container.querySelector('#rc-saved')?.focus();
    } catch (ex) { err.textContent = ex.message; code.select(); verify.disabled = false; verify.textContent = 'Verify and turn on'; }
  });
  mount(container, form);
  code.focus();
}

/** Full-page setup for admins whose workspace requires two-step sign-in. Nothing else loads until it's done. */
export function forcedSetupScreen(shell, me, tenantName) {
  const body = h('div.mfa-body');
  shell.className = 'forced-shell';
  mount(shell, h('main.forced-mfa#main', { tabindex: '-1' },
    h('div.forced-card',
      h('div.forced-head', icon('shield', 26), h('div', h('h1', 'Turn on two-step sign-in'),
        h('p', `${tenantName || 'Your workspace'} requires it for administrators. It protects every client record, deal and document in your workspace if your password is ever exposed.`))),
      body,
      h('div.forced-foot', h('button.link-btn', { type: 'button', onclick: async () => { await post('/auth/logout').catch(() => {}); location.href = '/'; } }, 'Sign out')))));
  shell.removeAttribute('aria-busy');
  setupInto(body, me, () => { toast('Two-step sign-in is on.'); location.reload(); });
}

/** Account dialog: status, set up, regenerate recovery codes, turn off. */
export async function securityDialog(store) {
  const body = h('div.mfa-body');
  const m = modal({ title: 'Two-step sign-in', body, wide: true });
  const refresh = async () => {
    const me = (await get('/auth/me')).user;
    store.me = { ...store.me, ...me };
    if (!me.mfa_enabled) {
      mount(body,
        h('p', 'Add a second step to signing in: after your password, you’ll enter a 6-digit code from an authenticator app on your phone.'),
        h('div.btn-row.end', h('button.btn.btn-primary', { type: 'button', onclick: () => setupInto(body, me, () => { toast('Two-step sign-in is on.'); refresh(); }) }, 'Set up')));
      return;
    }
    const regenCode = h('input#rc-code', { inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', placeholder: '123456' });
    const regenErr = h('span.field-error', { 'aria-live': 'polite' });
    const pass = h('input#mfa-off-pass', { type: 'password', autocomplete: 'current-password' });
    const offErr = h('span.field-error', { 'aria-live': 'polite' });
    mount(body,
      h('p.status-line', h('span.badge.b-won', 'On'), ' Your account asks for a code from your authenticator app at every sign-in.'),
      h('section.mfa-sec',
        h('h3', 'New recovery codes'),
        h('p.muted', 'Replaces all your old codes. Enter a current code from the app to confirm.'),
        h('div.inline-form', h('label.sr-only', { for: 'rc-code' }, 'Code from the app'), regenCode,
          h('button.btn.btn-ghost', { type: 'button', onclick: async () => {
            regenErr.textContent = '';
            try { const r = await post('/auth/mfa/recovery-codes', { code: regenCode.value.trim() }); mount(body, recoveryPanel(r.recovery_codes, me.email, () => refresh())); }
            catch (e) { regenErr.textContent = e.message; }
          } }, 'Generate')), regenErr),
      me.mfa_required
        ? h('p.muted', 'Your workspace requires two-step sign-in for administrators, so it can’t be turned off. Switching phones? Ask another administrator to reset it from People.')
        : h('section.mfa-sec',
          h('h3', 'Turn off'),
          h('p.muted', 'You’ll sign in with your password only. Confirm with your password.'),
          h('div.inline-form', h('label.sr-only', { for: 'mfa-off-pass' }, 'Password'), pass,
            h('button.btn.btn-danger', { type: 'button', onclick: async () => {
              offErr.textContent = '';
              try { await post('/auth/mfa/disable', { password: pass.value }); toast('Two-step sign-in is off.'); refresh(); }
              catch (e) { offErr.textContent = e.message; }
            } }, 'Turn off')), offErr));
  };
  try { await refresh(); } catch (e) { mount(body, h('div.form-error', e.message)); }
  return m;
}

/** "Confirm your email" banner with resend (shows the link directly in development, where no email is sent). */
export function verifyBanner(me) {
  if (me.email_verified) return null;
  const extra = h('span');
  const btn = h('button.link-btn', { type: 'button' }, 'Resend link');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const r = await post('/auth/resend-verification');
      if (r.already_verified) { location.reload(); return; }
      toast(`Confirmation link sent to ${me.email}.`);
      if (r.dev_url) { const u = new URL(r.dev_url); mount(extra, ' · Development mode: ', h('a', { href: u.pathname + u.search }, 'open the link')); }
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
  });
  return h('div.sub-banner.verify', { role: 'status' }, h('strong', 'Confirm your email. '), `We sent a link to ${me.email}. Until then you can’t invite people. `, btn, extra);
}

/** After a recovery-code sign-in, tell the person how many are left (set by the landing page). */
export function recoveryReminder() {
  let left = null;
  try { left = sessionStorage.getItem('dara.recoveryLeft'); sessionStorage.removeItem('dara.recoveryLeft'); } catch { /* storage unavailable */ }
  if (left == null) return;
  const n = Number(left);
  toast(n <= 2 ? `You signed in with a recovery code. Only ${n} left — generate new ones from Two-step sign-in.` : `You signed in with a recovery code. ${n} left.`, n <= 2 ? 'error' : 'info');
}
