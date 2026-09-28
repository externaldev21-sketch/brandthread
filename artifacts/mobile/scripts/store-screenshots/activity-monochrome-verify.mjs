#!/usr/bin/env node
/**
 * One-off live verification for the Activity monochrome sweep (item 80) —
 * not part of the store screenshot pipeline. Production web export + a fake
 * API serving the exact rows previously flagged (Thread Cash "+$5.00", like
 * heart badge, order titles stored WITH colour emoji), then checks every
 * rendered colour on the Activity screen is a neutral gray and that no
 * colour emoji reaches the page.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/activity-monochrome-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/activity-monochrome'));
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();
const person = (id, name) => ({
  actorId: id, actorName: name, actorHandle: `@${id}`,
  actorInitials: name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), actorColor: '#3F3F46',
});
const THUMB = `${IMAGE_HOST}/hoodie-bone.jpg`;
const base = { isRead: true, isMuted: false };
const SOCIAL = [
  { ...base, id: 'cash', category: 'social', type: 'thread_cash_received', title: 'Tia Cash sent you Thread Cash', body: '$5.00 · tap to view', ...person('u-tia', 'Tia Cash'), targetId: 'tr1', targetType: 'thread_cash_transfer', createdAt: iso(5 * MIN) },
  { ...base, id: 'like', category: 'social', type: 'post_like', title: 'Lina Liker liked your post', body: '', ...person('u-lina', 'Lina Liker'), targetId: 'p1', targetType: 'post', targetImageUrl: THUMB, createdAt: iso(9 * MIN) },
  { ...base, id: 'slike', category: 'social', type: 'story_like', title: 'Stella Story liked your story', body: '', ...person('u-stella', 'Stella Story'), targetId: 's1', targetType: 'story', targetImageUrl: THUMB, createdAt: iso(12 * MIN) },
];
// Stored exactly as the old server copy wrote them — emoji included.
const BUYER_ORDERS = [
  { ...base, id: 'ship', category: 'orders', type: 'order_shipped', title: 'Your order has shipped! 🚚', body: 'Order #BT-00038 is on its way.', targetId: 'o38', targetType: 'order', createdAt: iso(40 * MIN) },
  { ...base, id: 'ofd', category: 'orders', type: 'order_out_for_delivery', title: 'Your package is arriving today 🚚', body: 'Order #BT-00035 is out for delivery today.', targetId: 'o35', targetType: 'order', createdAt: iso(3 * 60 * MIN) },
  { ...base, id: 'del', category: 'orders', type: 'order_delivered', title: 'Your order was delivered! 📦', body: 'Order #BT-00031 has been delivered.', targetId: 'o31', targetType: 'order', createdAt: iso(26 * 60 * MIN) },
];
const SELLER_ORDERS = [
  { ...base, id: 'new', category: 'orders', type: 'new_order_received', title: 'New order! 🛍️', body: 'Order #BT-00042 for $89.00 is ready to review.', targetId: 'o42', targetType: 'order', targetImageUrl: THUMB, createdAt: iso(3 * MIN) },
];

async function installFakeApi(context, feed) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  const owns = (url) => url.origin === 'https://api.brandthread.test' && /^\/api\/buyer\/notifications(\/.*)?$/.test(norm(url.pathname));
  await context.route(owns, async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const p = norm(new URL(req.url()).pathname);
    if (p === '/api/buyer/notifications' && req.method() === 'GET') return json(feed);
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 0, latestId: feed[0].id });
    return json({ ok: true });
  });
}

/** Every non-neutral text/glyph colour inside the Activity list (excluding images). */
async function colourAudit(page) {
  return page.evaluate(() => {
    const neutral = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return true;
      const [r, g, b, a = 1] = m[1].split(',').map((v) => parseFloat(v));
      if (a === 0) return true;
      return Math.max(r, g, b) - Math.min(r, g, b) <= 12; // gray within a hair
    };
    const offenders = [];
    for (const el of document.querySelectorAll('div, span')) {
      if (!el.childNodes.length) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight || rect.width === 0) continue;
      const color = getComputedStyle(el).color;
      if (!neutral(color)) offenders.push({ text: el.textContent.trim().slice(0, 40), color });
    }
    const text = document.body.innerText;
    const emoji = text.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{2712}\u{2715}-\u{27BF}]/gu) ?? [];
    const images = [...document.images].filter((i) => i.getBoundingClientRect().width > 0).map((i) => i.currentSrc.split('/').pop());
    return { offenders, emoji, images };
  });
}

async function run(browser, images, origin, role) {
  const feed = [...SOCIAL, ...(role === 'seller' ? SELLER_ORDERS : BUYER_ORDERS)];
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  await installFakeApi(context, feed);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${role}-${name}.png`) });
  const settle = async (ms = 600) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
  for (let attempt = 1; ; attempt += 1) {
    await openScreen(page, activity, origin, role, '/activity-center');
    try { await page.getByText('Tia Cash').first().waitFor({ timeout: 15_000 }); break; } catch (error) { if (attempt >= 3) throw error; }
  }
  await settle(900);
  const results = {};

  await shot('01-all-thread-cash-and-likes');
  results.all = await colourAudit(page);
  results.cashAmountColor = await page.getByText('+$5.00').evaluate((el) => getComputedStyle(el).color);

  await page.getByRole('button', { name: 'Orders', exact: true }).first().click();
  await settle();
  await shot('02-orders-titles');
  results.orders = await colourAudit(page);
  results.orderTitles = (await page.locator('body').innerText()).split('\n')
    .filter((line) => /shipped|delivered|arriving|New order/.test(line));

  await context.close();
  return results;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const roles = process.env.VERIFY_ROLES ? process.env.VERIFY_ROLES.split(',') : ['buyer', 'seller'];
    for (const role of roles) {
      const results = await run(browser, images, origin, role);
      console.log(`\n[${role}]`, JSON.stringify(results, null, 2));
    }
  } finally {
    await close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
