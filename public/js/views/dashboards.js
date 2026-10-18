// Main dashboard (everyone), member dashboard (own / managed), team control, leaderboard, time insights.
import { get, post, put, del } from '../api.js';
import { h, mount, load, money, num, pct, avatar, badge, dateTime, timeFmt, shortDate, ago, icon, label, empty, formModal, toast, confirmModal, errorState, loading } from '../ui.js';
import { t } from '../i18n.js';
import { lineChart, barChart, hbars, stackedBars, meter, SERIES } from '../charts.js';
import { panel, kpi, getPeriod, periodSwitch, STAGE_COLORS, TYPE_COLORS } from './shared.js';

const STAGES = ['new', 'viewing', 'offer', 'negotiation', 'reservation'];
const fmtM = (v) => money(v);

function periodLabel(r) { return r ? `${shortDate(r.start)} – ${shortDate(new Date(Date.parse(r.end) - 1000).toISOString())}` : ''; }

/* ================= Main dashboard ================= */
export async function home(root, ctx) {
  const { store, setHeader } = ctx;
  let period = getPeriod();
  const body = h('div.dash');
  const draw = () => {
    setHeader(t('home.title'), [periodSwitch(period, (p) => { period = p; draw(); }),
      store.can('announcements.create') ? h('button.btn.btn-primary', { onclick: () => postAnnouncement(draw) }, icon('plus'), t('home.post')) : null]);
    load(body, () => get(`/dashboard/main?period=${period}`), (d) => {
      const k = d.kpis, p = d.previous;
      const myRank = d.my_rank;
      return h('div.dash-grid',
        h('p.dash-sub.span-all', `${t('home.sub')} · ${periodLabel(d.range)} · ${d.online.length} online now`),
        h('div.kpis.span-all',
          kpi(t('kpi.won_volume'), money(k.won_volume), { cur: k.won_volume, prev: p.won_volume, accent: true }),
          kpi(t('kpi.deals_won'), num(k.deals_won), { cur: k.deals_won, prev: p.deals_won, sub: k.win_rate != null ? `${pct(k.win_rate)} win rate` : null }),
          kpi(t('kpi.commission_won'), money(k.commission_won), { cur: k.commission_won, prev: p.commission_won, sub: 'gross, before splits' }),
          kpi(t('kpi.viewings_done'), num(k.viewings_done), { cur: k.viewings_done, prev: p.viewings_done }),
          kpi(t('kpi.leads_new'), num(k.leads_new), { cur: k.leads_new, prev: p.leads_new }),
          kpi(t('kpi.pipeline_value'), money(d.pipeline_value), { sub: `${d.open_deals} open deals` })),
        panel(t('home.activity'), lineChart({ labels: d.series.labels, series: [{ name: 'Calls, viewings & meetings', values: d.series.activity }], format: (v) => num(v), upto: d.series.current_index, ariaLabel: 'Team activity over the period' }),
          { cls: 'span-2', sub: 'Logged calls, messages and completed calendar events' }),
        panel(t('home.top'), d.leaderboard.some((r) => r.points > 0) ? h('div',
          h('ol.mini-board', d.leaderboard.filter((r) => r.points > 0).map((r) => h('li', h('span.rank', `${r.rank}`), avatar(r.name, r.color, { size: 30, online: d.online.includes(r.id) }),
            h('a', { href: `#/member/${r.id}` }, h('strong', r.name), h('small', r.team_name || '')), h('span.pts', `${num(r.points)} pts`)))),
          myRank ? h('p.my-rank', `${t('home.rank')}: #${myRank.rank} of ${d.field_size} · ${num(myRank.points)} pts`) : null,
          h('a.link', { href: '#/leaderboard' }, t('common.viewAll'))) : empty('No scores yet', 'Points appear as the team closes deals and completes viewings.'), { cls: 'span-1' }),
        panel('Closed volume', barChart({ labels: d.series.labels, values: d.series.won_volume, format: fmtM, name: 'Closed volume', color: SERIES[0], ariaLabel: 'Closed volume by period bucket' }), { cls: 'span-2' }),
        panel(t('home.pipeline'), hbars(STAGES.map((s) => { const r = d.pipeline_by_stage.find((x) => x.stage === s) || { c: 0, v: 0 }; return { label: label(s), sub: `${r.c} deals`, value: r.v, display: money(r.v), color: STAGE_COLORS[s] }; })), { cls: 'span-1' }),
        panel(t('home.agenda'), d.agenda.length ? h('ul.agenda', d.agenda.map((e) => h('li', { class: `ev-${e.type}` }, h('span.agenda-time', timeFmt(e.start_at)), h('div', h('strong', e.title), h('small', [label(e.type), e.location].filter(Boolean).join(' · '))), e.status !== 'scheduled' ? badge(e.status) : null)))
          : empty('Nothing scheduled today', 'Use the calendar to book viewings and meetings.', h('a.btn.btn-ghost', { href: '#/calendar' }, 'Open calendar')), { cls: 'span-1' }),
        panel(t('home.wins'), d.wins.length ? h('ul.wins', d.wins.map((w) => h('li', avatar(w.owner_name, w.owner_color, { size: 28 }), h('div', h('strong', w.title), h('small', `${w.owner_name} · ${shortDate(w.closed_at)}`)), h('span.win-val', money(w.value)))))
          : empty('No wins yet'), { cls: 'span-1' }),
        panel(t('home.announcements'), d.announcements.length ? h('ul.announce', d.announcements.map((a) => h('li', { class: a.pinned ? 'pinned' : '' },
          h('div.ann-head', h('strong', a.title), a.pinned ? h('span.pin', 'Pinned') : null,
            store.can('announcements.create') ? h('button.link-btn.danger', { onclick: async () => { if (await confirmModal({ title: 'Delete announcement?', body: `“${a.title}” will be removed for everyone.`, confirmLabel: 'Delete', danger: true })) { await del(`/announcements/${a.id}`); toast('Announcement deleted'); draw(); } } }, 'Delete') : null),
          h('p', a.body), h('small', `${a.author_name} · ${ago(a.created_at)}`)))) : empty('No announcements'), { cls: 'span-1' }));
    });
  };
  mount(root, body);
  draw();
  // Live refresh when someone closes a deal or posts an announcement.
  return store.on('notification', (n) => { if (['deal_won', 'announcement'].includes(n.type)) draw(); });
}

