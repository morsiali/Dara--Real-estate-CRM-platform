// AI follow-up desk. The user chooses a lead and reviews all suggested actions before saving.
import { get, post } from '../api.js';
import { h, mount, empty, loading, errorState, formModal, toast, ago, icon, toLocalInput, fromLocalInput, localParts, dubaiIso } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { panel } from './shared.js';

export async function assistant(root, ctx) {
  const { store, setHeader, go } = ctx;
  setHeader(t('ai.title'));
  const queueEl = h('div');
  const planEl = h('div');
  const state = { selected: ctx.query.lead || null, busy: false };
  let queue = [];
  let configured = false;

  const drawQueue = () => {
    mount(queueEl, queue.length ? h('ul.ai-queue', queue.map((lead) => h('li.ai-queue-item',
      { class: state.selected === lead.id ? 'selected' : '' },
      h('button.ai-queue-pick', { onclick: () => select(lead.id), 'aria-current': state.selected === lead.id ? 'true' : null },
        h('span.ai-queue-name', `${lead.first_name} ${lead.last_name}`.trim()),
        h('span.ai-queue-reason', lead.reason),
        h('small', `${lead.owner_name || 'Unassigned'} · ${badgeText(lead.status)} · ${lead.last_activity_at ? `last activity ${ago(lead.last_activity_at)}` : `created ${ago(lead.created_at)}`}`)))))
      : empty('No open leads need follow-up', 'New and overdue leads will appear here.'));
  };

  const select = (id) => {
    state.selected = id;
    drawQueue();
    const lead = queue.find((x) => x.id === id);
    mount(planEl, lead ? h('div.stack',
      h('div.ai-lead-head', h('div', h('h2', `${lead.first_name} ${lead.last_name}`.trim()), h('p.muted', lead.reason)),
        h('a.btn.btn-ghost', { href: `#/lead/${lead.id}` }, 'Open lead')),
      configured ? h('div.stack',
        h('p.muted', 'Generate a follow-up plan from this lead’s requirements, notes, recent activity and verified listing matches. Those details are sent to OpenAI. Review every suggestion before using it.'),
        h('button.btn.btn-primary', { disabled: state.busy, onclick: () => generate(lead) }, icon('layers'), 'Prepare follow-up'))
        : empty('AI is not enabled on this server', 'The workspace administrator must add the OpenAI API key to the server environment. The follow-up queue still works.'))
      : empty('Choose a lead', 'The most urgent follow-ups are listed on the left.'));
  };

  const generate = async (lead) => {
    if (state.busy) return;
    state.busy = true;
    mount(planEl, loading('Preparing a follow-up for this lead…'));
    try {
      const { plan, generated_at } = await post(`/ai/leads/${lead.id}/plan`, { language: getLang() });
      if (state.selected !== lead.id) return;
      const taskButton = h('button.btn.btn-primary', { onclick: () => reviewTask(plan, lead, store, () => {
        taskButton.disabled = true;
        taskButton.textContent = 'Task created';
      }) }, icon('plus'), 'Review follow-up task');
      mount(planEl, h('div.stack',
        h('div.ai-lead-head', h('div', h('h2', `${lead.first_name} ${lead.last_name}`.trim()), h('p.muted', `Prepared ${ago(generated_at)} · ${lead.reason}`)),
          h('a.btn.btn-ghost', { href: `#/lead/${lead.id}` }, 'Open lead')),
        panel(plan.headline, h('div.stack',
          h('p', plan.why_now),
          h('div.ai-next', h('strong', 'Next step'), h('p', plan.next_step)),
          plan.listing_ref ? h('p.muted', `Verified listing to consider: ${plan.listing_ref}`) : null),
          { sub: 'AI suggestion · check facts and availability before acting' }),
        panel('Client message draft', h('div.stack',
          h('p.ai-message', plan.message),
          h('div.ai-actions',
            h('button.btn.btn-ghost', { onclick: async () => { try { await navigator.clipboard.writeText(plan.message); toast('Message copied. Review it before sending.'); } catch { toast('Could not copy the message.', 'error'); } } }, icon('copy'), 'Copy draft'),
            taskButton))),
        h('p.muted.ai-disclaimer', 'Dara has not contacted the client or changed the lead. AI can make mistakes.')));
    } catch (err) { if (state.selected === lead.id) mount(planEl, errorState(err, () => generate(lead))); }
    finally { state.busy = false; }
  };

  mount(root, h('div.stack',
    h('p.muted', 'Your follow-up queue puts untouched leads and overdue work first. Open one to prepare a client message and a task in seconds.'),
    h('div.ai-desk', panel('Follow-up queue', queueEl, { sub: 'Up to 30 open leads you may access' }), panel('Action plan', planEl))));
  mount(queueEl, loading());
  mount(planEl, empty('Choose a lead'));
  try {
    const [status, result] = await Promise.all([get('/ai/status'), get('/ai/queue')]);
    configured = status.configured;
    queue = result.items;
    if (state.selected && !queue.some((x) => x.id === state.selected)) {
      try {
        const { item } = await get(`/leads/${encodeURIComponent(state.selected)}`);
        if (['new', 'contacted', 'qualified', 'nurturing'].includes(item.status)) queue.unshift({ ...item, reason: 'Selected lead', last_activity_at: null });
      } catch { /* The lead may have closed or access may have changed. Use the visible queue. */ }
    }
    drawQueue();
    select(queue.some((x) => x.id === state.selected) ? state.selected : queue[0]?.id || null);
  } catch (err) { mount(queueEl, errorState(err, () => go('#/assistant'))); }
}

function badgeText(status) { return status.replaceAll('_', ' '); }

function reviewTask(plan, lead, store, onCreated) {
  const canAssign = store.perms['tasks.assign'];
  const owner = store.users.find((u) => u.id === lead.owner_id);
  const canAssignOwner = owner && (canAssign === 'Tenant' || (canAssign === 'Team' && owner.team_id === store.me.team_id) || owner.id === store.me.id);
  const assignee = canAssignOwner ? owner.id : store.me.id;
  const candidate = new Date(Date.now() + plan.due_in_hours * 3_600_000).toISOString();
  const p = localParts(candidate);
  const due = p.h < 9 ? dubaiIso(p.y, p.m, p.d, 9) : p.h >= 19 ? dubaiIso(p.y, p.m, p.d + 1, 9) : candidate;
  formModal({
    title: 'Review follow-up task', submitLabel: 'Create task',
    intro: 'Nothing is saved until you approve this task. You can edit every field.',
    fields: [
      { name: 'assignee_id', label: 'Assign to', type: 'select', required: true,
        options: store.users.filter((u) => u.active && (canAssign === 'Tenant' || (canAssign === 'Team' && u.team_id === store.me.team_id) || u.id === store.me.id)).map((u) => [u.id, u.name]), value: assignee },
      { name: 'title', label: 'Task', required: true, value: plan.task_title, full: true },
      { name: 'description', label: 'Details', type: 'textarea', value: plan.task_description },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'urgent'], value: lead.reason.includes('overdue') || lead.reason.includes('first contact') ? 'high' : 'medium' },
      { name: 'due_at', label: 'Due (Dubai time)', type: 'datetime-local', value: toLocalInput(due) },
    ],
    submit: async (v) => {
      await post('/tasks', { ...v, due_at: fromLocalInput(v.due_at), related_type: 'lead', related_id: lead.id });
      toast('Follow-up task created.');
      onCreated();
    },
  });
}
