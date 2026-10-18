// DOM + formatting helpers and shared components (modal, toast, states, avatars, badges, forms).
import { getLang } from './i18n.js';

/** h('div.class#id', {props}, ...children). Safe by default: strings become text nodes. */
export function h(sel, props = {}, ...children) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { children.unshift(props); props = {}; }
  const [, tag = 'div', rest = ''] = sel.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1));
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v; // only for trusted, escaped markup (charts/icons)
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...kids) => { clear(el); append(el, kids); return el; };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Formatting (tenant time zone: Asia/Dubai) ---------- */
export const TZ = 'Asia/Dubai';
const loc = () => (getLang() === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE');
export function money(minor, { compact = true, currency = 'AED' } = {}) {
  if (minor == null) return '—';
  const v = minor / 100;
  if (compact && Math.abs(v) >= 1e6) return `${currency} ${(v / 1e6).toLocaleString(loc(), { maximumFractionDigits: Math.abs(v) >= 1e8 ? 0 : Math.abs(v) >= 1e7 ? 1 : 2 })}M`;
  if (compact && Math.abs(v) >= 1e4) return `${currency} ${(v / 1e3).toLocaleString(loc(), { maximumFractionDigits: 0 })}K`;
  return `${currency} ${v.toLocaleString(loc(), { maximumFractionDigits: 0 })}`;
}
export const num = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString(loc(), { maximumFractionDigits: d }));
export const pct = (n) => (n == null ? '—' : `${num(n, 1)}%`);
const fmt = (opts) => new Intl.DateTimeFormat(loc(), { timeZone: TZ, ...opts });
export const dateFmt = (iso) => (iso ? fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—');
export const shortDate = (iso) => (iso ? fmt({ day: 'numeric', month: 'short' }).format(new Date(iso)) : '—');
export const timeFmt = (iso) => (iso ? fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '');
export const dateTime = (iso) => (iso ? `${shortDate(iso)}, ${timeFmt(iso)}` : '—');
export const weekday = (iso) => fmt({ weekday: 'short' }).format(new Date(iso));
export function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return shortDate(iso);
}
/** Dubai local date parts for an ISO instant. */
export function localParts(iso) {
  const d = new Date(Date.parse(iso) + 4 * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), dow: (d.getUTCDay() + 6) % 7 };
}
/** ISO instant for a Dubai local wall-clock time. */
export const dubaiIso = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m, d, h - 4, min)).toISOString();
/** value for <input type=datetime-local> in Dubai time */
export function toLocalInput(iso) {
  const p = localParts(iso); const z = (n) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.m + 1)}-${z(p.d)}T${z(p.h)}:${z(p.min)}`;
}
export function fromLocalInput(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
  return m ? dubaiIso(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
export const label = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/* ---------- Small components ---------- */
export const avatar = (name, color = '#2a78d6', { size = 32, online = false } = {}) =>
  h('span.avatar', { style: { '--av': color, '--sz': `${size}px` }, title: name, 'aria-hidden': 'true' }, initials(name), online ? h('span.dot-online') : null);

export const badge = (value, kind = value) => h(`span.badge.b-${String(kind).replace(/[^a-z_]/g, '')}`, label(value));

export function icon(name, size = 18) {
  const P = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
    team: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7-1a3 3 0 1 0 0-6M2 20a7 7 0 0 1 14 0m1.5-6.5A6 6 0 0 1 22 20',
    trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM5 5h3v2a3 3 0 0 1-3-3zm14 0h-3v2a3 3 0 0 0 3-3zM12 13v4m-4 3h8',
    lead: 'M4 5h16v4H4zm0 7h10m-10 4h7', pipeline: 'M4 5h4v14H4zm6 3h4v11h-4zm6 4h4v7h-4z', building: 'M5 21V4h9v17m0-11h5v11M8 8h3m-3 4h3m-3 4h3',
    tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2', calendar: 'M4 6h16v14H4zm0 4h16M8 3v4m8-4v4',
    chat: 'M4 5h16v11H9l-5 4z', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v5l3 2', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    log: 'M6 3h9l4 4v14H6zm3 7h7m-7 4h7m-7 4h4', bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zm4 4h4', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18',
    check: 'M5 12l5 5 9-10', flame: 'M12 21c4 0 7-3 7-7 0-5-5-6-5-11-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 8 0 4 3 7 7 7z', key: 'M14 10a4 4 0 1 0-1 2.7L20 20m-3-3l2-2',
    tower: 'M8 21V5l4-2 4 2v16M6 21h12M11 8h2m-2 4h2m-2 4h2', door: 'M6 21V3h12v18M14 12h1M3 21h18', layers: 'M12 3l9 5-9 5-9-5zm-9 9l9 5 9-5', menu: 'M4 6h16M4 12h16M4 18h16',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 2l-4-4', send: 'M4 12l16-8-6 16-2-7z', globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    arrowUp: 'M12 19V5m-6 6l6-6 6 6', arrowDown: 'M12 5v14m-6-6l6 6 6-6', match: 'M4 7h10m0 0l-3-3m3 3l-3 3M20 17H10m0 0l3-3m-3 3l3 3',
    phone: 'M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z', chevron: 'M9 6l6 6-6 6', logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
    copy: 'M9 9h10v11H9zM5 15V4h10', download: 'M12 4v11M7 10l5 5 5-5M5 20h14', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  };
  return h('span.icon', { 'aria-hidden': 'true', html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${P[name] || P.layers}"/></svg>` });
}