function postAnnouncement(after) {
  formModal({
    title: t('home.post'), submitLabel: 'Post to everyone',
    fields: [{ name: 'title', label: 'Title', required: true, full: true, max: 120 }, { name: 'body', label: 'Message', type: 'textarea', required: true }, { name: 'pinned', label: 'Pin to the top of the main dashboard', type: 'checkbox' }],
    submit: async (v) => { await post('/announcements', v); toast('Announcement posted'); after(); },
  });
}

/* ================= Member dashboard ================= */
export async function member(root, ctx) {
  const { store, setHeader } = ctx;
  const id = ctx.route === 'me' ? 'me' : ctx.id;
  let period = getPeriod();
  const body = h('div.dash');
  const draw = () => {
    load(body, () => get(`/dashboard/member/${id}?period=${period}`), (d) => {
      const m = d.member; const k = d.kpis, p = d.previous; const self = m.id === store.me.id;
      setHeader(self ? t('me.title') : m.name, [periodSwitch(period, (x) => { period = x; draw(); }),
        !self ? h('a.btn.btn-ghost', { href: `#/chat?dm=${m.id}` }, icon('chat'), 'Message') : null,
        !self && store.can('tasks.assign') ? h('a.btn.btn-ghost', { href: `#/tasks?assign=${m.id}` }, icon('tasks'), 'Assign task') : null]);
      const goalNames = { won_volume: t('kpi.won_volume'), deals_won: t('kpi.deals_won'), viewings_done: t('kpi.viewings_done'), calls_logged: t('kpi.calls_logged') };
      const fmtGoal = (metric, v) => (metric === 'won_volume' ? money(v) : num(v));
      return h('div.dash-grid',
        h('div.member-hero.span-all', avatar(m.name, m.color, { size: 56, online: m.online }),
          h('div', h('h2', m.name), h('p', [m.title, m.team_name, t('role.' + m.role)].filter(Boolean).join(' · ')), h('small', m.online ? 'Online now' : `Last active ${ago(m.last_seen_at)}`)),
          h('div.hero-stats', h('div', h('strong', d.rank ? `#${d.rank}` : '—'), h('span', `of ${d.field_size} on the leaderboard`)), h('div', h('strong', num(k.points)), h('span', `points · ${t('period.' + period).toLowerCase()}`)))),
        h('div.kpis.span-all',
          kpi(t('kpi.won_volume'), money(k.won_volume), { cur: k.won_volume, prev: p.won_volume, accent: true }),
          kpi(t('kpi.deals_won'), num(k.deals_won), { cur: k.deals_won, prev: p.deals_won }),
          kpi(t('kpi.viewings_done'), num(k.viewings_done), { cur: k.viewings_done, prev: p.viewings_done }),
          kpi(t('kpi.calls_logged'), num(k.calls_logged), { cur: k.calls_logged, prev: p.calls_logged }),
          kpi(t('kpi.tasks_approved'), num(k.tasks_approved), { cur: k.tasks_approved, prev: p.tasks_approved, sub: k.tasks_on_time_rate != null ? `${pct(k.tasks_on_time_rate)} on time` : null }),
          kpi(t('kpi.pipeline_value'), money(d.snapshot.pipeline_value), { sub: `${d.snapshot.open_deals} open · ${d.snapshot.active_leads} active leads` })),
        panel('Points earned', lineChart({ labels: d.series.labels, series: [{ name: 'Points', values: d.series.points, color: SERIES[0] }], format: (v) => num(v), upto: d.series.current_index }), { cls: 'span-2' }),
        panel(t('me.goals'), d.goals.length ? h('ul.goals', d.goals.map((g) => h('li', h('div.goal-head', h('span', goalNames[g.metric]), h('strong', `${fmtGoal(g.metric, g.actual)} / ${fmtGoal(g.metric, g.target)}`)), meter(g.actual, g.target), h('small', `${g.pct}% of ${d.month} goal`))))
          : empty('No goals set for this month', d.can_set_goals ? 'Set targets so progress shows here.' : 'Your manager sets monthly goals.'),
          { cls: 'span-1', actions: d.can_set_goals ? h('button.btn.btn-small', { onclick: () => setGoals(m, d, draw) }, t('me.setGoals')) : null }),
        panel(t('me.tasks'), d.tasks.length ? h('ul.list-plain', d.tasks.map((x) => h('li.row-link', h('a', { href: `#/tasks?task=${x.id}` }, h('span', x.title), h('small', `from ${x.creator_name}${x.due_at ? ' · due ' + dateTime(x.due_at) : ''}`)), badge(x.status))))
          : empty('No open tasks'), { cls: 'span-1', sub: `${d.snapshot.overdue_tasks} overdue · ${d.snapshot.awaiting_review} awaiting review` }),
        panel(t('me.upcoming'), d.upcoming.length ? h('ul.agenda', d.upcoming.map((e) => h('li', { class: `ev-${e.type}` }, h('span.agenda-time', h('b', shortDate(e.start_at)), timeFmt(e.start_at)), h('div', h('strong', e.title), h('small', [label(e.type), e.location].filter(Boolean).join(' · '))))))
          : empty('Nothing upcoming'), { cls: 'span-1' }),
        panel(t('me.points'), d.ledger.length ? h('ul.ledger', d.ledger.map((l) => h('li', h('span.pts-chip', `+${l.points}`), h('span', l.reason), h('small', ago(l.at))))) : empty('No points yet'), { cls: 'span-1' }),
        panel(t('me.achievements'), h('ul.badges', d.achievements.map((a) => h('li', { class: a.earned_at ? 'earned' : 'locked', title: a.description },
          h('span.badge-icon', icon(a.icon, 22)), h('strong', a.name), h('small', a.earned_at ? `Earned ${shortDate(a.earned_at)}` : `${a.code === 'million_month' ? money(a.progress) : num(a.progress)} / ${a.code === 'million_month' ? money(a.target) : num(a.target)}`),
          a.earned_at ? null : meter(a.progress, a.target, { color: SERIES[0] })))), { cls: 'span-all' }));
    });
  };
  mount(root, body);
  draw();
}

