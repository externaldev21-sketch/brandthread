// Text-fit and alignment check for the public /account-deletion page.
// Usage: BASE=http://localhost:4599 OUT=dir CHROMIUM_PATH=/path/to/chrome node scripts/account-deletion-page-check.mjs
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://localhost:3000';
const out = process.env.OUT || '.';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failures = 0;

async function check(page, label) {
  const problems = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('h1,h2,p,li,label,button,input,a')) {
      if (el.hidden || el.offsetParent === null) continue;
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && el.tagName !== 'INPUT') bad.push(`${el.tagName} "${el.textContent.trim().slice(0, 30)}" scrollWidth>clientWidth`);
      if (cs.textOverflow === 'ellipsis') bad.push(`${el.tagName} uses ellipsis`);
      const r = el.getBoundingClientRect();
      const p = el.parentElement.getBoundingClientRect();
      if (r.left < p.left - 1 || r.right > p.right + 1) bad.push(`${el.tagName} "${el.textContent.trim().slice(0, 30)}" overflows parent`);
      if (r.right > innerWidth + 1) bad.push(`${el.tagName} beyond viewport`);
      if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT') && r.height < 44) bad.push(`${el.tagName} height ${r.height}`);
      if (el.tagName === 'INPUT' && parseFloat(cs.paddingLeft) < 12) bad.push('INPUT horizontal padding under 12px');
    }
    const lefts = new Set([...document.querySelectorAll('h1,h2,p,label,input,button,ul')].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().left)));
    if (lefts.size > 1) bad.push(`left edges not on one grid: ${[...lefts]}`);
    if (document.documentElement.scrollWidth > innerWidth) bad.push('horizontal page scroll');
    return bad;
  });
  console.log(label, problems.length ? problems : 'OK');
  failures += problems.length;
}

for (const [name, size] of [['mobile', { width: 393, height: 852 }], ['desktop', { width: 1280, height: 800 }]]) {
  const ctx = await browser.newContext({ viewport: size });
  const page = await ctx.newPage();
  await page.route('**/api/public/account-deletion/request', (r) => r.fulfill({ json: { ok: true, message: 'If an account exists for that email, we sent a confirmation link to it. Nothing is deleted until you open the link and confirm.' } }));
  await page.route('**/api/public/account-deletion/confirm', (r) => r.fulfill({ status: 409, json: { error: 'Settle the items below before deleting your account.', blockers: [{ title: 'Open orders', detail: '2 orders are waiting to ship.' }] } }));
  await page.goto(`${base}/account-deletion`);
  await page.screenshot({ path: `${out}/${name}-request.png`, fullPage: true });
  await check(page, `${name} request`);
  await page.fill('#email', 'owner@example.com');
  await page.click('#request-button');
  await page.waitForSelector('#request-status:not(:empty)');
  await page.screenshot({ path: `${out}/${name}-request-sent.png`, fullPage: true });
  await check(page, `${name} request-sent`);
  await page.goto(`${base}/account-deletion?token=${'a'.repeat(64)}`);
  await page.screenshot({ path: `${out}/${name}-confirm.png`, fullPage: true });
  await check(page, `${name} confirm`);
  await page.fill('#confirmation', 'DELETE');
  await page.click('#confirm-button');
  await page.waitForSelector('#confirm-status:not(:empty)');
  await page.screenshot({ path: `${out}/${name}-confirm-blocked.png`, fullPage: true });
  await check(page, `${name} confirm-blocked`);
  await ctx.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
