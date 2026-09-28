#!/usr/bin/env node
/**
 * One-off verification script for the compact tab-bar work (not part of the
 * store screenshot pipeline) — captures the required screenshots and a
 * transition recording using the same demo harness as the store screenshots.
 *
 * Usage: node scripts/store-screenshots/tabbar-compact-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.tabbar-verify'));
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { id: '375x667', width: 375, height: 667 },
  { id: '390x844', width: 390, height: 844 },
  { id: '430x932', width: 430, height: 932 },
];

async function barMetrics(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="buyer-bottom-tab-bar"]');
    if (!el) return null;
    // Children in DOM order: [0] TabBarGlassZone, [1] capsule, [2] Profile circle.
    const capsule = el.children[1];
    const profile = document.querySelector('[data-testid="buyer-tab-profile"]');
    const barRect = el.getBoundingClientRect();
    return {
      barTop: barRect.top,
      capsuleRect: capsule ? capsule.getBoundingClientRect() : null,
      profileRect: profile ? profile.getBoundingClientRect() : null,
    };
  });
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);

  try {
    for (const vp of VIEWPORTS) {
      const device = { viewport: { width: vp.width, height: vp.height }, scale: 2, isMobile: true, userAgent: undefined };
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });

      // ── Home (compact) ──────────────────────────────────────────────
      await openScreen(page, activity, origin, 'buyer', '/(buyer)');
      await waitForQuietNetwork(activity, 600, 8000);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `home-compact-${vp.id}.png`) });
      const home = await barMetrics(page);

      // ── Profile (regular) ───────────────────────────────────────────
      await openScreen(page, activity, origin, 'buyer', '/profile');
      await waitForQuietNetwork(activity, 600, 8000);
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, `profile-regular-${vp.id}.png`) });
      const profile = await barMetrics(page);

      console.log(`\n[${vp.id}]`);
      console.log('  home capsule   :', home?.capsuleRect, 'barTop:', home?.barTop, 'profileCircle:', home?.profileRect);
      console.log('  profile capsule:', profile?.capsuleRect, 'barTop:', profile?.barTop, 'profileCircle:', profile?.profileRect);

      await context.close();
    }

    // ── Transition recording: Home -> Discover -> Home -> Profile -> Home ──
    {
      const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
      const recCtx = await browser.newContext({
        viewport: device.viewport,
        deviceScaleFactor: device.scale,
        colorScheme: 'dark',
        reducedMotion: 'no-preference',
        recordVideo: { dir: OUT, size: device.viewport },
      });
      const { clerkStubScript } = await import('./clerk-stub.mjs');
      const demoData = await import('./demo-data.mjs');
      await recCtx.clock.install({ time: demoData.DEMO_NOW });
      await recCtx.addInitScript(clerkStubScript(demoData.BUYER_USER));
      await recCtx.addInitScript((seed) => {
        if (sessionStorage.getItem('bt:screenshot-seeded')) return;
        for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
        sessionStorage.setItem('bt:screenshot-seeded', '1');
      }, demoData.localStorageSeed('buyer', {}));
      const recActivity = { lastApiAt: Date.now() };
      const DEMO_API = 'https://api.brandthread.test';
      await recCtx.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === origin) return route.continue();
        if (url.origin === demoData.IMAGE_HOST) {
          const name = url.pathname.split('/').pop().replace(/\.jpg$/, '');
          const file = images[name];
          if (file) {
            const { readFileSync } = await import('node:fs');
            return route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(file) });
          }
          return route.fulfill({ status: 404, body: '' });
        }
        if (url.origin === DEMO_API) {
          const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
          recActivity.lastApiAt = Date.now();
          const body = demoData.respond({ method: request.method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
          if (body === undefined) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{}' });
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
        }
        return route.abort();
      });
      const recPage = await recCtx.newPage();
      await openScreen(recPage, recActivity, origin, 'buyer', '/(buyer)');
      await waitForQuietNetwork(recActivity, 600, 8000);
      await recPage.waitForTimeout(800);

      await recPage.getByTestId('buyer-tab-discover').click();
      await recPage.waitForTimeout(900);
      await recPage.getByTestId('buyer-tab-index').click();
      await recPage.waitForTimeout(900);
      await recPage.getByTestId('buyer-tab-profile').click();
      await recPage.waitForTimeout(900);
      await recPage.getByTestId('buyer-tab-index').click();
      await recPage.waitForTimeout(900);

      const videoPath = await recPage.video()?.path();
      await recCtx.close();
      console.log('\nRecorded transition video at', videoPath);
    }

    // ── Reduced motion: confirm an instant switch ───────────────────────
    {
      const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
      const context = await browser.newContext({
        viewport: device.viewport,
        deviceScaleFactor: device.scale,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      });
      const { clerkStubScript } = await import('./clerk-stub.mjs');
      const demoData = await import('./demo-data.mjs');
      await context.clock.install({ time: demoData.DEMO_NOW });
      await context.addInitScript(clerkStubScript(demoData.BUYER_USER));
      await context.addInitScript((seed) => {
        if (sessionStorage.getItem('bt:screenshot-seeded')) return;
        for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
        sessionStorage.setItem('bt:screenshot-seeded', '1');
      }, demoData.localStorageSeed('buyer', {}));
      const activity = { lastApiAt: Date.now() };
      const DEMO_API = 'https://api.brandthread.test';
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === origin) return route.continue();
        if (url.origin === demoData.IMAGE_HOST) {
          const name = url.pathname.split('/').pop().replace(/\.jpg$/, '');
          const file = images[name];
          if (file) {
            const { readFileSync } = await import('node:fs');
            return route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(file) });
          }
          return route.fulfill({ status: 404, body: '' });
        }
        if (url.origin === DEMO_API) {
          const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
          activity.lastApiAt = Date.now();
          const body = demoData.respond({ method: request.method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
          if (body === undefined) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{}' });
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
        }
        return route.abort();
      });
      const page = await context.newPage();
      await openScreen(page, activity, origin, 'buyer', '/(buyer)');
      await waitForQuietNetwork(activity, 600, 8000);
      await page.waitForTimeout(500);
      const before = await barMetrics(page);
      await page.getByTestId('buyer-tab-profile').click();
      // No wait at all: under reduced motion the switch should already be
      // at its final (regular) size on the very next frame.
      await page.waitForTimeout(32);
      const after = await barMetrics(page);
      console.log('\n[reduced motion] before (compact) capsule width:', before?.capsuleRect?.width);
      console.log('[reduced motion] one frame after tapping Profile, capsule width:', after?.capsuleRect?.width);
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
