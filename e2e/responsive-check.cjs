// Checks every staff route at 375px width, in Arabic and English, for horizontal overflow.
// Run (web app on :3000, seeded data):  node e2e/responsive-check.cjs
const { chromium } = require('playwright');
const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
async function login(ctx, user, pass) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login');
  await p.locator('input[autocomplete=username]').fill(user);
  await p.locator('input[autocomplete=current-password]').fill(pass);
  await p.locator('button[type=submit]').click();
  await p.waitForURL('**/staff');
  return p;
}
(async () => {
  const b = await chromium.launch();
  const results = [];
  for (const locale of ['ar', 'en']) {
    const ctx = await b.newContext({ viewport: { width: 375, height: 800 }, isMobile: true });
    await ctx.addCookies([{ name: 'vms_locale', value: locale, url: BASE }]);
    const p = await login(ctx, 'admin', 'Admin-demo-2026!');
    const routes = ['/staff', '/staff/requests', '/staff/scan', '/staff/inside', '/staff/register', '/staff/visits', '/staff/visitors', '/staff/log', '/staff/gates', '/staff/villas', '/staff/users', '/staff/settings', '/staff/audit', '/staff/notifications', '/staff/account', '/privacy', '/'];
    const visitId = await p.evaluate(async () => (await (await fetch('/api/v1/visits?pageSize=1')).json()).items[0].id);
    const visitorId = await p.evaluate(async () => (await (await fetch('/api/v1/visitors?pageSize=1')).json()).items[0].id);
    routes.push(`/staff/visits/${visitId}`, `/staff/requests/${visitId}`, `/staff/visitors/${visitorId}`);
    for (const r of routes) {
      await p.goto(BASE + r);
      await p.waitForTimeout(1200);
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      results.push(`${locale} ${r} scrollWidth=${w}${w > 376 ? '  <-- OVERFLOW' : ''}`);
    }
    await ctx.close();
  }
  console.log(results.join('\n'));
  await b.close();
})();
