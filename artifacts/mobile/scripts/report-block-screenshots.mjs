#!/usr/bin/env node
/**
 * Verification for the Report + Block PR: drives the local Expo web dev server
 * (`pnpm exec expo start --web --port 8734`) through the ReportSheet steps and
 * the Blocked accounts screen at 393x852, with /api/* mocked (no network), and
 * runs the text-fit check (no clipped text, no text overflowing its parent)
 * on each screen.
 *
 *   BASE_URL=http://localhost:8734 node scripts/report-block-screenshots.mjs
 *
 * Output: screenshots/report-block/*.png (full + zoomed). Exits non-zero when
 * the text-fit check finds a problem.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../screenshots/report-block');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8734';
const VIEWPORT = { width: 393, height: 852 };

const BLOCKED = [
  { userId: 'u1', name: 'Maya Chen', handle: '@mayachen', initials: 'MC', avatarUrl: null, accountType: 'buyer', color: '#3F3F46', blockedAt: new Date().toISOString() },
  { userId: 'u2', name: 'Orison Studio', handle: '@orison', initials: 'OS', avatarUrl: null, accountType: 'seller', color: '#3F3F46', blockedAt: new Date().toISOString() },
];

/** Flags text that is clipped (scrollWidth > clientWidth) or sticks out of its parent. */
async function textFitIssues(page, scopeSelector) {
  return page.evaluate((scope) => {
    const root = scope ? document.querySelector(scope) : document.body;
    if (!root) return [`scope ${scope} not found`];
    const issues = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent || '').trim();
      const el = node.parentElement;
      if (!text || !el || seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1 && style.overflow !== 'visible') issues.push(`clipped: "${text.slice(0, 40)}"`);
      if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) issues.push(`ellipsis: "${text.slice(0, 40)}"`);
      const parent = el.parentElement;
      if (parent) {
        const pb = parent.getBoundingClientRect();
        if (box.left < pb.left - 1 || box.right > pb.right + 1) issues.push(`overflows parent: "${text.slice(0, 40)}"`);
      }
      if (box.right > window.innerWidth + 1 || box.left < -1) issues.push(`off-screen: "${text.slice(0, 40)}"`);
      // Inner padding: text inside a filled/bordered control (button, chip) keeps >= 12px each side.
      let anc = el.parentElement;
      while (anc && anc !== root) {
        const cs = getComputedStyle(anc);
        const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
        const bordered = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
        const ab = anc.getBoundingClientRect();
        if ((filled || bordered) && Math.abs(ab.width - ab.height) > 2 && ab.width < window.innerWidth - 40 && ab.height < 120) {
          if (box.left - ab.left < 11.5 || ab.right - box.right < 11.5) issues.push(`padding <12px: "${text.slice(0, 40)}"`);
          break;
        }
        anc = anc.parentElement;
      }
    }
    return issues;
  }, scopeSelector);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  // The API host differs from the page origin, so every mock carries CORS headers.
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  };
  const mock = (pattern, status, json) => context.route(pattern, (route) => (
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({ status, headers: cors, json })
  ));
  await mock('**/api/v1/social/blocks*', 200, BLOCKED);
  await mock('**/api/v1/social/block-status/*', 200, { blockedByMe: false, blockedMe: false });
  await mock('**/api/v1/safety/muted-words*', 200, { words: [], limit: 50 });
  await mock('**/api/v1/reports', 201, { id: 'r1', status: 'pending' });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  if (process.env.DEBUG_REQUESTS) page.on('request', (r) => { if (r.url().includes('/api/')) console.log('  [request]', r.method(), r.url()); });
  let failures = 0;

  async function check(name, scope) {
    const issues = await textFitIssues(page, scope);
    if (issues.length) { failures += issues.length; console.log(`  TEXT-FIT ${name}:`, issues); } else console.log(`  text-fit ok: ${name}`);
  }
  async function shot(name, selector) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    if (selector) {
      const el = page.locator(selector).first();
      if (await el.count()) await el.screenshot({ path: path.join(OUT, `${name}-zoom.png`) });
    }
    console.log(`  captured ${name}`);
  }

  // Blocked accounts (Settings -> Privacy -> Blocked accounts).
  await page.goto(`${BASE_URL}/buyer-blocked?bt_preview=buyer`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForTimeout(4000);
  const accept = page.getByText('Accept all', { exact: true }).first();
  if (await accept.isVisible().catch(() => false)) await accept.click();
  await page.waitForTimeout(800);
  await shot('blocked-accounts');
  await check('blocked-accounts');

  // ReportSheet from chat Privacy & safety -> Report.
  await page.goto(
    `${BASE_URL}/conversation-privacy-safety?id=c1&participantUserId=u1&participantName=Maya%20Chen&bt_preview=buyer`,
    { waitUntil: 'load', timeout: 240000 },
  );
  await page.waitForTimeout(3500);
  await page.getByTestId('privacy-safety-report').click();
  await page.waitForTimeout(900);
  await shot('report-sheet-1-reasons', '[data-testid="report-sheet"]');
  await check('report-sheet reasons', '[data-testid="report-sheet"]');

  await page.getByText('Something else', { exact: true }).click();
  await page.waitForTimeout(600);
  await shot('report-sheet-2-details', '[data-testid="report-sheet"]');
  await check('report-sheet details', '[data-testid="report-sheet"]');

  await page.getByRole('textbox').fill('Selling counterfeit goods');
  await page.getByText('Submit report', { exact: true }).click();
  await page.waitForTimeout(3500);
  await shot('report-sheet-3-sent', '[data-testid="report-sheet"]');
  await check('report-sheet sent', '[data-testid="report-sheet"]');

  await browser.close();
  console.log(failures ? `FAILED: ${failures} text-fit issue(s)` : 'All text-fit checks passed.');
  process.exit(failures ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
