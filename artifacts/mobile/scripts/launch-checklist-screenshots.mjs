#!/usr/bin/env node
/**
 * Screenshots + text-fit audit for the seller launch checklist PR at 393x852,
 * driven against the local Expo web server (`expo start --web --port <N>`) in
 * ?bt_preview=seller mode. `&demo=1` turns on the demo checklist; without it
 * the preview never calls the API and the dashboard card stays hidden (the
 * "before").
 *
 *   node scripts/launch-checklist-screenshots.mjs --port <N>
 *
 * Output: docs/pr-assets/seller-launch-checklist/*.png. Exits non-zero when the
 * audit finds clipped / ellipsised / overflowing text or cramped buttons.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const MOBILE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(MOBILE_ROOT, '../../docs/pr-assets/seller-launch-checklist');
const portArg = process.argv.indexOf('--port');
const ORIGIN = `http://localhost:${portArg >= 0 ? process.argv[portArg + 1] : '8151'}`;
const problems = [];

/** Runs inside the page: every finding is a string. */
function auditInPage(rootSelector) {
  const found = [];
  const vw = window.innerWidth;
  const textRect = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect();
  };
  const scope = rootSelector ? document.querySelector(rootSelector) : document.body;
  if (!scope) return ['audit root not found'];
  for (const el of scope.querySelectorAll('*')) {
    if (el.closest('[data-testid="seller-global-tab-bar"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (/^[\uE000-\uF8FF]+$/.test(el.textContent.trim())) continue; // icon glyphs
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!own) continue;
    const label = own.slice(0, 40);
    // Skip screens stacked underneath and anything scrolled out of view.
    const er = el.getBoundingClientRect();
    if (er.width === 0 || er.bottom < 0 || er.top > window.innerHeight) continue;
    const hit = document.elementFromPoint(Math.min(Math.max(er.left + er.width / 2, 0), vw - 1), Math.min(Math.max(er.top + er.height / 2, 0), window.innerHeight - 1));
    if (!hit || !(el.contains(hit) || hit.contains(el))) continue;
    if (el.scrollWidth > el.clientWidth + 1) found.push(`text wider than its box: "${label}"`);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) found.push(`ellipsis: "${label}"`);
    if (parseFloat(cs.fontSize) < 12) found.push(`font under 12px: "${label}"`);
    const tr = textRect(el);
    const pr = el.parentElement?.getBoundingClientRect();
    if (pr && (tr.left < pr.left - 1 || tr.right > pr.right + 1)) found.push(`text leaves its parent: "${label}"`);
    if (tr.left < 0 || tr.right > vw + 1) found.push(`text outside viewport: "${label}"`);
    const btn = el.closest('button, [role="button"]');
    const br = btn?.getBoundingClientRect();
    if (btn && br.height <= 90) {
      if (tr.left - br.left < 12 - 0.5 || br.right - tr.right < 12 - 0.5) found.push(`button padding under 12px: "${label}" text ${Math.round(tr.left)}-${Math.round(tr.right)} button ${Math.round(br.left)}-${Math.round(br.right)}`);
      if (!btn.innerText.includes('\n') && Math.abs((tr.top + tr.bottom) / 2 - (br.top + br.bottom) / 2) > 2.5) found.push(`button text not vertically centred: "${label}" text ${Math.round(tr.top)}-${Math.round(tr.bottom)} button ${Math.round(br.top)}-${Math.round(br.bottom)} ${btn.tagName}`);
    }
  }
  return found;
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      colorScheme: 'dark', reducedMotion: 'no-preference', acceptDownloads: true,
    });
    // The signed-out preview has no public-profile data of its own, so the
    // owner's public profile read is stubbed here (screenshot run only).
    await ctx.route('**/public/sellers/preview-seller*', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ profile: { id: 'preview-seller', clerkId: 'preview-seller', brandName: 'Atelier', username: 'atelier', bio: 'Made in small runs.', productsCount: 1, followersCount: 0, followingCount: 0, likesCount: 0 }, products: [], posts: [] }),
    }));
    const page = await ctx.newPage();
    const shot = async (name, { audit = true } = {}) => {
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      let found = [];
      if (audit) found = await page.evaluate(auditInPage, null);
      for (const f of found) { problems.push(`${name}: ${f}`); console.log(`     ! ${f}`); }
      console.log(`  ok ${name}${found.length ? `  (${found.length} audit findings)` : ''}`);
    };
    const zoom = async (name, locator) => {
      await locator.screenshot({ path: path.join(OUT, `${name}.png`) });
      console.log(`  ok ${name}`);
    };
    const accept = async () => {
      const b = page.getByText('Accept all').first();
      if (await b.isVisible().catch(() => false)) await b.click();
    };
    const scrollEnd = async () => {
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('*')) {
          if (el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight;
        }
      });
    };

    // Before: dashboard without the card (no demo flag, API never called).
    await page.goto(`${ORIGIN}/?bt_preview=seller`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForTimeout(4000);
    await accept();
    await scrollEnd();
    await shot('01-dashboard-before', { audit: false });

    // After: demo checklist -> card is the last section.
    await page.goto(`${ORIGIN}/?bt_preview=seller&demo=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForTimeout(4000);
    await accept();
    await scrollEnd();
    await shot('02-dashboard-after-card', { audit: false });
    const card = page.getByLabel(/Launch your store, /).first();
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('[aria-label="Dismiss"]').parentElement.parentElement.setAttribute('data-audit-card', '1'));
    for (const f of await page.evaluate(auditInPage, '[data-audit-card]')) problems.push(`dashboard card: ${f}`);
    await zoom('02b-dashboard-card-zoom', page.locator('[data-audit-card]'));

    await card.click();
    await page.getByText('3 / 8 completed').waitFor({ timeout: 30_000 });
    await shot('03-launch-checklist');
    await zoom('03b-checklist-card-zoom', page.getByLabel('Name your store, done').first().locator('xpath=../..'));

    await page.getByLabel('Set up payouts').first().click();
    await shot('04-launch-checklist-payouts-expanded');
    await zoom('04b-checklist-cta-zoom', page.getByLabel('Set up payouts').nth(1));

    await page.getByLabel('Name your store, done').first().click();
    await shot('05-launch-checklist-done-step-expanded');

    // Preview as buyer -> existing owner "View as visitor" profile.
    await page.getByLabel('Preview as a buyer').first().click();
    await page.getByLabel('Preview store').first().click();
    await page.waitForTimeout(4000);
    await shot('06-preview-as-buyer', { audit: false });

    // Publish: confirm state, then live state.
    await page.goto(`${ORIGIN}/launch-publish?bt_preview=seller&demo=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForTimeout(3000);
    await shot('07-publish-confirm');
    await page.getByLabel('Publish store').first().click();
    await page.waitForTimeout(8000);
    await shot('08-publish-blocked-or-live');

    await page.evaluate(() => {
      const key = 'bt:store:v1';
      const cur = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify({ ...cur, publishStatus: 'published' }));
    });
    await page.goto(`${ORIGIN}/launch-publish?bt_preview=seller&demo=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.getByText("You're live").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shot('09-publish-live');
    await zoom('09b-publish-buttons-zoom', page.getByLabel('Copy link').first().locator('xpath=..'));
    await zoom('09c-publish-download-zoom', page.getByLabel('Download QR code').first());

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByLabel('Download QR code').first().click(),
    ]);
    await download.saveAs(path.join(OUT, 'store-qr-download.png'));
    console.log(`  ok downloaded ${download.suggestedFilename()}`);
    await shot('10-publish-live-after-download');
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error(`\nText-fit audit: ${problems.length} finding(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  console.log('\nText-fit audit clean');
}

run().catch((err) => { console.error(err); process.exit(1); });
