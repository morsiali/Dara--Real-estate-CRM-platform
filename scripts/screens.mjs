// Dev helper: screenshots key pages and reports console errors. Usage: node scripts/screens.mjs <baseUrl> <outDir> [pages...]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pwPath = process.env.PW_PATH || '/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(pwPath);
const [base = 'http://localhost:4311', out = '.', ...only] = process.argv.slice(2);
const pages = [
  ['landing', '/', null, 1400], ['landing-mobile', '/', null, 390],
  ['home', '/app#/home', 'manager'], ['me-agent', '/app#/me', 'agent'], ['team', '/app#/team', 'manager'], ['leaderboard', '/app#/leaderboard', 'manager'],
  ['leads', '/app#/leads', 'lead'], ['pipeline', '/app#/pipeline', 'manager'], ['listings', '/app#/listings', 'agent'], ['tasks', '/app#/tasks?view=review', 'manager'],
  ['calendar', '/app#/calendar', 'lead'], ['chat', '/app#/chat', 'agent'], ['time', '/app#/time', 'manager'], ['people', '/app#/people', 'admin'], ['audit', '/app#/audit', 'admin'],
  ['projects', '/app#/projects', 'manager'], ['reservations', '/app#/reservations', 'manager'], ['workspace', '/app#/workspace', 'admin'],
  ['platform', '/app#/platform', 'platform'], ['owner-home', '/app#/home', 'owner'],
  ['home-mobile', '/app#/home', 'agent', 390], ['home-ar', '/app#/home', 'manager', 1400, 'ar'],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const errors = [];
for (const [name, path, role, width = 1400, lang] of pages) {
  if (only.length && !only.includes(name)) continue;
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}: PAGEERROR ${e.message}`));
  if (role) {
    await page.goto(base + '/');
    await page.evaluate(async ({ role, lang }) => {
      if (lang) localStorage.setItem('dara.lang', lang);
      await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dara' }, body: JSON.stringify({ email: role === 'owner' ? 'owner@palmcoast.demo' : `${role}@dara.demo`, password: 'DaraDemo2026' }) });
    }, { role, lang });
  }
  await page.goto(base + path);
  await page.waitForTimeout(role ? 1500 : 3400);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: !role || name.includes('mobile') });
  await ctx.close();
}
await browser.close();
console.log(errors.length ? 'Console errors:\n' + errors.join('\n') : 'No console errors.');