function setGoals(m, d, after) {
  const cur = Object.fromEntries(d.goals.map((g) => [g.metric, g.target]));
  formModal({
    title: `${m.name} — goals for ${d.month}`, submitLabel: 'Save goals',
    fields: [
      { name: 'won_volume', label: 'Closed volume (AED)', type: 'number', min: 0, step: 1000, value: cur.won_volume ? cur.won_volume / 100 : '' },
      { name: 'deals_won', label: 'Deals won', type: 'number', min: 0, value: cur.deals_won ?? '' },
      { name: 'viewings_done', label: 'Viewings done', type: 'number', min: 0, value: cur.viewings_done ?? '' },
      { name: 'calls_logged', label: 'Calls', type: 'number', min: 0, value: cur.calls_logged ?? '' },
    ],
    submit: async (v) => {
      for (const [metric, val] of Object.entries(v)) {
        if (!val) continue;
        await put('/goals', { user_id: m.id, month: d.month, metric, target: metric === 'won_volume' ? Math.round(val * 100) : Math.round(val) });
      }
      toast('Goals saved'); after();
    },
  });
}

/* ================= Team control (management & team leads) ================= */
export async function team(root, ctx) {
  const { setHeader, store } = ctx;
  let period = getPeriod();
  let sort = 'points';
  const body = h('div');
  const draw = () => {
    setHeader(t('team.title'), [periodSwitch(period, (p) => { period = p; draw(); })]);
    load(body, () => get(`/team/overview?period=${period}`), (d) => {
      const T = d.totals;
      const rows = [...d.members].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b.kpis[sort] ?? b.snapshot[sort] ?? 0) - (a.kpis[sort] ?? a.snapshot[sort] ?? 0)));
      const th = (key, text) => h('th', { scope: 'col', 'aria-sort': sort === key ? 'descending' : 'none' }, h('button.th-btn', { onclick: () => { sort = key; draw(); } }, text, sort === key ? ' ↓' : ''));
      return h('div.stack-lg',
        h('p.dash-sub', `${t('team.sub')} · ${periodLabel(d.range)}`),
        h('div.kpis',
          kpi(t('kpi.won_volume'), money(T.won_volume), { accent: true }), kpi(t('kpi.deals_won'), num(T.deals_won)), kpi(t('kpi.viewings_done'), num(T.viewings_done)),
          kpi(t('kpi.tasks_approved'), num(T.tasks_approved), { sub: T.tasks_on_time_rate != null ? `${pct(T.tasks_on_time_rate)} on time` : null }), kpi(t('kpi.meeting_hours'), num(T.meeting_hours, 1)), kpi(t('kpi.no_show_rate'), pct(T.no_show_rate))),
        panel(null, rows.length ? h('div.table-wrap', h('table.data',
          h('thead', h('tr', th('name', t('team.member')), th('points', 'Points'), th('won_volume', 'Closed'), th('deals_won', 'Won'), th('viewings_done', 'Viewings'), th('calls_logged', 'Calls'),
            th('tasks_approved', 'Approved'), th('overdue_tasks', 'Overdue'), th('awaiting_review', 'To review'), th('pipeline_value', 'Pipeline'), h('th', { scope: 'col' }, 'Status'))),
          h('tbody', rows.map((r) => h('tr',
            h('td', h('a.person', { href: `#/member/${r.id}` }, avatar(r.name, r.color, { size: 30, online: r.online }), h('span', h('strong', r.name), h('small', `${r.team_name || '—'} · ${t('role.' + r.role)}`)))),
            h('td.num', num(r.kpis.points)), h('td.num', money(r.kpis.won_volume)), h('td.num', num(r.kpis.deals_won)), h('td.num', num(r.kpis.viewings_done)), h('td.num', num(r.kpis.calls_logged)),
            h('td.num', num(r.kpis.tasks_approved)), h('td.num', r.snapshot.overdue_tasks ? h('span.warn-num', String(r.snapshot.overdue_tasks)) : '0'),
            h('td.num', r.snapshot.awaiting_review ? h('a', { href: `#/tasks?view=review&assignee=${r.id}` }, String(r.snapshot.awaiting_review)) : '0'),
            h('td.num', money(r.snapshot.pipeline_value)),
            h('td', h('span', { class: r.online ? 'status-on' : 'status-off' }, r.online ? 'Online' : `Seen ${ago(r.last_seen_at)}`))))))) : empty('No team members in your scope')),
        panel('Closed volume by member', (() => {
          const closers = rows.filter((r) => r.kpis.won_volume > 0).sort((a, b) => b.kpis.won_volume - a.kpis.won_volume);
          return closers.length ? hbars(closers.map((r) => ({ label: r.name, value: r.kpis.won_volume, display: money(r.kpis.won_volume), color: SERIES[0] }))) : empty('No closed deals in this period');
        })()));
    });
  };
  mount(root, body);
  draw();
}

