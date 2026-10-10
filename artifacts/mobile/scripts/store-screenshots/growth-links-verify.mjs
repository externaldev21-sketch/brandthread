#!/usr/bin/env node
/**
 * Growth links + referrals + store domains (Revenue P1, BT-303..328) at
 * 393x852. Uses the preview build (harness.mjs buildPreviewWeb; build with
 * EXPO_PUBLIC_APP_STORE_URL set to see the web invite page). Signed-out shots
 * load the URL directly with a SIGNED-OUT Clerk stub (no preview bypass), so
 * they prove the guest route list; the API is faked per shot. Every request a
 * signed-out page makes is recorded; an Authorization header fails the run.
 *
 * Usage: node scripts/store-screenshots/growth-links-verify.mjs <outDir> [buildDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clerkStubScript } from './clerk-stub.mjs';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser, openContext, serveBuild, waitForImages, waitForQuietNetwork } from './harness.mjs';
import { BUYER_USER, DEMO_NOW, DEMO_TIME_ZONE, IMAGE_HOST, respond } from './demo-data.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../screenshots/revenue-p1-growth'));
const BUILD = path.resolve(process.argv[3] ?? DEFAULT_BUILD_DIR);
mkdirSync(OUT, { recursive: true });
const DEMO_API = 'https://api.brandthread.test';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: IPHONE_UA };
const STREAM_ID = '3f1a2b4c-1111-4222-8333-944455556666';
const ENDED_ID = '3f1a2b4c-1111-4222-8333-944455556667';

function signedOutStub() {
  return clerkStubScript(BUYER_USER)
    .replace('sessions: [session], activeSessions: [session], lastActiveSessionId: session.id', 'sessions: [], activeSessions: [], lastActiveSessionId: null')
    .replace('listener({ client, session, user: clerkUser, organization: null })', 'listener({ client, session: null, user: null, organization: null })')
    .replace('    session,\n    user: clerkUser,\n    client,', '    session: null,\n    user: null,\n    client,')
    .replace('__internal_lastEmittedResources: { client, session, user: clerkUser, organization: null }', '__internal_lastEmittedResources: { client, session: null, user: null, organization: null }');
}

const FAKE = {
  [`GET /api/live/${STREAM_ID}`]: { stream: { id: STREAM_ID, status: 'live', title: 'Fall drop: first look at the new knits', brand_name: 'Northline Studio', viewer_count: 214, avatar_url: `${IMAGE_HOST}/avatar-1.jpg` } },
  [`GET /api/live/${ENDED_ID}`]: { stream: { id: ENDED_ID, status: 'ended', title: 'Restock', brand_name: 'Northline Studio' } },
  'GET /api/giveaways/AB12CD34': {
    code: 'AB12CD34', phase: 'live', title: 'Win the Aurora Hoodie', prizeText: 'One Aurora Hoodie in your size',
    endsAt: new Date(DEMO_NOW + 3 * 86400000).toISOString(), startsAt: new Date(DEMO_NOW - 86400000).toISOString(),
    winnerCount: 1, requiresComment: true, seller: { id: 'u_seller', name: 'Northline Studio' }, postId: 'p1',
    me: null, winners: [], youWon: false, rulesText: 'No purchase necessary. Open to US residents 18+.',
  },
};

async function textFit(page) {
  return page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') bad.push(`clipped: ${el.textContent.trim().slice(0, 40)}`);
      if (r.right > window.innerWidth + 1 || r.left < -1) bad.push(`off-screen: ${el.textContent.trim().slice(0, 40)}`);
    }
    return [...new Set(bad)];
  });
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(BUILD);
  const report = { guestRequests: [], violations: [], textFit: {}, landedOn: {} };
  try {
    const guestShot = async (name, url) => {
      const context = await browser.newContext({
        viewport: device.viewport, deviceScaleFactor: device.scale, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
        locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'reduce',
      });
      await context.clock.install({ time: DEMO_NOW });
      await context.addInitScript(signedOutStub());
      await context.addInitScript(() => { localStorage.setItem('splash_seen', 'true'); });
      let lastApi = Date.now();
      await context.route('**/*', async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        if (u.origin === origin) return route.continue();
        if (u.origin === IMAGE_HOST) {
          const n = u.pathname.split('/').pop().replace(/\.jpg$/, '');
          return images[n] ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(images[n]) }) : route.fulfill({ status: 404, body: '' });
        }
        if (u.origin === DEMO_API) {
          const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
          if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
          lastApi = Date.now();
          const key = `${req.method()} ${u.pathname.replace(/^\/api\/v1\//, '/api/')}`;
          report.guestRequests.push(`${name}: ${key}`);
          if (req.headers().authorization) report.violations.push(`${name}: ${key} sent an Authorization header while signed out`);
          const body = FAKE[key] ?? respond({ method: req.method(), path: u.pathname, query: u.searchParams, role: 'buyer', options: {} });
          if (body === undefined) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":"NOT_SEEDED"}' });
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
        }
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto(`${origin}${url}`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20000 }).catch(() => {});
      const end = Date.now() + 10000;
      while (Date.now() < end && Date.now() - lastApi < 1200) await page.waitForTimeout(100);
      await page.getByText('Necessary only', { exact: true }).first().click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(1500);
      await waitForImages(page, 6000);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      report.textFit[name] = await textFit(page);
      report.landedOn[name] = new URL(page.url()).pathname + new URL(page.url()).search;
      await context.close();
    };

    await guestShot('guest-live-link', `/live/${STREAM_ID}`);
    await guestShot('guest-live-link-ended', `/live/${ENDED_ID}`);
    await guestShot('guest-giveaway-link', '/g/AB12CD34');
    await guestShot('guest-invite-link-iphone', '/invite/K7M2PQ');

    const signedIn = async (name, role, target, extraQuery = '', full = false) => {
      const { context, page, activity } = await openContext(browser, { device, role, origin, images });
      await page.goto(`${origin}/?bt_preview=${role}${extraQuery}`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const url = extraQuery ? `${target}${target.includes('?') ? '&' : '?'}${extraQuery.replace(/^&/, '')}` : target;
      await page.evaluate((u) => { history.pushState(history.state, '', u); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, url);
      await waitForQuietNetwork(activity, 800, 10000);
      await page.waitForTimeout(2000);
      await page.getByText('Necessary only', { exact: true }).first().click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(600);
      await waitForImages(page, 6000);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      report.textFit[name] = await textFit(page);
      report.landedOn[name] = new URL(page.url()).pathname;
      if (full) {
        await page.setViewportSize({ width: 393, height: 1900 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(OUT, `${name}-full.png`) });
      }
      await context.close();
    };
    await signedIn('buyer-menu', 'buyer', '/buyer-settings-menu', '', true);
    await signedIn('seller-marketing-growth', 'seller', '/marketing', '&demo=1', true);
    await signedIn('seller-refer-a-brand', 'seller', '/seller-refer', '&demo=1');
    await signedIn('seller-store-domain', 'seller', '/store-domain');
  } finally {
    writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    close();
    await browser.close();
  }
  console.log(JSON.stringify({ violations: report.violations, landedOn: report.landedOn, textFit: report.textFit }, null, 2));
  if (report.violations.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
