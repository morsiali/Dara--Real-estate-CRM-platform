// Lightweight SVG/HTML charts with hover tooltips. Palette: validated categorical order (dataviz reference).
import { h, esc } from './ui.js';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const narrow = () => typeof innerWidth === 'number' && innerWidth < 700;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function tooltipLayer(wrap) {
  const tip = h('div.chart-tip', { role: 'presentation' });
  wrap.append(tip);
  return {
    show(x, y, html) { tip.innerHTML = html; tip.classList.add('on'); const w = wrap.clientWidth; tip.style.setProperty('left', `${Math.min(Math.max(x, 70), w - 70)}px`); tip.style.setProperty('top', `${y}px`); },
    hide() { tip.classList.remove('on'); },
  };
}

/**
 * Line (single series → with soft area) or multi-line chart.
 * opts: { labels, series:[{name, values, color}], format(v), height, ariaLabel }
 */
export function lineChart({ labels, series, format = String, height = 220, ariaLabel = 'Line chart', upto = null }) {
  const W = narrow() ? 380 : 640, H = height, P = { l: 44, r: 12, t: 12, b: 26 };
  const allZero = series.every((s) => s.values.every((v) => !v));
  const max = niceMax(Math.max(2, ...series.flatMap((s) => s.values)));
  const n = labels.length; const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const x = (i) => P.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => P.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const step = Math.ceil(n / 8);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(ariaLabel)}" class="chart-svg">`;
  for (const tv of ticks) svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(tv)}" y2="${y(tv)}" class="grid"/><text x="${P.l - 8}" y="${y(tv) + 4}" text-anchor="end" class="axis">${esc(format(tv))}</text>`;
  labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="axis">${esc(l)}</text>`; });
  series.forEach((s, si) => {
    const color = s.color || SERIES[si];
    const last = upto == null || upto < 0 ? n - 1 : Math.min(upto, n - 1);
    const pts = s.values.slice(0, last + 1).map((v, i) => `${x(i)},${y(v)}`).join(' ');
    if (series.length === 1) svg += `<polygon points="${x(0)},${y(0)} ${pts} ${x(last)},${y(0)}" fill="${color}" fill-opacity="0.1"/>`;
    if (last < n - 1) svg += `<circle cx="${x(last)}" cy="${y(s.values[last])}" r="4" fill="${color}" stroke="#fff" stroke-width="2"/>`;
    svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  });
  svg += `<line class="crosshair" x1="0" x2="0" y1="${P.t}" y2="${P.t + ih}" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${P.l}" y="${P.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  const wrap = h('div.chart', { html: svg });
  const tip = tooltipLayer(wrap);
  const svgEl = wrap.querySelector('svg'); const cross = svgEl.querySelector('.crosshair');
  svgEl.querySelector('.hit').addEventListener('mousemove', (e) => {
    const r = svgEl.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((sx - P.l) / iw) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    const rows = series.map((s, si) => `<div><i style-color="${s.color || SERIES[si]}"></i>${esc(s.name)} <b>${esc(format(s.values[i]))}</b></div>`).join('');
    tip.show((x(i) / W) * r.width, 0, `<strong>${esc(labels[i])}</strong>${rows}`);
    tip_colors(wrap);
  });
  svgEl.querySelector('.hit').addEventListener('mouseleave', () => { tip.hide(); cross.setAttribute('visibility', 'hidden'); });
  if (allZero) wrap.append(h('div.chart-empty', h('span', 'No activity in this period yet')));
  if (series.length > 1) wrap.append(legend(series.map((s, i) => [s.name, s.color || SERIES[i]])));
  return wrap;
}
// CSP blocks inline style attributes in markup, so swatch colours are applied through the CSSOM.
function tip_colors(wrap) { for (const i of wrap.querySelectorAll('[style-color]')) i.style.setProperty('background', i.getAttribute('style-color')); }