/* ================= Leaderboard ================= */
export async function leaderboard(root, ctx) {
  const { setHeader, store } = ctx;
  let period = getPeriod('month');
  const body = h('div');
  const draw = () => {
    setHeader(t('board.title'), [periodSwitch(period, (p) => { period = p; draw(); })]);
    load(body, () => Promise.all([get(`/leaderboard?period=${period}`), get('/achievements')]), ([b, a]) => {
      const items = b.items; const top = items.slice(0, 3);
      const podiumOrder = [top[1], top[0], top[2]].filter(Boolean);
      return h('div.stack-lg',
        h('p.dash-sub', `${t('board.sub')} · ${periodLabel(b.range)}`),
        items.length && items[0].points > 0 ? h('div.podium', podiumOrder.map((r) => h(`div.podium-step.p${r.rank}`,
          avatar(r.name, r.color, { size: r.rank === 1 ? 64 : 52, online: store.online.has(r.id) }), h('strong', r.name), h('span', `${num(r.points)} pts`),
          h('div.podium-block', h('span', `#${r.rank}`))))) : empty('No points in this period yet', 'Points come from closed deals, completed viewings, approved tasks and logged activity.'),
        panel('Standings', h('div.table-wrap', h('table.data',
          h('thead', h('tr', ['#', 'Member', 'Points', 'Closed', 'Won', 'Viewings', 'Tasks', 'Calls', 'Badges'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', items.map((r) => h('tr', { class: r.id === store.me.id ? 'me-row' : '' },
            h('td.num', String(r.rank)), h('td', h('a.person', { href: `#/member/${r.id}` }, avatar(r.name, r.color, { size: 28 }), h('span', h('strong', r.name), h('small', r.team_name || '')))),
            h('td.num.strong', num(r.points)), h('td.num', money(r.won_volume)), h('td.num', num(r.deals_won)), h('td.num', num(r.viewings_done)), h('td.num', num(r.tasks_approved)), h('td.num', num(r.calls_logged)), h('td.num', num(r.badges)))))))),
        h('div.two-col',
          panel('How points are earned', h('ul.rules',
            [['Deal won', 100], ['Viewing completed', 20], ['Lead converted to deal', 15], ['Task approved', '5–25 by priority'], ['Approved task submitted on time', '+5'], ['Lead qualified', 10], ['Meeting completed', 10], ['Call / WhatsApp / email / note', '3 / 2 / 2 / 1 (max 30 a day)']]
              .map(([k, v]) => h('li', h('span', k), h('strong', String(v)))))),
          panel('Recent achievements', a.recent.length ? h('ul.ledger', a.recent.map((r) => { const c = a.catalog.find((x) => x.code === r.code); return h('li', avatar(r.name, r.color, { size: 26 }), h('span', h('strong', r.name), ` unlocked ${c?.name ?? r.code}`), h('small', ago(r.earned_at))); })) : empty('No achievements yet'))));
    });
  };
  mount(root, body);
  draw();
}

