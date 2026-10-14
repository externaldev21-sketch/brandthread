#!/usr/bin/env node
/**
 * Customers > Superfans + "Give early access", on the store-screenshots
 * harness (fake API, signed-in demo seller), 393x852 dark.
 *
 *   node scripts/store-screenshots/superfans-verify.mjs [buildDir]
 *
 * Captures:
 *  01 All tab (unchanged list, new Superfans tab beside All / Top 20)
 *  02 Superfans tab with an upcoming drop ("Give early access")
 *  03 after the tap ("Early access given · <drop>", disabled)
 *  04 Superfans tab with no upcoming drop ("Schedule a drop")
 *  05 Superfans tab for a seller with no orders yet (honest empty state)
 *
 * Like scripts/f4-customers-screenshots.mjs (PR #1009), the screen is opened
 * with `?bt_preview=buyer` so the signed-in demo account's real API path runs
 * and the routes below answer it. Runs the text-fit check on every capture.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './demo-images.mjs';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { DEMO_NOW } from './demo-data.mjs';
import { findTextOverflow } from './checkTextOverflow.mjs';

const BUILD = path.resolve(process.argv[2] ?? DEFAULT_BUILD_DIR);
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/superfans');
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

const ago = (days) => new Date(DEMO_NOW - days * 86_400_000).toISOString();
const C = (id, name, email, orderCount, totalSpentCents, lastDays, extra = {}) => ({
  id, kind: id.startsWith('buyer_') ? 'account' : id.startsWith('guest_') ? 'guest' : 'manual',
  name, email, handle: null, phone: null, tags: [], notes: null, orderCount, totalSpentCents,
  lastOrderAt: orderCount ? ago(lastDays) : null, firstOrderAt: orderCount ? ago(lastDays + 40) : null,
  createdAt: ago(lastDays + 40), customerRowId: null, ...extra,
});
// Same people as PR #1009's capture, so the All tab reads the same.
const CUSTOMERS = [
  C('buyer_u1', 'Maya Chen', '', 6, 84_250, 1, { handle: '@mayachen', tags: ['VIP'] }),
  C('guest_a', 'Jordan Ellis', 'jordan.ellis@gmail.com', 1, 6_800, 2),
  C('buyer_u2', 'Sam Okafor', '', 3, 31_400, 4, { handle: '@samokafor' }),
  C('guest_b', 'Priya Nair', 'priya.n@outlook.com', 2, 15_900, 6),
  C('buyer_u3', 'Leo Martins', '', 9, 126_500, 8, { handle: '@leomartins', tags: ['Wholesale'] }),
  C('guest_c', 'Ava Brooks', 'ava.brooks@icloud.com', 1, 4_500, 11),
  C('buyer_u4', 'Noah Kim', '', 2, 22_000, 15, { handle: '@noahkim' }),
  C('guest_d', 'Zoe Harper', 'zoe@harperstudio.co', 4, 47_300, 21),
  C('c-manual-1', 'Riley Adams', 'riley@adams.com', 0, 0, 0, { tags: ['Pop-up'], createdAt: ago(30) }),
];
/**
 * JS copy of the server rule (api-server lib/sellerCustomers.ts
 * `superfanCount` / `superfans`): ceil(1% of customers with an order),
 * minimum 1; only signed-in buyers fill the slots; spend, then orders.
 */
export function superfanCount(customersWithOrders) {
  if (!Number.isFinite(customersWithOrders) || customersWithOrders < 1) return 0;
  return Math.max(1, Math.ceil(customersWithOrders * 0.01));
}
export function deriveSuperfans(list) {
  const withOrders = list.filter((c) => c.orderCount > 0);
  const n = superfanCount(withOrders.length);
  return withOrders
    .filter((c) => c.kind === 'account')
    .sort((a, b) => b.totalSpentCents - a.totalSpentCents || b.orderCount - a.orderCount
      || (b.lastOrderAt ?? '').localeCompare(a.lastOrderAt ?? '') || a.id.localeCompare(b.id))
    .slice(0, n);
}
// 9 customers, 8 with an order -> 1 superfan: Leo Martins, the top spender.
const SUPERFANS = deriveSuperfans(CUSTOMERS);
const DROP = { id: '7d2a0c1e-0000-4000-8000-000000000001', name: 'Winter Capsule', releaseAt: new Date(DEMO_NOW + 4 * 86_400_000 + 3 * 3_600_000).toISOString(), earlyAccessMinutes: 60 };

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

