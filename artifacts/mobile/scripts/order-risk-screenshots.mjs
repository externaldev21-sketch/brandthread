#!/usr/bin/env node
/**
 * Seller order risk badge (Stripe Radar flags) at 393x852 on the production
 * web build (store-screenshots harness, signed-in demo seller Northline).
 * The fake API answers GET /api/orders/:id with the exact shape the route
 * returns, including the new `risk` object. Nothing is seeded into the app.
 *
 *   node scripts/order-risk-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-assets/radar/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_NOW, IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/radar');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DAY = 86_400_000;
const now = new Date(DEMO_NOW).getTime();
const iso = (ms) => new Date(ms).toISOString();
const ORDER_ID = '6f1c2b8e-4b7a-4c1e-9a55-2d7f3c9e1a42';

const RISKS = {
  none: null,
  elevated: {
    level: 'elevated', score: 68, reviewed: false,
    flags: [
      { code: 'radar_elevated', label: 'Stripe rated this payment elevated risk', severity: 'medium' },
      { code: 'cvc_failed', label: 'Card security code did not match', severity: 'medium' },
      { code: 'country_mismatch', label: 'Billing country (CA) differs from shipping country (US)', severity: 'medium' },
      { code: 'first_time_buyer', label: 'First order from this buyer', severity: 'info' },
    ],
  },
  highest: {
    level: 'highest', score: 91, reviewed: false,
    flags: [
      { code: 'radar_highest', label: 'Stripe rated this payment highest risk', severity: 'high' },
      { code: 'stripe_review_open', label: 'Stripe has this payment under review', severity: 'medium' },
      { code: 'postal_code_failed', label: 'Billing postal code did not match the card', severity: 'medium' },
      { code: 'high_value', label: 'High-value order', severity: 'info' },
    ],
  },
};

let STATUS = 'pending';
const sellerOrder = (risk) => ({
  id: ORDER_ID, orderNumber: 'BT-00042', ownerId: 'seller', buyerId: BUYER_USER.id, status: STATUS,
  totalCents: 16000, subtotalCents: 14800, shippingCents: 1200, paidAt: iso(now - 3 * 60 * 60_000),
  shippingAddress: { name: 'Jordan Reyes', street: '1120 NW Everett Street', city: 'Portland', state: 'OR', zip: '97209', country: 'US' },
  createdAt: iso(now - 3 * 60 * 60_000), updatedAt: iso(now - 3 * 60 * 60_000),
  customer: { id: BUYER_USER.id, name: 'Jordan Reyes', email: 'jordan@example.com' },
  items: [{ id: 'i1', productName: 'Ember Heavyweight Hoodie', variantLabel: 'Charcoal / M', quantity: 1, priceCents: 14800, imageUrl: `${IMAGE_HOST}/hoodie-ember.jpg` }],
  shopifyFulfillment: null, risk,
});

async function open(browser, images, origin, risk) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await context.route(`${API}/**`, (route) => {
    const req = route.request();
    const headers = {
      'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === `/api/orders/${ORDER_ID}`) return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(sellerOrder(risk)) });
    if (p === '/api/returns') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '[]' });
    return route.fallback();
  });
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'seller', `/order-detail?id=${ORDER_ID}`);
    try { await page.getByText('BT-00042').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity).catch(() => {});
  await waitForImages(page).catch(() => {});
  await page.waitForTimeout(800);
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  ok ${name}`);
}


/** Flags text clipped by its own box or by an ancestor, and text touching its container edge. */
async function audit(page, label) {
  const issues = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('div, span')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const text = el.textContent.trim().slice(0, 40);
      if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped: "${text}" ${el.scrollWidth}>${el.clientWidth}`);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) out.push(`ellipsis: "${text}"`);
      let p = el.parentElement;
      while (p && p !== document.body) {
        const pr = p.getBoundingClientRect();
        const pcs = getComputedStyle(p);
        if ((pcs.overflowX === 'hidden' || pcs.overflowX === 'clip') && pr.width > 0 && (r.left < pr.left - 1 || r.right > pr.right + 1) && !p.matches('[data-testid]')) {
          out.push(`overflows parent: "${text}"`); break;
        }
        p = p.parentElement;
      }
      if (r.right > innerWidth + 1 && !el.closest('[role=tablist]')) {
        const scroller = el.closest('div[style*="overflow-x"], div[class*="scroll"]');
        if (!scroller) out.push(`off-screen: "${text}" right=${Math.round(r.right)}`);
      }
    }
    return [...new Set(out)];
  });
  console.log(`  audit [${label}]: ${issues.length ? issues.join(' | ') : 'clean'}`);
  return issues;
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const status of ['pending', 'processing']) {
      STATUS = status;
      for (const kind of ['none', 'elevated', 'highest']) {
        const { context, page } = await open(browser, images, server.origin, RISKS[kind]);
        const tag = `${status}-${kind}`;
        const badge = await page.getByTestId('order-risk-badge').count();
        await audit(page, tag);
        if (status === 'pending') {
          await shot(page, `${kind === 'none' ? '01-after-no-risk' : kind === 'elevated' ? '02-badge-elevated' : '04-badge-highest'}`);
          if (badge) {
            await page.getByTestId('order-risk-badge').click();
            await page.getByTestId('order-risk-panel').waitFor({ timeout: 5_000 });
            await audit(page, `${tag}-open`);
            await shot(page, kind === 'elevated' ? '03-explanation-elevated' : '05-explanation-highest');
          }
        } else if (kind === 'none') {
          await shot(page, '06-processing-actions');
        }
        if (kind === 'none') {
          // Zoomed crops (3x) of the header+tabs, step tracker and action buttons.
          await page.evaluate(() => { const sc = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible'); if (sc) sc.scrollTop = 0; });
          await page.screenshot({ path: path.join(OUT, `zoom-${status}-header-tabs.png`), clip: { x: 0, y: 0, width: 393, height: 200 } });
          const y = await page.getByText('Actions', { exact: true }).first().evaluate((el) => el.getBoundingClientRect().top);
          await page.screenshot({ path: path.join(OUT, `zoom-${status}-actions.png`), clip: { x: 0, y: Math.max(0, y - 10), width: 393, height: Math.min(300, 852 - y) } });
          const t = await page.getByText('Placed', { exact: true }).first().evaluate((el) => el.getBoundingClientRect().top);
          await page.screenshot({ path: path.join(OUT, `zoom-${status}-steps.png`), clip: { x: 0, y: Math.max(0, t - 50), width: 393, height: 90 } });
        }
        await context.close();
      }
    }
  } finally {
    server.close();
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
