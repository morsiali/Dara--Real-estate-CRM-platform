// End-to-end smoke test of real UI flows in Chromium (dev only; needs Playwright installed).
// Usage: node scripts/e2e.mjs http://localhost:4310
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const base = process.argv[2] || 'http://localhost:4310';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const errors = [];
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(`PASS ${name}`); } catch (e) {
    results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    if (process.env.SHOTS) for (const [n, p] of [['agent', agent], ['manager', manager]]) await p?.screenshot({ path: `${process.env.SHOTS}/fail-${n}.png` }).catch(() => {});
  }
}
async function signIn(ctx, role) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${role}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/40[19]/.test(m.text())) errors.push(`${role}: ${m.text()}`); });
  await page.goto(base + '/');
  await page.click(`[data-fill="${role}"]`);
  await page.click('#signin-btn');
  await page.waitForURL('**/app#/home');
  await page.waitForSelector('.kpi');
  return page;
}

const mCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const aCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const lCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
let manager, agent, lead;

await step('landing sign-in form → workspace (manager, agent, team lead)', async () => {
  manager = await signIn(mCtx, 'manager'); agent = await signIn(aCtx, 'agent'); lead = await signIn(lCtx, 'lead');
  assert.equal(await manager.locator('.side-nav a[href="#/team"]').count(), 1, 'manager sees Team control');
  assert.equal(await agent.locator('.side-nav a[href="#/team"]').count(), 0, 'agent does not see Team control');
  assert.equal(await agent.locator('.side-nav a[href="#/people"]').count(), 0, 'agent does not see People');
});