/** Vertical bar chart: { labels, values, color, format, height } */
export function barChart({ labels, values, color = SERIES[0], format = String, height = 200, ariaLabel = 'Bar chart', name = 'Value' }) {
  const W = narrow() ? 380 : 640, H = height, P = { l: 52, r: 8, t: 10, b: 26 };
  const allZero = values.every((v) => !v);
  const max = niceMax(Math.max(allZero ? 100_000_00 : 2, ...values));
  const n = labels.length; const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const bw = Math.max(2, Math.min(36, (iw / n) * 0.62)); const gap = iw / n;
  const y = (v) => P.t + ih - (v / max) * ih;
  const step = Math.ceil(n / 10);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(ariaLabel)}" class="chart-svg">`;
  for (const tv of [0, max / 2, max]) svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(tv)}" y2="${y(tv)}" class="grid"/><text x="${P.l - 8}" y="${y(tv) + 4}" text-anchor="end" class="axis">${esc(format(tv))}</text>`;
  values.forEach((v, i) => {
    const cx = P.l + gap * i + gap / 2; const top = y(v); const hgt = P.t + ih - top;
    if (v > 0) {
      const r = Math.min(4, bw / 2, hgt);
      svg += `<path d="M${cx - bw / 2},${P.t + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${P.t + ih} Z" fill="${color}" class="bar"/>`;
    }
    svg += `<rect class="hit" data-i="${i}" x="${P.l + gap * i}" y="${P.t}" width="${gap}" height="${ih}" fill="transparent"/>`;
    if (i % step === 0 || i === n - 1) svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="axis">${esc(labels[i])}</text>`;
  });
  svg += '</svg>';
  const wrap = h('div.chart', { html: svg });
  if (allZero) wrap.append(h('div.chart-empty', h('span', 'Nothing closed in this period yet')));
  const tip = tooltipLayer(wrap);
  const svgEl = wrap.querySelector('svg');
  for (const hit of svgEl.querySelectorAll('.hit')) {
    hit.addEventListener('mouseenter', () => {
      const i = +hit.dataset.i; const r = svgEl.getBoundingClientRect();
      tip.show(((P.l + gap * i + gap / 2) / W) * r.width, 0, `<strong>${esc(labels[i])}</strong><div>${esc(name)} <b>${esc(format(values[i]))}</b></div>`);
    });
    hit.addEventListener('mouseleave', () => tip.hide());
  }
  return wrap;
}

export function legend(items) {
  return h('div.legend', items.map(([name, color]) => h('span.legend-item', h('i', { style: { background: color } }), name)));
}

/** Horizontal bars in HTML (accessible list). rows: [{label, value, display, color, sub}] */
export function hbars(rows, { max } = {}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return h('ul.hbars', rows.map((r) => h('li.hbar',
    h('div.hbar-label', h('span', r.label), r.sub ? h('small', r.sub) : null),
    h('div.hbar-track', h('div.hbar-fill', { style: { width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / m) * 100)}%`, background: r.color || SERIES[0] } })),
    h('span.hbar-value', r.display ?? String(r.value)))));
}

/** Stacked horizontal bars: rows [{label, parts:[{key,value}]}], keys [[key,name,color]] */
export function stackedBars(rows, keys, { format = String } = {}) {
  const m = Math.max(1, ...rows.map((r) => r.parts.reduce((s, p) => s + p.value, 0)));
  return h('div.stacked',
    legend(keys.map(([, name, color]) => [name, color])),
    h('ul.hbars', rows.map((r) => {
      const total = r.parts.reduce((s, p) => s + p.value, 0);
      return h('li.hbar', h('div.hbar-label', h('span', r.label), r.sub ? h('small', r.sub) : null),
        h('div.hbar-track.stack-track', keys.map(([k, name, color]) => {
          const p = r.parts.find((x) => x.key === k); if (!p || !p.value) return null;
          return h('div.hbar-fill', { style: { width: `${(p.value / m) * 100}%`, background: color }, title: `${name}: ${format(p.value)}` });
        })),
        h('span.hbar-value', format(total)));
    })));
}

/** Goal / progress meter. */
export function meter(value, target, { color = SERIES[2] } = {}) {
  const p = target ? Math.min(100, (value / target) * 100) : 0;
  return h('div.meter', { role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(target), 'aria-valuenow': String(value) },
    h('div.meter-fill', { style: { width: `${p}%`, background: p >= 100 ? SERIES[5] : color } }));
}
