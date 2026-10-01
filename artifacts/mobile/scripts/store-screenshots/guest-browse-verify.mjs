#!/usr/bin/env node
/**
 * Guest browsing + promo-toggle verification at 393x852 (Guideline 5.1.1(v),
 * 4.5.4). Uses the preview build (see harness.mjs buildPreviewWeb) with a
 * SIGNED-OUT Clerk stub and the demo API. Records every API request the app
 * makes while signed out and fails if any is a protected/paid endpoint or
 * carries an Authorization header. Also runs a text-fit check on each screen.
 *
 * Usage: node scripts/store-screenshots/guest-browse-verify.mjs [outDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clerkStubScript } from './clerk-stub.mjs';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './harness.mjs';
import { BUYER_USER, DEMO_NOW, DEMO_TIME_ZONE, IMAGE_HOST, localStorageSeed, respond } from './demo-data.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/claude-review-ready-push-guest'));
mkdirSync(OUT, { recursive: true });
const DEMO_API = 'https://api.brandthread.test';
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

// Same prefixes as lib/guestApiPolicy.ts (kept literal so this script has no TS import).
const PROTECTED = [
  'ai', 'logo', 'mockup', 'photography', 'bg-removal', 'lifestyle', 'techpack', 'design-studio', 'store/ai',
  'brandthread-agent', 'meta-ads', 'ad-campaigns', 'boosts', 'conversations', 'notifications', 'notification-prefs',
  'push', 'buyer/notifications', 'buyer/payment-methods', 'buyer/saved', 'buyer/collections', 'buyer/recently-viewed',
  'buyer/cart', 'buyer/checkout/payment-intent', 'feed/for-you', 'feed/events', 'loyalty', 'thread-cash',
];
const isProtected = (p) => {
  const n = p.replace(/^\/api(\/v\d+)?\/?/, '');
  return PROTECTED.some((x) => n === x || n.startsWith(`${x}/`));
};

function signedOutStub() {
  return clerkStubScript(BUYER_USER)
    .replace('sessions: [session], activeSessions: [session], lastActiveSessionId: session.id', 'sessions: [], activeSessions: [], lastActiveSessionId: null')
    .replace('listener({ client, session, user: clerkUser, organization: null })', 'listener({ client, session: null, user: null, organization: null })')
    .replace('    session,\n    user: clerkUser,\n    client,', '    session: null,\n    user: null,\n    client,')
    .replace('__internal_lastEmittedResources: { client, session, user: clerkUser, organization: null }', '__internal_lastEmittedResources: { client, session: null, user: null, organization: null }');
}

/** Flags text that is clipped/ellipsised or overflows its parent box. */
async function textFit(page) {
  return page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!el.childNodes.length) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const clipped = el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible';
      const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      let p = el.parentElement;
      while (p && p !== document.body && getComputedStyle(p).display === 'contents') p = p.parentElement;
      const pr = p?.getBoundingClientRect();
      const overflowsParent = pr && pr.width > 0 && (r.left < pr.left - 1 || r.right > pr.right + 1) && getComputedStyle(p).overflow !== 'visible';
      if (clipped || ellipsis || overflowsParent) bad.push(`${el.textContent.trim().slice(0, 40)} [${Math.round(r.width)}x${Math.round(r.height)}]`);
    }
    return bad;
  });
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const report = { requests: [], violations: [], textFit: {}, steps: [] };
  try {
    // ── Part 1: signed-out guest ────────────────────────────────────────────
    const context = await browser.newContext({
      viewport: device.viewport, deviceScaleFactor: device.scale, isMobile: true, hasTouch: true,
      locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'reduce',
    });
    await context.clock.install({ time: DEMO_NOW });
    await context.addInitScript(signedOutStub());
    await context.addInitScript((seed) => { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); }, {
      ...Object.fromEntries(Object.entries(localStorageSeed('buyer')).filter(([k]) => k.startsWith('bt:cookie') || k.startsWith('bt:feature') || k.includes('app-theme'))),
    });
    let lastApi = Date.now();
    await context.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin === origin) return route.continue();
      if (url.origin === IMAGE_HOST) {
        const name = url.pathname.split('/').pop().replace(/\.jpg$/, '');
        return images[name] ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(images[name]) }) : route.fulfill({ status: 404, body: '' });
      }
      if (url.origin === DEMO_API) {
        const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        lastApi = Date.now();
        const hasAuth = !!req.headers()['authorization'];
        report.requests.push(`${req.method()} ${url.pathname}${hasAuth ? ' [AUTH]' : ''}`);
        if (isProtected(url.pathname) || hasAuth) report.violations.push(`${req.method()} ${url.pathname}${hasAuth ? ' (Authorization header sent while signed out)' : ''}`);
        const body = respond({ method: req.method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
        if (body === undefined) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED"}}' });
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
      }
      return route.abort();
    });
    const page = await context.newPage();
    const quiet = async (ms = 1200) => { const end = Date.now() + 10000; while (Date.now() < end && Date.now() - lastApi < ms) await page.waitForTimeout(100); await page.waitForTimeout(500); await waitForImages(page, 6000); };
    const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); report.textFit[name] = await textFit(page); report.steps.push(`${name}: ${new URL(page.url()).pathname}`); };

    await page.goto(`${origin}/`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20000 });
    await page.getByTestId('onboarding-welcome-browse-guest').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot('01-guest-welcome');
    await page.getByTestId('onboarding-welcome-browse-guest').click();
    await page.waitForTimeout(1500); await quiet();
    await shot('02-guest-discover');

    const products = respond({ method: 'GET', path: '/api/public/products', query: new URLSearchParams(), role: 'buyer', options: {} });
    const list = Array.isArray(products) ? products : products?.products ?? [];
    const pid = list[0]?.id;
    if (pid) {
      await page.evaluate((u) => { history.pushState(history.state, '', u); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, `/buyer-product-detail?id=${pid}`);
      await page.waitForTimeout(1500); await quiet();
      await shot('03-guest-product');
    }
    await page.evaluate(() => { history.pushState(history.state, '', '/'); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { history.pushState(history.state, '', '/(buyer)/'); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); });
    await page.waitForTimeout(1500); await quiet();
    await shot('04-guest-home-feed');
    await page.evaluate(() => { history.pushState(history.state, '', '/sign-in?returnTo=%2F(buyer)%2Fdiscover'); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); });
    await page.waitForTimeout(1500);
    await shot('05-sign-in-with-guest-link');
    await context.close();

    // ── Part 2: signed-in preview — Notifications settings promo toggle ───────
    const { context: ctx2, page: p2, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    await openScreen(p2, activity, origin, 'seller', '/notifications-settings');
    await waitForQuietNetwork(activity, 800, 10000); await p2.waitForTimeout(800);
    await p2.screenshot({ path: path.join(OUT, '06-notifications-settings-promo.png') });
    report.textFit['06-notifications-settings-promo'] = await textFit(p2);
    await p2.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight; });
    await p2.waitForTimeout(600);
    await p2.screenshot({ path: path.join(OUT, '07-notifications-settings-promo-scrolled.png') });
    report.textFit['07-notifications-settings-promo-scrolled'] = await textFit(p2);
    await ctx2.close();
  } finally {
    await browser.close();
    close();
  }
  writeFileSync(path.join(OUT, 'guest-verify-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ steps: report.steps, violations: report.violations, textFit: report.textFit, requestCount: report.requests.length }, null, 2));
  if (report.violations.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