export const loading = (text = 'Loading…') => h('div.state.state-loading', { role: 'status' }, h('span.spinner'), text);
export const empty = (title, body, action) => h('div.state.state-empty', h('strong', title), body ? h('p', body) : null, action || null);
export const errorState = (err, retry) => h('div.state.state-error', { role: 'alert' },
  h('strong', err.status === 403 ? 'You don’t have access to this.' : err.status === 404 ? 'Not found.' : 'This didn’t load.'),
  h('p', err.message), retry ? h('button.btn.btn-ghost', { onclick: retry }, 'Try again') : null);

/** Renders `loader()` result into `el` via `render(data)`, with loading + error states. */
export async function load(el, loader, render) {
  mount(el, loading());
  try { const data = await loader(); mount(el, render(data)); return data; }
  catch (e) { if (e.name === 'AbortError') return null; mount(el, errorState(e, () => load(el, loader, render))); return null; }
}

/* ---------- Toasts ---------- */
export function toast(message, kind = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div#toasts', { 'aria-live': 'polite' }); document.body.append(host); }
  const el = h(`div.toast.toast-${kind}`, { role: kind === 'error' ? 'alert' : 'status' }, message);
  host.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? 6000 : 3200);
}

/* ---------- Modal ---------- */
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const prev = document.activeElement;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); onClose?.(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // focus trap
      const f = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  };
  const titleId = 'm' + Math.random().toString(36).slice(2);
  const dialog = h(`div.modal${wide ? '.modal-wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('header.modal-head', h('h2', { id: titleId }, title), h('button.icon-btn', { 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div.modal-body', body),
    actions.length ? h('footer.modal-foot', actions) : null);
  const overlay = h('div.overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } }, dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  setTimeout(() => (dialog.querySelector('input, select, textarea') || dialog.querySelector('button'))?.focus(), 20);
  return { close, dialog };
}

/**
 * Form modal. fields: [{name,label,type,required,options,value,hint,min,max,step,placeholder}]
 * submit(values) may throw ApiError; field errors from err.details are shown inline.
 */
export function formModal({ title, fields, submitLabel = 'Save', submit, intro, wide }) {
  const inputs = {};
  const errors = {};
  const formEl = h('form.form', { novalidate: true });
  if (intro) formEl.append(h('p.form-intro', intro));
  const grid = h('div.form-grid');
  for (const f of fields) {
    if (f.type === 'section') { grid.append(h('h3.form-section', f.label)); continue; }
    const id = 'f_' + f.name;
    let input;
    if (f.type === 'select') {
      input = h('select', { id, name: f.name, required: f.required }, (f.options || []).map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, label(o)];
        return h('option', { value: v, selected: String(f.value ?? '') === String(v) }, l);
      }));
    } else if (f.type === 'multiselect') {
      input = h('div.chips-select', { id, role: 'group', 'aria-label': f.label }, (f.options || []).map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, label(o)];
        return h('label.chip-opt', h('input', { type: 'checkbox', value: v, checked: (f.value || []).includes(v) }), h('span', l));
      }));
    } else if (f.type === 'textarea') input = h('textarea', { id, name: f.name, rows: f.rows || 3, required: f.required, placeholder: f.placeholder || '', maxlength: f.max || 4000 }, f.value ?? '');
    else if (f.type === 'checkbox') input = h('input', { id, name: f.name, type: 'checkbox', checked: !!f.value });
    else input = h('input', { id, name: f.name, type: f.type || 'text', required: f.required, value: f.value ?? '', min: f.min, max: f.max, step: f.step, placeholder: f.placeholder || '', autocomplete: f.autocomplete || 'off' });
    inputs[f.name] = { f, input };
    errors[f.name] = h('span.field-error', { id: id + '_err', 'aria-live': 'polite' });
    if (f.type !== 'multiselect' && f.type !== 'checkbox') input.setAttribute('aria-describedby', id + '_err');
    const wrap = h(`div.field${f.full || f.type === 'textarea' || f.type === 'multiselect' ? '.full' : ''}${f.type === 'checkbox' ? '.check' : ''}`,
      f.type === 'checkbox' ? h('label', { for: id }, input, ' ', f.label) : h('label', { for: id }, f.label, f.required ? h('span.req', { 'aria-hidden': 'true' }, ' *') : null),
      f.type === 'checkbox' ? null : input, f.hint ? h('span.hint', f.hint) : null, errors[f.name]);
    grid.append(wrap);
  }
  formEl.append(grid);
  const general = h('div.form-error', { role: 'alert' });
  formEl.append(general);
  const submitBtn = h('button.btn.btn-primary', { type: 'submit' }, submitLabel);
  const values = () => {
    const out = {};
    for (const [name, { f, input }] of Object.entries(inputs)) {
      if (f.type === 'multiselect') out[name] = [...input.querySelectorAll('input:checked')].map((x) => x.value);
      else if (f.type === 'checkbox') out[name] = input.checked;
      else if (f.type === 'number') out[name] = input.value === '' ? undefined : Number(input.value);
      else out[name] = input.value === '' ? undefined : input.value;
    }
    return out;
  };
  let m;
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const el of Object.values(errors)) el.textContent = '';
    general.textContent = '';
    // Client-side required check (server re-validates).
    let bad = false;
    for (const [name, { f, input }] of Object.entries(inputs)) {
      if (f.required && f.type !== 'multiselect' && !String(input.value).trim()) { errors[name].textContent = 'Required'; bad = true; }
    }
    if (bad) { general.textContent = 'Fill in the required fields.'; return; }
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
    try { await submit(values(), m); m.close(); }
    catch (err) {
      general.textContent = err.message || 'Could not save.';
      if (err.details && typeof err.details === 'object') for (const [k, v] of Object.entries(err.details)) if (errors[k]) errors[k].textContent = typeof v === 'string' ? v : '';
    } finally { submitBtn.disabled = false; submitBtn.textContent = submitLabel; }
  });
  m = modal({ title, body: formEl, wide, actions: [h('button.btn.btn-ghost', { type: 'button', onclick: () => m.close() }, 'Cancel'), submitBtn] });
  submitBtn.addEventListener('click', () => formEl.requestSubmit());
  return m;
}

export function confirmModal({ title, body, confirmLabel = 'Confirm', danger = false, reasonLabel }) {
  return new Promise((resolve) => {
    let done = false;
    const reason = reasonLabel ? h('textarea', { rows: 3, id: 'confirm_reason', 'aria-label': reasonLabel, placeholder: reasonLabel }) : null;
    const err = h('div.form-error', { role: 'alert' });
    const ok = h(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
      onclick: () => {
        if (reason && !reason.value.trim()) { err.textContent = `${reasonLabel} is required.`; reason.focus(); return; }
        done = true; m.close(); resolve(reason ? reason.value.trim() : true);
      },
    }, confirmLabel);
    const m = modal({ title, body: h('div', h('p', body), reason ? h('div.field.full', reason) : null, err), actions: [h('button.btn.btn-ghost', { onclick: () => m.close() }, 'Cancel'), ok], onClose: () => { if (!done) resolve(null); } });
  });
}

/** Segmented control (period switcher etc.). */
export function segmented(options, value, onChange, ariaLabel = 'Choose') {
  const wrap = h('div.segmented', { role: 'radiogroup', 'aria-label': ariaLabel });
  for (const [v, l] of options) {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '' }, l);
    b.addEventListener('click', () => { if (v !== value) onChange(v); });
    wrap.append(b);
  }
  return wrap;
}

export function delta(cur, prev, { invert = false } = {}) {
  if (cur == null || prev == null) return null;
  if (prev === 0 && cur === 0) return h('span.delta.flat', '±0');
  if (prev === 0) return h('span.delta.up', 'new');
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  const good = invert ? d < 0 : d > 0;
  return h(`span.delta.${Math.abs(d) < 0.5 ? 'flat' : good ? 'up' : 'down'}`, { title: 'Change vs previous period' }, `${d > 0 ? '+' : ''}${Math.round(d)}%`);
}
