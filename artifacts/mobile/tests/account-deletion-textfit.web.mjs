/**
 * Renders the delete-account flow at 393x852 on the Expo web preview (API
 * mocked via Playwright routes), writes screenshots to
 * screenshots/account-deletion/, and fails if any text element is clipped
 * (scrollWidth > clientWidth), overflows its parent, or is truncated with an
 * ellipsis.
 *
 *   BASE_URL=http://localhost:8081 CHROME=/path/to/chrome node tests/account-deletion-textfit.web.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'screenshots', 'account-deletion');
const base = process.env.BASE_URL || 'http://localhost:8081';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
let failures = 0;

async function overflowCheck(page, label) {
  const bad = await page.evaluate(() => {
    const problems = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const text = el.textContent.trim().slice(0, 50);
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') problems.push(`clipped: "${text}"`);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) problems.push(`ellipsis: "${text}"`);
      const p = el.parentElement?.getBoundingClientRect();
      if (p && (r.left < p.left - 1 || r.right > p.right + 1) && p.width > 0) problems.push(`overflows parent: "${text}"`);
      if (r.right > window.innerWidth + 1 || r.left < -1) problems.push(`off-screen: "${text}"`);
    }
    return problems;
  });
  if (bad.length) { failures += bad.length; console.log(`FAIL ${label}:\n  ${bad.join('\n  ')}`); }
  else console.log(`ok   ${label}`);
}

async function run(reauth, cancelled) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/api/**', (route) => {
    if (route.request().url().includes('deletion-check')) {
      return route.fulfill({ json: {
        canDelete: true, accountType: 'buyer', graceDays: 30, reauth, blockers: [],
        deletionCancelledAt: cancelled ? new Date().toISOString() : null,
        willDelete: ['Your profile, posts, comments and messages', 'Your saved items, addresses and settings', 'Your sign-in'],
        willRetain: ['Order, payment and tax records, without your name and address, as the law requires'],
      } });
    }
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ json: { ok: true, scheduledFor: new Date(Date.now() + 30 * 864e5).toISOString(), graceDays: 30 } });
    }
    return route.fulfill({ status: 404, json: { error: 'n/a' } });
  });
  await page.goto(`${base}/delete-account?bt_preview=buyer&demo=1`, { waitUntil: 'networkidle', timeout: 240000 });
  await page.waitForTimeout(3000);
  await page.getByText('Necessary only').click().catch(() => {});
  await page.addStyleTag({ content: '#error-overlay{display:none!important}' });
  const tag = `${reauth}${cancelled ? '-cancelled' : ''}`;

  await page.screenshot({ path: `${out}/1-overview-${tag}.png` });
  await page.screenshot({ path: `${out}/1-overview-${tag}-full.png`, fullPage: true });
  await overflowCheck(page, `overview (${tag})`);

  await page.getByText('Continue', { exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/2-confirm-${reauth}.png` });
  await overflowCheck(page, `confirm (${reauth})`);

  await page.getByPlaceholder('DELETE').fill('DELETE');
  if (reauth === 'password') await page.getByPlaceholder('Password').fill('secret123');
  else await page.getByPlaceholder('000000').fill('123456');
  await page.getByRole('checkbox').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/3-confirm-filled-${reauth}.png` });
  await overflowCheck(page, `confirm filled (${reauth})`);

  if (reauth === 'password' && !cancelled) {
    await page.getByRole('button', { name: 'Delete account' }).last().click();
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${out}/4-done.png` });
    await overflowCheck(page, 'done');
  }
  await ctx.close();
}

await run('password', false);
await run('email_code', false);
await run('password', true);
await browser.close();
if (failures) { console.log(`${failures} text-fit problem(s)`); process.exit(1); }
console.log('text-fit check passed');
