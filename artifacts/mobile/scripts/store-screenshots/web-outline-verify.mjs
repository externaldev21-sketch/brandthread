#!/usr/bin/env node
/**
 * Live verification that the browser's default focus outline (amber/orange
 * on this sandbox's Chromium, matching Dev's report) is gone from every
 * TextInput across search, chat composer, and checkout — after
 * lib/webTextRendering.ts's injectWebFocusOutlineStyles() fix. Not part of
 * the store screenshot pipeline.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/web-outline-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/web-outline-fix'));
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
async function installChatFakeApi(context, origin) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  await context.route((url) => url.origin === 'https://api.brandthread.test' && norm(url.pathname) === '/api/conversations', async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const conv = {
      id: 'cv-outline-1', type: 'buyer_to_seller',
      participants: [
        { userId: 'seller-outline', name: 'Orison', handle: '@orison', initials: 'OR', color: '#3D3D42', accountType: 'seller' },
        { userId: 'demo-buyer', name: 'Jordan Reyes', handle: '@jordanreyes', initials: 'JR', color: '#8A8A93', accountType: 'buyer' },
      ],
      lastMessage: 'Hey!', lastMessageTs: DEMO_NOW - 5 * MIN, unreadCount: 0,
      isFriendshipActive: true, isArchived: false, isRequest: false,
      updatedAt: new Date(DEMO_NOW - 5 * MIN).toISOString(),
    };
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify([conv]) });
  });
}

/** Computed outline on the currently-focused element. */
async function focusOutlineInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const s = getComputedStyle(el);
    return { tag: el.tagName, outlineStyle: s.outlineStyle, outlineColor: s.outlineColor, boxShadow: s.boxShadow };
  });
}

async function run(browser, images, origin) {
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  await installChatFakeApi(context, origin);
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
  const settle = async (ms = 800) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
  const results = {};

  // 1. Search
  for (let attempt = 1; ; attempt += 1) {
    await openScreen(page, activity, origin, 'buyer', '/buyer-search');
    try { await page.waitForSelector('input, textarea', { timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await settle();
  await page.locator('input, textarea').first().click();
  await page.waitForTimeout(250);
  await shot('01-search-focused.png');
  results.search = await focusOutlineInfo(page);

  // 2. Chat composer
  for (let attempt = 1; ; attempt += 1) {
    await openScreen(page, activity, origin, 'buyer', '/buyer-conversation?id=cv-outline-1');
    try { await page.waitForSelector('textarea', { timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await settle();
  await page.locator('textarea').last().click();
  await page.waitForTimeout(250);
  await shot('02-chat-composer-focused.png');
  results.chatComposer = await focusOutlineInfo(page);

  // 3. Cart (fields: promo code / gift note, whichever renders)
  for (let attempt = 1; ; attempt += 1) {
    await openScreen(page, activity, origin, 'buyer', '/(buyer)/cart');
    try { await page.waitForSelector('body', { timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await settle(1200);
  await shot('03-cart.png');

  // 4. Checkout — contact/address fields.
  for (let attempt = 1; ; attempt += 1) {
    await openScreen(page, activity, origin, 'buyer', '/buyer-checkout');
    try { await page.waitForSelector('input, textarea', { timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await settle(1200);
  const checkoutInput = page.locator('input, textarea').first();
  await checkoutInput.click();
  await page.waitForTimeout(250);
  await shot('04-checkout-focused.png');
  results.checkout = await focusOutlineInfo(page);

  await context.close();
  return results;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const results = await run(browser, images, origin);
    console.log(JSON.stringify(results, null, 2));
    const offenders = Object.entries(results).filter(([, v]) => v && v.outlineStyle !== 'none');
    if (offenders.length) {
      console.error('FAIL — non-none outline on:', offenders.map(([k]) => k).join(', '));
      process.exit(1);
    }
    console.log('OK — every checked field has outlineStyle: none on focus.');
  } finally {
    await close();
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