/* ================= Time insights ================= */
export async function time(root, ctx) {
  const { setHeader } = ctx;
  let period = getPeriod();
  const body = h('div');
  const KEYS = [['meeting', 'Client meetings', TYPE_COLORS.meeting], ['viewing', 'Viewings', TYPE_COLORS.viewing], ['call', 'Calls', TYPE_COLORS.call], ['internal', 'Internal', TYPE_COLORS.internal], ['focus', 'Focus time', TYPE_COLORS.focus]];
  const draw = () => {
    setHeader(t('time.title'), [periodSwitch(period, (p) => { period = p; draw(); })]);
    load(body, () => get(`/analytics/time?period=${period}`), (d) => {
      const totalH = d.items.reduce((s, r) => s + r.total_hours, 0);
      const clientH = d.items.reduce((s, r) => s + r.hours.meeting + r.hours.viewing + r.hours.call, 0);
      const internalH = d.items.reduce((s, r) => s + r.hours.internal, 0);
      const conflicts = d.items.reduce((s, r) => s + r.conflicts, 0);
      const noShows = d.items.reduce((s, r) => s + r.no_shows, 0);
      return h('div.stack-lg',
        h('p.dash-sub', `Scheduled calendar time (excluding cancelled) · ${periodLabel(d.range)}`),
        h('div.kpis',
          kpi('Scheduled hours', num(totalH, 1), { accent: true }),
          kpi('Client-facing share', totalH ? pct((clientH / totalH) * 100) : '—', { sub: `${num(clientH, 1)} h with clients` }),
          kpi('Internal meeting hours', num(internalH, 1)),
          kpi('Double bookings', num(conflicts), { sub: 'overlapping events' }),
          kpi('No-shows', num(noShows)),
          kpi('Client hours per won deal', d.deals_won ? num(clientH / d.deals_won, 1) : '—', { sub: `${d.deals_won} deals won` })),
        panel('Where the hours go', d.items.length ? stackedBars(d.items.map((r) => ({ label: r.name, sub: `${r.events} events${r.conflicts ? ` · ${r.conflicts} overlaps` : ''}`, parts: KEYS.map(([k]) => ({ key: k, value: r.hours[k] })) })), KEYS, { format: (v) => `${num(v, 1)} h` })
          : empty('No calendar events in this period'), { sub: 'Hours by event type per person. Use it to rebalance internal meetings against client time.' }),
        panel('Reading this', h('ul.notes',
          h('li', 'Hours come from calendar events where the person is organizer or an attendee who did not decline.'),
          h('li', '“Double bookings” counts pairs of overlapping, non-cancelled events for the same person.'),
          h('li', 'Client hours per won deal divides client-facing hours by deals closed in the same period. It is a workload indicator, not a causal measure.'))));
    });
  };
  mount(root, body);
  draw();
}
