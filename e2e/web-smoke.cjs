// End-to-end smoke test of the web app against the DEVELOPMENT seed data (pnpm db:seed --reset).
// Requires Playwright with Chromium:  npm i -g playwright && npx playwright install chromium
// Run (web app on :3000):  node e2e/web-smoke.cjs    — screenshots go to e2e/output/web
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = path.join(__dirname, 'output', 'web');
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${label}] console: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message.slice(0, 300)}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`);
  });
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log('shot', name);
}

(async () => {
  const browser = await chromium.launch();

  // ───────── Staff (admin) flow, Arabic, desktop ─────────
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-SA' });
  const p = await admin.newPage();
  watch(p, 'admin');
  await p.goto(BASE + '/');
  await shot(p, '01-landing-ar');
  await p.goto(BASE + '/login');
  await p.getByLabel('اسم المستخدم').fill('admin');
  await p.locator('input[autocomplete=current-password]').fill('Admin-demo-2026!');
  await p.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await p.waitForURL('**/staff');
  await p.getByText('طلبات بانتظار الموافقة').first().waitFor();
  await shot(p, '02-admin-dashboard-ar');

  await p.goto(BASE + '/staff/requests');
  await p.locator('tbody tr').first().waitFor();
  await shot(p, '03-requests-queue');
  await p.locator('tbody tr').first().click();
  await p.waitForURL('**/staff/requests/**');
  await p.getByText('الزيارات السابقة').waitFor();
  await shot(p, '04-review-detail');
  const approveBtn = p.getByRole('button', { name: 'موافقة' }).first();
  if (await approveBtn.isEnabled()) {
    await approveBtn.click();
    await p.getByRole('dialog').getByRole('button', { name: 'موافقة' }).click();
    await p.waitForURL('**/staff/requests');
    console.log('approved a request');
  } else console.log('approve disabled (blocked)');

  await p.goto(BASE + '/staff/visits');
  await p.locator('tbody tr').first().waitFor();
  await shot(p, '05-visit-history');
  await p.goto(BASE + '/staff/inside');
  await p.locator('tbody tr').first().waitFor();
  await shot(p, '06-inside');
  await p.goto(BASE + '/staff/visitors');
  await p.locator('tbody tr').first().waitFor();
  await shot(p, '07-visitors');
  await p.locator('tbody tr').first().click();
  await p.waitForURL('**/staff/visitors/**');
  await p.getByText('سجل تعديلات الملف').waitFor();
  await shot(p, '08-visitor-profile');
  await p.goto(BASE + '/staff/gates');
  await p.locator('svg[role=img]').first().waitFor();
  await shot(p, '09-gates');
  await p.goto(BASE + '/staff/audit');
  await p.locator('tbody tr').first().waitFor();
  await shot(p, '10-audit');
  await p.goto(BASE + '/staff/register');
  await p.getByLabel('رقم الهوية أو الإقامة').fill('1072979493');
  await p.getByRole('button', { name: 'بحث' }).first().click();
  await p.getByText('تم العثور على ملف الزائر').waitFor();
  await shot(p, '11-register-found');

  // Scan: manual lookup of an approved visit (headless browser has no camera).
  const approved = await p.evaluate(async () => (await (await fetch('/api/v1/visits?status=approved&pageSize=5')).json()).items);
  await p.goto(BASE + '/staff/scan?action=entry');
  await p.getByText('بحث يدوي').first().waitFor();
  await shot(p, '12-scan-idle');
  if (approved.length) {
    await p.getByLabel('بحث يدوي').fill(approved[0].reference);
    await p.getByRole('button', { name: 'بحث' }).click();
    await p.locator('button:has-text("' + approved[0].reference + '")').first().click();
    await p.getByText('تحقق من هوية الزائر').waitFor();
    await shot(p, '13-scan-verify');
  }

  // English layout
  await admin.addCookies([{ name: 'vms_locale', value: 'en', url: BASE }]);
  await p.goto(BASE + '/staff');
  await p.getByText('Pending requests').first().waitFor();
  await shot(p, '14-admin-dashboard-en');
  await admin.addCookies([{ name: 'vms_locale', value: 'ar', url: BASE }]);

  // ───────── Visitor flow, Arabic, phone viewport ─────────
  const visitorCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-SA', isMobile: true, hasTouch: true });
  const v = await visitorCtx.newPage();
  watch(v, 'visitor');
  await v.goto(BASE + '/visitor');
  await v.getByLabel('رقم الهوية أو الإقامة').fill('١٠٤٧٣٤٣١٣٠'); // Arabic-Indic digits
  await v.getByRole('textbox', { name: 'رقم الجوال' }).fill('0541234504');
  await shot(v, '20-visitor-verify');
  await v.getByRole('button', { name: 'إرسال رمز التحقق' }).click();
  await v.getByText('أدخل رمز التحقق').first().waitFor();
  const outbox = await v.evaluate(async () => (await (await fetch('/api/v1/dev/otp-outbox')).json()).items);
  await v.getByLabel('رمز التحقق').fill(outbox[0].code);
  await shot(v, '21-visitor-otp');
  await v.getByRole('button', { name: 'تحقق' }).click();
  await v.waitForURL('**/visitor/home');
  await shot(v, '22-visitor-home');
  await v.goto(BASE + '/visitor/request');
  await v.getByLabel('رقم الفيلا').selectOption({ index: 5 });
  await v.getByRole('radio', { name: 'توصيل' }).click();
  const d = new Date(Date.now() + (3 + Math.floor(Math.random() * 20)) * 86400000);
  await v.getByLabel('تاريخ الدخول').fill(d.toISOString().slice(0, 10));
  await v.getByLabel('وقت الدخول').fill('10:30');
  await shot(v, '23-request-details');
  await v.getByRole('button', { name: 'التالي' }).click();
  await v.getByText('راجع بيانات الطلب قبل الإرسال').waitFor();
  await shot(v, '24-request-review');
  await v.getByRole('button', { name: 'إرسال للموافقة' }).click();
  await v.getByText('تم إرسال طلبك').waitFor();
  await shot(v, '25-request-submitted');

  // Visitor with an approved/inside visit → pass
  const khaledCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-SA', isMobile: true });
  const k = await khaledCtx.newPage();
  watch(k, 'visitor2');
  await k.goto(BASE + '/visitor');
  await k.getByLabel('رقم الهوية أو الإقامة').fill('1000468221');
  await k.getByRole('textbox', { name: 'رقم الجوال' }).fill('0501234501');
  await k.getByRole('button', { name: 'إرسال رمز التحقق' }).click();
  await k.getByText('أدخل رمز التحقق').first().waitFor();
  const outbox2 = await k.evaluate(async () => (await (await fetch('/api/v1/dev/otp-outbox')).json()).items);
  await k.getByLabel('رمز التحقق').fill(outbox2[0].code);
  await k.getByRole('button', { name: 'تحقق' }).click();
  await k.waitForURL('**/visitor/home');
  const viewPass = k.getByRole('link', { name: 'عرض تصريح الزيارة' });
  await viewPass.waitFor({ timeout: 10000 }).catch(() => undefined);
  if (await viewPass.count()) {
    await viewPass.click();
    await k.locator('#pass svg[role=img]').waitFor();
    await shot(k, '26-visitor-pass');
  }

  // Security staff on phone
  const guardCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-SA', isMobile: true });
  const g = await guardCtx.newPage();
  watch(g, 'guard');
  await g.goto(BASE + '/login');
  await g.getByLabel('اسم المستخدم').fill('guard1');
  await g.locator('input[autocomplete=current-password]').fill('Guard-demo-2026!');
  await g.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await g.waitForURL('**/staff');
  await g.getByText('مسح دخول').waitFor();
  await shot(g, '30-security-home-mobile');
  // Security cannot open approval queue
  const res = await g.evaluate(async () => (await fetch('/api/v1/visits?status=pending')).status);
  console.log('security GET /visits (history) status =', res);

  await browser.close();
  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
})().catch((e) => {
  console.error('FAILED', e);
  console.log('\nPROBLEMS:', problems.join('\n'));
  process.exit(1);
});
