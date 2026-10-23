// Usage: node shots.mjs <buildDir> <outDir> <label>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const H = '/home/user/brandthread/artifacts/mobile/scripts/store-screenshots/';
const { clerkStubScript } = await import(H + 'clerk-stub.mjs');
const { launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork, waitForImages } = await import(H + 'harness.mjs');
const { BUYER_USER, DEMO_NOW, DEMO_TIME_ZONE, localStorageSeed, respond } = await import(H + 'demo-data.mjs');

const [buildDir, outDir, label] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const DEMO_API = 'https://api.brandthread.test';
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
const signedOutStub = clerkStubScript(BUYER_USER)
  .replace('sessions: [session], activeSessions: [session], lastActiveSessionId: session.id', 'sessions: [], activeSessions: [], lastActiveSessionId: null')
  .replace('listener({ client, session, user: clerkUser, organization: null })', 'listener({ client, session: null, user: null, organization: null })')
  .replace('    session,\n    user: clerkUser,\n    client,', '    session: null,\n    user: null,\n    client,')
  .replace('__internal_lastEmittedResources: { client, session, user: clerkUser, organization: null }', '__internal_lastEmittedResources: { client, session: null, user: null, organization: null }');

const { chromium } = await import('/home/user/brandthread/artifacts/mobile/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN });
const { origin, close } = await serveBuild(buildDir);
const result = {};
const { ensureDemoImages } = await import(H + 'demo-images.mjs');
const images = await ensureDemoImages(browser, '/tmp/claude-0/-home-user-brandthread/65d6ab29-e7a4-523d-83a0-a2c64cc00a51/scratchpad/images').catch((e) => { console.error('images', e.message); return {}; });
try {
  // ── Signed out (no bt_preview): every route ──
  const signedOut = [
    ['signed-out-root', '/'],
    ['signed-out-sign-in', '/sign-in'],
    ['signed-out-deeplink-discover', '/discover'],
    ['signed-out-deeplink-feed', '/feed'],
    ['signed-out-deeplink-public-profile', '/u/maya'],
    ['signed-out-deeplink-product', '/buyer-product-detail?productId=demo-product-1'],
    ['signed-out-deeplink-seller-profile', '/seller-profile?sellerId=demo-seller'],
    ['signed-out-deeplink-inbox', '/inbox'],
  ];
  for (const [name, target] of signedOut) {
    const ctx = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'reduce' });
    await ctx.clock.install({ time: DEMO_NOW });
    await ctx.addInitScript(signedOutStub);
    const seed = Object.fromEntries(Object.entries(localStorageSeed('buyer')).filter(([k]) => k.startsWith('bt:cookie') || k.startsWith('bt:feature') || k.includes('app-theme')));
    // Second visit: splash already seen, so a deep link goes straight to sign-in.
    if (name !== 'signed-out-root') seed.splash_seen = 'true';
    await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, seed);
    await ctx.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.origin === DEMO_API) {
        const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const body = respond({ method: route.request().method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
        return route.fulfill({ status: body === undefined ? 404 : 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body ?? {}) });
      }
      return route.abort();
    });
    const page = await ctx.newPage();
    await page.goto(`${origin}${target}`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(name === 'signed-out-root' ? 9000 : 6000);
    const testIds = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).filter((t) => /welcome|guest|sign-in|create|password/i.test(t)));
    const text = await page.evaluate(() => document.body.innerText.slice(0, 400));
    result[name] = { requested: target, landed: new URL(page.url()).pathname + new URL(page.url()).search, testIds, hasBrowseAsGuest: text.includes('Browse as a guest') };
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    await ctx.close();
  }

  // ── bt_preview (signed-in demo account): must be unchanged ──
  const preview = [
    ['preview-buyer-discover', 'buyer', '/discover'],
    ['preview-buyer-feed', 'buyer', '/feed'],
    ['preview-buyer-profile', 'buyer', '/profile'],
    ['preview-seller-dashboard', 'seller', null],
    ['preview-seller-profile', 'seller', '/profile'],
  ];
  for (const [name, role, target] of preview) {
    const { context, page, activity } = await openContext(browser, { device, role, origin, images });
    await page.goto(`${origin}${target ?? '/'}?bt_preview=${role}`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20000 });
    await waitForQuietNetwork(activity, 800, 15000);
    await page.waitForTimeout(3500);
    await waitForImages(page);
    result[name] = { landed: new URL(page.url()).pathname + new URL(page.url()).search };
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    await context.close();
  }
} finally {
  await browser.close();
  close();
}
writeFileSync(path.join(outDir, `results-${label}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
