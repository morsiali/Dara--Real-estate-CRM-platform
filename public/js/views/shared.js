// Building blocks shared by views.
import { h, segmented, delta } from '../ui.js';
import { t } from '../i18n.js';

export const PERIODS = ['today', 'week', 'month', 'quarter', 'year'];
export function getPeriod(fallback = 'month') { try { return localStorage.getItem('dara.period') || fallback; } catch { return fallback; } }
export function setPeriod(p) { try { localStorage.setItem('dara.period', p); } catch { /* ignore */ } }
export const periodSwitch = (value, onChange) => segmented(PERIODS.map((p) => [p, t('period.' + p)]), value, (p) => { setPeriod(p); onChange(p); }, 'Time period');

export const panel = (title, body, { actions, cls = '', sub } = {}) =>
  h(`section.panel${cls ? '.' + cls : ''}`, (title || actions) ? h('header.panel-head', h('div', title ? h('h2', title) : null, sub ? h('p.panel-sub', sub) : null), actions ? h('div.panel-actions', actions) : null) : null, h('div.panel-body', body));

export function kpi(labelText, value, { cur, prev, invert, sub, accent } = {}) {
  return h(`div.kpi${accent ? '.kpi-accent' : ''}`,
    h('span.kpi-label', labelText),
    h('span.kpi-value', value),
    h('span.kpi-foot', cur !== undefined ? delta(cur, prev, { invert }) : null, sub ? h('span.kpi-sub', sub) : null));
}

export const STAGE_COLORS = { new: '#86b6ef', viewing: '#5598e7', offer: '#2a78d6', negotiation: '#1c5cab', reservation: '#104281', won: '#008300', lost: '#e34948' };
export const TYPE_COLORS = { meeting: '#2a78d6', viewing: '#eb6834', call: '#1baf7a', internal: '#eda100', focus: '#e87ba4' };
