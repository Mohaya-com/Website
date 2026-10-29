// Renders the Expo app with react-native-web and walks admin, security and visitor flows (phone viewport).
// 1) EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo export --platform web --output-dir dist-web  (in apps/mobile)
// 2) serve dist-web on :8090 with SPA fallback, and set ADDITIONAL_ORIGINS=http://localhost:8090 in .env
// 3) node e2e/mobile-web-smoke.cjs   — screenshots go to e2e/output/mobile
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const APP = process.env.MOBILE_WEB_URL ?? 'http://localhost:8090';
const API = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = path.join(__dirname, 'output', 'mobile');
fs.mkdirSync(OUT, { recursive: true });
const problems = [];

async function newPage(b, label) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message.slice(0, 200)}`));
  p.on('console', (m) => m.type() === 'error' && problems.push(`[${label}] console: ${m.text().slice(0, 200)}`));
  return p;
}
const shot = async (p, name) => {
  await p.waitForTimeout(900);
  await p.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot', name);
};

async function staffLogin(p, user, pass) {
  await p.goto(APP + '/welcome');
  await p.getByText('دخول الموظفين').first().click();
  await p.getByLabel('اسم المستخدم').fill(user);
  await p.getByLabel('كلمة المرور').fill(pass);
  await p.getByRole('button', { name: 'تسجيل الدخول' }).click();
}

(async () => {
  const b = await chromium.launch();

  // Welcome
  const w = await newPage(b, 'welcome');
  await w.goto(APP + '/');
  await w.getByText('مرحبًا بك').waitFor({ timeout: 30000 });
  await shot(w, 'm01-welcome');

  // Admin
  const a = await newPage(b, 'admin');
  await staffLogin(a, 'admin', 'Admin-demo-2026!');
  await a.getByText('لوحة التحكم').first().waitFor();
  await a.getByText('طلبات بانتظار الموافقة').first().waitFor();
  await shot(a, 'm02-admin-dashboard');
  await a.getByRole('tab', { name: /طلبات الموافقة/ }).or(a.getByText('طلبات الموافقة').last()).first().click();
  await a.waitForTimeout(1500);
  await shot(a, 'm03-admin-queue');
  const firstCard = a.getByRole('button', { name: /بانتظار الموافقة/ }).first();
  if (await firstCard.count()) {
    await firstCard.click();
    await a.getByText('الزيارات السابقة').waitFor({ timeout: 15000 });
    await shot(a, 'm04-admin-review');
    await a.mouse.wheel(0, 900);
    await shot(a, 'm05-admin-review-history');
  }
  await a.goBack();
  await a.getByText('المزيد').last().click();
  await a.getByText('العمليات').first().waitFor();
  await shot(a, 'm06-admin-more');

  // Security
  const g = await newPage(b, 'guard');
  await staffLogin(g, 'guard1', 'Guard-demo-2026!');
  await g.getByText('مسح دخول').waitFor();
  await shot(g, 'm07-security-home');
  await g.getByText('مسح QR').last().click();
  await g.getByText('بحث يدوي').first().waitFor();
  await shot(g, 'm08-security-scan');

  // Visitor
  const v = await newPage(b, 'visitor');
  await v.goto(APP + '/visitor-verify');
  await v.getByLabel('رقم الهوية أو الإقامة').fill('1000468221');
  await v.getByLabel('رقم الجوال').fill('0501234501');
  await shot(v, 'm09-visitor-verify');
  await v.getByRole('button', { name: 'إرسال رمز التحقق' }).click();
  await v.getByText('أدخل رمز التحقق').first().waitFor();
  const outbox = await (await fetch(API + '/api/v1/dev/otp-outbox')).json();
  await v.getByLabel('رمز التحقق').fill(outbox.items[0].code);
  await shot(v, 'm10-visitor-otp');
  await v.getByRole('button', { name: 'تحقق' }).click();
  await v.getByText('زيارتك الحالية').waitFor({ timeout: 20000 });
  await shot(v, 'm11-visitor-home');
  const passBtn = v.getByRole('button', { name: 'عرض تصريح الزيارة' });
  if (await passBtn.count()) {
    await passBtn.first().click();
    await v.getByText('لا يحتوي الرمز على أي بيانات شخصية').waitFor();
    await v.mouse.wheel(0, 500);
    await shot(v, 'm12-visitor-pass');
  }
  await v.goBack();
  await v.getByText('طلب زيارة').last().click();
  await v.getByText('الخطوة 1 من 3').first().waitFor();
  await shot(v, 'm13-visitor-request');

  await b.close();
  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
})().catch((e) => {
  console.error('FAILED', e.message);
  console.log('\nPROBLEMS:', problems.join('\n'));
  process.exit(1);
});
