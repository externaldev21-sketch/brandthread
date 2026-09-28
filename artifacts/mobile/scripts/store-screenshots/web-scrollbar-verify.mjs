#!/usr/bin/env node
/**
 * Live verification that NO screen shows a visible scrollbar on web (Dev's
 * rule: no white bar on the right edge, ever, vertical or horizontal) —
 * after lib/webTextRendering.ts's injectWebScrollbarHideStyles() fix. Not
 * part of the store screenshot pipeline.
 *
 * For each screen: waits for content, then scans the DOM for every element
 * whose own box reserves visual space for a scrollbar — `offsetWidth >
 * clientWidth` (vertical) or `offsetHeight > clientHeight` (horizontal) on
 * an element whose computed overflow is auto/scroll. Our CSS forces
 * `scrollbar-width: none` / `::-webkit-scrollbar { display: none }`, so
 * this gap should be exactly 0 everywhere once the fix is live; a gap > 0
 * is the literal "white bar" Dev is describing.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/web-scrollbar-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/web-scrollbar-fix'));
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
      id: 'cv-scroll-1', type: 'buyer_to_seller',
      participants: [
        { userId: 'seller-scroll', name: 'Orison', handle: '@orison', initials: 'OR', color: '#3D3D42', accountType: 'seller' },
        { userId: 'demo-buyer', name: 'Jordan Reyes', handle: '@jordanreyes', initials: 'JR', color: '#8A8A93', accountType: 'buyer' },
      ],
      lastMessage: 'Hey! Loving the new drop, any restock plans for the rust jacket in L? Would love to grab one before it sells out again.',
      lastMessageTs: DEMO_NOW - 5 * MIN, unreadCount: 0,
      isFriendshipActive: true, isArchived: false, isRequest: false,
      updatedAt: new Date(DEMO_NOW - 5 * MIN).toISOString(),
    };
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify([conv]) });
  });
}

/** Every element that reserves visible space for a scrollbar. */
async function scrollbarAudit(page) {
  return page.evaluate(() => {
    const offenders = [];
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      const scrollableY = /(auto|scroll)/.test(style.overflowY);
      const scrollableX = /(auto|scroll)/.test(style.overflowX);
      if (!scrollableY && !scrollableX) continue;
      const vGap = el.offsetWidth - el.clientWidth;
      const hGap = el.offsetHeight - el.clientHeight;
      if (vGap > 0 || hGap > 0) {
        offenders.push({
          tag: el.tagName, id: el.id || undefined, class: (el.className || '').toString().slice(0, 60),
          vGap, hGap,
        });
      }
    }
    return offenders;
  });
}

async function checkScreen(page, activity, settle, shot, name) {
  await settle();
  await shot(name);
  const offenders = await scrollbarAudit(page);
  return offenders;
}

async function run(browser, images, origin) {
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const results = {};

  // ── Buyer ──
  {
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
    await installChatFakeApi(context, origin);
    const shot = (name) => page.screenshot({ path: path.join(OUT, `buyer-${name}.png`) });
    const settle = async (ms = 900) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };

    for (const [key, target] of [
      ['feed', '/(buyer)'],
      ['discover', '/(buyer)/discover'],
      ['search', '/buyer-search'],
      ['inbox', '/(buyer)/inbox'],
      ['activity', '/activity-center'],
      ['profile', '/(buyer)/profile'],
      ['settings-menu', '/buyer-settings-menu'],
      ['cart', '/(buyer)/cart'],
      ['checkout', '/buyer-checkout'],
      ['product-page', '/buyer-product-detail?productId=prod_nl_jacket_rust'],
    ]) {
      const readyText = key === 'discover' ? 'For You' : null;
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'buyer', target);
        try {
          if (readyText) await page.getByText(readyText, { exact: true }).first().waitFor({ timeout: 15000 });
          else await page.waitForSelector('body', { timeout: 15000 });
          break;
        } catch (e) { if (attempt >= 4) throw e; }
      }
      results[key] = await checkScreen(page, activity, settle, shot, key);
    }

    // Discover — People / Brands tabs (re-navigate fresh rather than reusing
    // whatever screen the loop above finished on).
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, 'buyer', '/(buyer)/discover');
      try { await page.getByText('For You', { exact: true }).first().waitFor({ timeout: 15000 }); break; } catch (e) { if (attempt >= 4) throw e; }
    }
    await settle();
    await page.getByText('People', { exact: true }).first().click();
    await settle(1200);
    results['discover-people'] = await checkScreen(page, activity, settle, shot, 'discover-people');
    // Discover — Brands tab
    await page.getByText('Brands', { exact: true }).first().click();
    await settle(1200);
    results['discover-brands'] = await checkScreen(page, activity, settle, shot, 'discover-brands');

    // Chat composer (real conversation, fake API)
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, 'buyer', '/buyer-conversation?id=cv-scroll-1');
      try { await page.waitForSelector('textarea', { timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    results['chat'] = await checkScreen(page, activity, settle, shot, 'chat');

    // Product sheet (from feed) — a bottom sheet with its own scroll area.
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, 'buyer', '/(buyer)');
      try { await page.waitForSelector('body', { timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    await settle(1000);
    const shopBtn = page.getByText(/Shop|View product/i).first();
    await shopBtn.click().catch(() => {});
    results['product-sheet'] = await checkScreen(page, activity, settle, shot, 'product-sheet');

    await context.close();
  }

  // ── Seller ──
  {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    const shot = (name) => page.screenshot({ path: path.join(OUT, `seller-${name}.png`) });
    const settle = async (ms = 900) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };

    for (const [key, target] of [
      ['dashboard', '/(tabs)'],
      ['products', '/(tabs)/products'],
      ['orders', '/(tabs)/orders'],
      ['add-product', '/add-product'],
    ]) {
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'seller', target);
        try { await page.waitForSelector('body', { timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      results[`seller-${key}`] = await checkScreen(page, activity, settle, shot, key);
    }

    await context.close();
  }

  return results;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const results = await run(browser, images, origin);
    console.log(JSON.stringify(results, null, 2));
    const offenderScreens = Object.entries(results).filter(([, v]) => v.length > 0);
    if (offenderScreens.length) {
      console.error('FAIL — visible scrollbar on:', offenderScreens.map(([k]) => k).join(', '));
      process.exit(1);
    }
    console.log(`OK — zero visible scrollbars across ${Object.keys(results).length} screens.`);
  } finally {
    await close();
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
