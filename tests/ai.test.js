import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, as } from './helpers.js';
import { generateLeadPlan } from '../server/services/ai.js';
import { randomUUID } from 'node:crypto';

const samplePlan = {
  headline: 'Call today', why_now: 'No first contact is recorded.', next_step: 'Call the lead and ask about timing.',
  message: 'Hello, when would be a good time to discuss your search?', task_title: 'Call new lead',
  task_description: 'Confirm budget and preferred communities.', due_in_hours: 4, listing_ref: '',
};

test('AI desk is unavailable without a server key; queue still respects lead scope', async () => {
  const app = await startApp();
  try {
    const agent = await as(app.base, 'agent');
    const manager = await as(app.base, 'manager');
    const otherTenant = await as(app.base, 'owner@palmcoast.demo');
    assert.equal((await agent.get('/ai/status')).data.configured, false);
    const agentQueue = (await agent.get('/ai/queue')).data.items;
    const managerQueue = (await manager.get('/ai/queue')).data.items;
    assert.ok(agentQueue.length > 0);
    assert.ok(managerQueue.length >= agentQueue.length);
    assert.ok(agentQueue.every((x) => x.owner_id === agent.user.id));
    assert.equal((await agent.post(`/ai/leads/${agentQueue[0].id}/plan`)).status, 503);
    assert.equal((await otherTenant.get('/ai/queue')).status, 200);
  } finally { await app.close(); }
});

test('AI plan uses only authorized lead context and creates no records until approved task request', async () => {
  const seen = [];
  const app = await startApp({ config: { aiClient: async (request) => { seen.push(request); return samplePlan; } } });
  try {
    const agent = await as(app.base, 'agent');
    const otherTenant = await as(app.base, 'owner@palmcoast.demo');
    const lead = (await agent.get('/ai/queue')).data.items[0];
    const before = (await agent.get('/tasks?view=mine')).data.items.length;
    assert.equal((await otherTenant.post(`/ai/leads/${lead.id}/plan`)).status, 404);
    assert.equal((await agent.post(`/ai/leads/${lead.id}/plan`, { language: 'fr' })).status, 400);
    const result = await agent.post(`/ai/leads/${lead.id}/plan`, { language: 'en' });
    assert.equal(result.status, 200);
    assert.equal(result.data.plan.task_title, samplePlan.task_title);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].context.lead.first_name.length > 0, true);
    assert.equal('email' in seen[0].context.lead, false);
    assert.equal('phone' in seen[0].context.lead, false);
    assert.equal((await agent.get('/tasks?view=mine')).data.items.length, before);
    const task = await agent.post('/tasks', { title: result.data.plan.task_title, description: result.data.plan.task_description,
      assignee_id: agent.user.id, related_type: 'lead', related_id: lead.id, due_at: new Date(Date.now() + 4 * 3_600_000).toISOString() });
    assert.equal(task.status, 201);
    assert.equal(task.data.item.related_id, lead.id);
  } finally { await app.close(); }
});

test('AI provider request is bounded, non-stored, and invalid listing references are removed', async () => {
  let body;
  const plan = await generateLeadPlan({ apiKey: 'test-only', context: { matches: [{ ref: 'DR-1' }] },
    fetchImpl: async (_url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ...samplePlan, listing_ref: 'INVENTED' }) }] }] }) };
    } });
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, 'none');
  assert.equal(body.text.format.strict, true);
  assert.equal(plan.listing_ref, '');
});

test('AI generation stops at the per-user daily limit before calling the provider', async () => {
  let calls = 0;
  const app = await startApp({ config: { aiClient: async () => { calls++; return samplePlan; } } });
  try {
    const agent = await as(app.base, 'agent');
    const lead = (await agent.get('/ai/queue')).data.items[0];
    const user = await app.db.get('SELECT tenant_id FROM users WHERE id = ?', agent.user.id);
    await app.db.withContext({ tenantId: user.tenant_id }, async () => {
      for (let i = 0; i < 30; i++) await app.db.run(
        'INSERT INTO audit_log(id, tenant_id, actor_id, action, entity, entity_id, at) VALUES (?,?,?,?,?,?,?)',
        randomUUID(), user.tenant_id, agent.user.id, 'ai.plan_generated', 'lead', lead.id, new Date().toISOString());
    });
    const result = await agent.post(`/ai/leads/${lead.id}/plan`);
    assert.equal(result.status, 429);
    assert.equal(calls, 0);
  } finally { await app.close(); }
});