await step('agent adds a lead through the modal and lands on its detail page', async () => {
  await agent.goto(base + '/app#/leads');
  await agent.click('text=Add lead');
  await agent.fill('#f_first_name', 'E2E');
  await agent.fill('#f_last_name', 'Client');
  await agent.fill('#f_phone', '+971 50 999 0000');
  await agent.fill('#f_budget_max', '2500000');
  await agent.check('.chip-opt:has-text("Apartment") input');
  await agent.fill('#f_locations', 'Dubai Marina');
  await agent.click('.modal-foot .btn-primary');
  await agent.waitForURL(/#\/lead\//);
  await agent.waitForSelector('.match, .state-empty');
  assert.equal(await agent.locator('.page-title').textContent(), 'E2E Client');
});

await step('agent moves the lead to qualified and sees matches with reasons', async () => {
  await agent.click('text=Change status');
  await agent.selectOption('#f_status', 'qualified');
  await agent.click('.modal-foot .btn-primary');
  await agent.waitForSelector('text=Convert to deal');
  const reasons = await agent.locator('.match .reasons li').count();
  assert.ok(reasons > 0, 'match reasons shown');
});

await step('team lead assigns a task; agent submits; team lead approves; agent gets points', async () => {
  await lead.goto(base + '/app#/tasks');
  await lead.click('text=Assign task');
  await lead.selectOption('#f_assignee_id', { label: 'Aisha Rahman — Agent' });
  await lead.fill('#f_title', 'E2E: send floor plans');
  await lead.click('.modal-foot .btn-primary');
  await lead.waitForSelector('.toast');
  await agent.goto(base + '/app#/tasks');
  const row = agent.locator('.task', { hasText: 'E2E: send floor plans' });
  await row.locator('text=Submit for review').click();
  await agent.fill('#confirm_reason', 'Sent via WhatsApp');
  await agent.click('.modal-foot .btn-primary');
  await agent.waitForSelector('.task:has-text("E2E: send floor plans") .b-submitted');
  await lead.goto(base + '/app#/tasks?view=review');
  await lead.locator('.task', { hasText: 'E2E: send floor plans' }).locator('text=Approve').click();
  await lead.waitForSelector('.toast:has-text("Task approved")');
  await agent.waitForSelector('.toast-points', { timeout: 5000 });
});

await step('real-time chat: agent message appears in manager’s open channel', async () => {
  await manager.goto(base + '/app#/chat');
  await manager.waitForSelector('.composer-input');
  await agent.goto(base + '/app#/chat');
  await agent.waitForSelector('.composer-input');
  await agent.fill('.composer-input', 'E2E live message @Omar');
  await agent.keyboard.press('Enter');
  await manager.waitForSelector('.msg:has-text("E2E live message")', { timeout: 5000 });
  await manager.waitForSelector('.notif-btn .count:not([hidden])', { timeout: 5000 });
});

await step('calendar: schedule, detect conflict, save anyway', async () => {
  const day = `2031-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-${String(10 + Math.floor(Math.random() * 18))}`;
  await agent.goto(base + '/app#/calendar');
  await agent.click('text=Schedule');
  await agent.fill('#f_title', 'E2E viewing');
  await agent.selectOption('#f_type', 'viewing');
  await agent.fill('#f_start_at', `${day}T10:00`);
  await agent.fill('#f_end_at', `${day}T11:00`);
  await agent.click('.modal-foot .btn-primary');
  await agent.waitForSelector('.toast:has-text("Scheduled")');
  await agent.click('text=Schedule');
  await agent.fill('#f_title', 'E2E clash');
  await agent.fill('#f_start_at', `${day}T10:30`);
  await agent.fill('#f_end_at', `${day}T11:30`);
  await agent.click('.modal-foot .btn-primary');
  await agent.waitForSelector('text=Time overlaps other events');
  await agent.click('button:has-text("Save anyway")');
  await agent.waitForSelector('.overlay', { state: 'detached' });
  await agent.waitForSelector(`.toast:has-text("Scheduled")`);
});

await step('manager drills into a member dashboard from team control', async () => {
  await manager.goto(base + '/app#/team');
  await manager.click('table.data a.person >> nth=0');
  await manager.waitForSelector('.member-hero');
  assert.ok(await manager.locator('.badges li').count() >= 8);
});

await step('pipeline: open a deal and see stage history', async () => {
  await manager.goto(base + '/app#/pipeline');
  await manager.click('.deal-card >> nth=0');
  await manager.waitForSelector('.modal h3:has-text("Stage history")');
  await manager.keyboard.press('Escape');
});

await step('Arabic switches the layout to RTL', async () => {
  const before = await manager.evaluate(() => document.documentElement.dir);
  await manager.click('.user-menu summary');
  await manager.click('.menu-item >> nth=1'); // language toggle
  await manager.waitForFunction((b) => document.documentElement.dir !== b, before);
  if (before === 'rtl') { await manager.click('.user-menu summary'); await manager.click('.menu-item >> nth=1'); await manager.waitForFunction(() => document.documentElement.dir === 'rtl'); }
  await manager.click('.user-menu summary'); await manager.click('.menu-item >> nth=1'); // back to English for the next run
  await manager.waitForFunction(() => document.documentElement.dir === 'ltr');
});

await step('a new brokerage signs up from the landing page and lands in an empty trial workspace', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`signup: ${e.message}`));
  await page.goto(base + '/#trial');
  await page.fill('#t-company', 'E2E Realty');
  await page.fill('#t-name', 'Eve Owner');
  await page.fill('#t-email', `eve+${Date.now()}@e2e-realty.ae`);
  await page.fill('#t-password', 'E2ePassword2026');
  await page.check('#t-terms');
  await page.click('#trial-btn');
  await page.waitForURL('**/app#/home');
  await page.waitForSelector('.sub-banner:has-text("Trial")');
  await page.waitForSelector('text=Welcome to Dara');
  assert.equal(await page.locator('.side-nav a[href="#/workspace"]').count(), 1);
  await page.goto(base + '/app#/workspace');
  await page.waitForSelector('text=Subscription');
  await ctx.close();
});

await step('agent holds a unit from listings; manager sees it in reservations', async () => {
  await agent.goto(base + '/app#/listings');
  await agent.click('.listing:has(button:has-text("Hold unit")) button:has-text("Hold unit") >> nth=0');
  await agent.click('.modal-foot .btn-primary');
  await agent.waitForSelector('.toast:has-text("held for 48 hours")');
  await manager.goto(base + '/app#/reservations');
  await manager.waitForSelector('table.data tbody tr');
});

await step('platform staff see only the platform console', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + '/'); await page.click('[data-fill="platform"]'); await page.click('#signin-btn');
  await page.waitForURL('**/app#/platform');
  await page.waitForSelector('text=Workspaces');
  assert.equal(await page.locator('.side-nav a[href="#/leads"]').count(), 0);
  await ctx.close();
});

await step('sign out returns to the landing page and protects the app', async () => {
  await agent.click('.user-menu summary');
  await agent.click('.menu-item:has-text("Sign out")');
  await agent.waitForURL(base + '/');
  await agent.goto(base + '/app#/home');
  await agent.waitForURL(/#signin/);
});

await browser.close();
console.log(results.join('\n'));
console.log(errors.length ? `\nBrowser errors:\n${errors.join('\n')}` : '\nNo browser errors.');
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