let problems = 0;
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'hide' });
  const issues = await findTextOverflow(page);
  problems += issues.length;
  console.log(`${name}: text-fit ${issues.length ? 'PROBLEMS ' + JSON.stringify(issues) : 'OK'}`);
}

async function seller(browser, images, origin, { drop = DROP, customers = CUSTOMERS } = {}) {
  const superfans = deriveSuperfans(customers);
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images });
  const state = { granted: false, posts: 0 };
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/customers/superfans/early-access') {
      if (request.method() === 'POST') {
        state.posts++;
        if (!drop) return json(route, { error: 'Schedule a drop first', code: 'NO_UPCOMING_DROP' }, 409);
        const already = state.granted;
        state.granted = true;
        return json(route, { dropId: drop.id, dropName: drop.name, granted: already ? 0 : superfans.length, alreadyHad: already ? superfans.length : 0 });
      }
      return json(route, drop
        ? { drop, superfans: superfans.length, granted: state.granted ? superfans.length : 0, allGranted: state.granted }
        : { drop: null, superfans: superfans.length, granted: 0, allGranted: false });
    }
    if (p === '/api/customers') {
      return json(route, url.searchParams.get('segment') === 'superfans' ? superfans : customers);
    }
    return route.fallback();
  });
  return { context, page, activity, state };
}

async function openCustomers(page, activity, origin, expectText) {
  const target = '/customers?bt_preview=buyer';
  await openScreen(page, activity, origin, 'seller', target);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const retry = page.getByText('Try again', { exact: true }).first();
      await page.getByText(expectText, { exact: true }).first().or(retry).waitFor({ timeout: 12_000 });
      if (await retry.isVisible().catch(() => false)) { await retry.click(); await page.waitForTimeout(1500); }
      await page.getByText(expectText, { exact: true }).first().waitFor({ timeout: 4_000 });
      break;
    } catch (error) {
      if (attempt === 5) {
        await page.screenshot({ path: path.join(WORK_DIR, 'superfans-debug.png') });
        throw error;
      }
      await page.evaluate((u) => { history.pushState(history.state, '', u); dispatchEvent(new PopStateEvent('popstate')); }, target);
    }
  }
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(800);
}

async function superfansTab(page, activity) {
  await page.getByRole('tab', { name: 'Superfans' }).click();
  await page.getByText(/^(Give early access|Schedule a drop|No superfans yet)$/).first().waitFor({ timeout: 10_000 });
  await waitForQuietNetwork(activity, 700, 10_000);
  await page.waitForTimeout(600);
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  console.log(`fixture: ${CUSTOMERS.length} customers, ${CUSTOMERS.filter((c) => c.orderCount > 0).length} with an order -> superfans: ${SUPERFANS.map((c) => c.name).join(', ')}`);
  if (SUPERFANS.length !== 1 || SUPERFANS[0].name !== 'Leo Martins') problems++;
  try {
    {
      const { context, page, activity, state } = await seller(browser, images, server.origin);
      await openCustomers(page, activity, server.origin, 'Leo Martins');
      await shot(page, 'after-393x852-01-all');
      await superfansTab(page, activity);
      await shot(page, 'after-393x852-02-superfans');
      await page.getByRole('button', { name: /Give early access/ }).click();
      await page.getByText(/Early access given/).first().waitFor({ timeout: 8_000 });
      await page.waitForTimeout(500);
      await shot(page, 'after-393x852-03-early-access-given');
      const disabled = await page.getByRole('button', { name: /Early access given/ }).getAttribute('aria-disabled');
      console.log(`grant POSTs=${state.posts} (expect 1), given button aria-disabled=${disabled}`);
      if (state.posts !== 1) problems++;
      await context.close();
    }
    {
      const { context, page, activity } = await seller(browser, images, server.origin, { drop: null });
      await openCustomers(page, activity, server.origin, 'Leo Martins');
      await superfansTab(page, activity);
      await shot(page, 'after-393x852-04-no-upcoming-drop');
      await context.close();
    }
    {
      const { context, page, activity } = await seller(browser, images, server.origin, { customers: [] });
      await openCustomers(page, activity, server.origin, 'No customers yet');
      await superfansTab(page, activity);
      await shot(page, 'after-393x852-05-superfans-empty');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (problems) process.exitCode = 1;
}

run().catch((error) => { console.error(error); process.exit(1); });
