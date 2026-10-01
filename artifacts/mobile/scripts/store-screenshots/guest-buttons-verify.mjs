#!/usr/bin/env node
/**
 * Before/after zoomed screenshots and size measurements for the "Browse as a
 * guest" buttons on the welcome and sign-in screens (393x852, signed out).
 * "Before" hides the new button (display:none) in the same build.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clerkStubScript } from './clerk-stub.mjs';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser, serveBuild } from './harness.mjs';
import { BUYER_USER, DEMO_NOW, DEMO_TIME_ZONE, localStorageSeed, respond } from './demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/claude-review-ready-push-guest/buttons');
mkdirSync(OUT, { recursive: true });
const DEMO_API = 'https://api.brandthread.test';
const stub = clerkStubScript(BUYER_USER)
  .replace('sessions: [session], activeSessions: [session], lastActiveSessionId: session.id', 'sessions: [], activeSessions: [], lastActiveSessionId: null')
  .replace('listener({ client, session, user: clerkUser, organization: null })', 'listener({ client, session: null, user: null, organization: null })')
  .replace('    session,\n    user: clerkUser,\n    client,', '    session: null,\n    user: null,\n    client,')
  .replace('__internal_lastEmittedResources: { client, session, user: clerkUser, organization: null }', '__internal_lastEmittedResources: { client, session: null, user: null, organization: null }');

const browser = await launchBrowser();
const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
const result = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'reduce' });
  await ctx.clock.install({ time: DEMO_NOW });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((seed) => { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); },
    Object.fromEntries(Object.entries(localStorageSeed('buyer')).filter(([k]) => k.startsWith('bt:cookie') || k.startsWith('bt:feature') || k.includes('app-theme'))));
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
  const go = (u) => page.evaluate((x) => { history.pushState(history.state, '', x); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, u);
  const box = async (id) => { const b = await page.getByTestId(id).boundingBox(); return b && { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) }; };
  const toggle = (id, hide) => page.evaluate(({ id, hide }) => { const el = document.querySelector(`[data-testid="${id}"]`); if (el) el.style.display = hide ? 'none' : ''; }, { id, hide });

  await page.goto(`${origin}/`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20000 });
  await page.getByTestId('onboarding-welcome-browse-guest').waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  result.welcome = { getStarted: await box('onboarding-welcome-get-started'), haveAccount: await box('onboarding-welcome-sign-in'), browse: await box('onboarding-welcome-browse-guest') };
  const clipW = { x: 0, y: 580, width: 393, height: 250 };
  await toggle('onboarding-welcome-browse-guest', true);
  await page.screenshot({ path: path.join(OUT, 'welcome-before.png'), clip: clipW });
  await toggle('onboarding-welcome-browse-guest', false);
  await page.screenshot({ path: path.join(OUT, 'welcome-after.png'), clip: clipW });

  await go('/sign-in');
  await page.getByTestId('browse-as-guest-button').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  const inner = (id) => page.evaluate((id) => { const el = document.querySelector(`[data-testid="${id}"]`); const v = el?.firstElementChild; const r = v?.getBoundingClientRect(); return r && { w: Math.round(r.width), h: Math.round(r.height) }; }, id);
  const createBtn = await page.getByRole('button', { name: 'Create an account' }).evaluate((el) => { const r = el.firstElementChild.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  result.signIn = { usePasswordInner: await inner('use-password-button'), createAccountInner: createBtn, browseInner: await inner('browse-as-guest-button') };
  const clipS = { x: 0, y: 520, width: 393, height: 300 };
  await toggle('browse-as-guest-button', true);
  await page.screenshot({ path: path.join(OUT, 'sign-in-before.png'), clip: clipS });
  await toggle('browse-as-guest-button', false);
  await page.screenshot({ path: path.join(OUT, 'sign-in-after.png'), clip: clipS });

  // Cold launch without using the button: where does a signed-out user land?
  const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 } });
  await ctx2.addInitScript(stub);
  await ctx2.route('**/*', (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
  const p2 = await ctx2.newPage();
  await p2.goto(`${origin}/`);
  await p2.waitForTimeout(8000);
  result.coldLaunchWithoutButtons = new URL(p2.url()).pathname;
} finally {
  await browser.close();
  close();
}
writeFileSync(path.join(OUT, 'button-measurements.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
