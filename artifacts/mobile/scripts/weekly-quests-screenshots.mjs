#!/usr/bin/env node
/**
 * Thread Cash weekly quests — before (dev baseline) / after screenshots of
 * /thread-cash at 390x844 and 393x852 (scale 2, iPhone UA).
 *
 *   node scripts/weekly-quests-screenshots.mjs [--skip-build]
 *
 * Before: the prebuilt dev baseline at /home/user/baseline-web-build.
 * After:  this branch's build in .store-screenshots/web-build.
 *
 * States (after):
 *   preview-demo  — buyer dev preview with &demo=1 (local preview data, no API)
 *   in-progress   — signed-in path, fake API: quests partly done
 *   complete      — fake API: every quest done, the Claim button showing
 *   claimed       — after tapping Claim: reward claimed, balance refreshed
 * The signed-in states drop the preview flag so the screen takes its real
 * API path; every request is answered by the fake API below (test
 * scaffolding, not app data).
 *
 * Output: docs/pr-assets/weekly-quests/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { collectTextFitIssues } from './textFitCheck.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/weekly-quests');
const BASELINE_BUILD = '/home/user/baseline-web-build';
const AFTER_BUILD = path.join(MOBILE_ROOT, '.store-screenshots', 'web-build');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICES = [
  { tag: '390', viewport: { width: 390, height: 844 } },
  { tag: '393', viewport: { width: 393, height: 852 } },
];
// DEMO_NOW is Fri 2026-09-18 16:30 America/Los_Angeles; the week ends Monday 00:00 PDT.
const ENDS_AT = '2026-09-21T07:00:00.000Z';
const WALLET_BALANCE = 4260;

const quests = (p) => [
  { id: 'open_days', title: 'Open Brandthread on 3 days', progress: p[0], target: 3 },
  { id: 'save_products', title: 'Save 3 pieces', progress: p[1], target: 3 },
  { id: 'follow_brands', title: 'Follow 2 brands', progress: p[2], target: 2 },
];
const weekly = (p, claimed, weekStreak) => ({
  weekKey: '2026-W38', endsAt: ENDS_AT, quests: quests(p), rewardCents: 50, claimed, weekStreak,
});

function json(origin, body, status = 200) {
  return {
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  };
}

async function routeFakeApi(context, origin, state) {
  const passOptions = (route) => route.request().method() === 'OPTIONS';
  await context.route((url) => url.pathname.endsWith('/api/thread-cash'), (route) => {
    if (passOptions(route)) return route.fallback();
    return route.fulfill(json(origin, {
      balanceCents: state.balanceCents,
      config: { dailyAmountCents: 10, streakBonusCents: 100, streakBonusDays: 7, graceHours: 20, expiryDays: 180, maxRedemptionPerOrderCents: 2000 },
      streak: { currentStreak: 4, longestStreak: 11, lastCheckInDate: '2026-09-18', timezone: 'America/Los_Angeles', alreadyCheckedInToday: true, dayInCycle: 4, streakBonusDays: 7 },
    }));
  });
  await context.route((url) => url.pathname.endsWith('/api/thread-cash/history'), (route) => {
    if (passOptions(route)) return route.fallback();
    const history = [
      ...(state.claimed ? [{ id: 'wq', buyerId: 'buyer', amountCents: 50, source: 'weekly_quests', referenceId: '2026-W38', note: null, createdAt: '2026-09-18T23:31:00.000Z' }] : []),
      { id: 'h1', buyerId: 'buyer', amountCents: 10, source: 'daily_checkin', referenceId: '2026-09-18', note: null, createdAt: '2026-09-18T20:00:00.000Z' },
      { id: 'h2', buyerId: 'buyer', amountCents: 10, source: 'daily_checkin', referenceId: '2026-09-17', note: null, createdAt: '2026-09-17T20:00:00.000Z' },
    ];
    return route.fulfill(json(origin, { history }));
  });
  await context.route((url) => url.pathname.endsWith('/api/thread-cash/weekly-quests'), (route) => {
    if (passOptions(route)) return route.fallback();
    return route.fulfill(json(origin, weekly(state.progress, state.claimed, state.weekStreak)));
  });
  await context.route((url) => url.pathname.endsWith('/api/thread-cash/weekly-quests/claim'), (route) => {
    if (passOptions(route)) return route.fallback();
    state.claimed = true;
    state.weekStreak += 1;
    state.balanceCents += 50;
    return route.fulfill(json(origin, {
      ok: true, created: true, amountCents: 50, balanceCents: state.balanceCents,
      ...weekly(state.progress, true, state.weekStreak),
    }));
  });
}

async function open(browser, server, device, { signedIn, state }) {
  const { context, page, activity } = await openContext(browser, {
    device: { viewport: device.viewport, scale: 2, isMobile: true, userAgent: UA },
    role: 'buyer', origin: server.origin, images: {},
  });
  page.setDefaultNavigationTimeout(240_000);
  if (signedIn) await routeFakeApi(context, server.origin, state);
  if (!signedIn) {
    await openScreen(page, activity, server.origin, 'buyer', '/thread-cash', { extraQuery: '&demo=1' });
  } else {
    // Settle on "/" with the demo account, then leave preview mode: clear the
    // remembered preview role and navigate without bt_preview, so the screen
    // takes its real (signed-in) API path against the fake API.
    await openScreen(page, activity, server.origin, 'buyer', '/(buyer)');
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      try { localStorage.removeItem('user_role'); sessionStorage.removeItem('bt_preview_role'); } catch {}
      history.pushState(history.state, '', '/thread-cash');
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    });
  }
  await page.getByText('Your balance').first().waitFor({ timeout: 30_000 });
  await waitForQuietNetwork(activity, 900, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(1200);
  return { context, page, activity };
}

async function scrollTo(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el?.scrollIntoView({ block: 'center' });
  }, selector);
  await page.waitForTimeout(500);
}

async function shot(page, name) {
  const issues = await collectTextFitIssues(page);
  if (issues.length) console.log(`  text-fit ${name}:`, JSON.stringify(issues));
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('ok', name);
  return issues.length;
}

async function run() {
  const skipBuild = process.argv.includes('--skip-build');
  if (!skipBuild || !existsSync(path.join(AFTER_BUILD, 'index.html'))) buildPreviewWeb(AFTER_BUILD);
  if (!existsSync(path.join(BASELINE_BUILD, 'index.html'))) throw new Error('Dev baseline build is missing.');
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  let issues = 0;
  try {
    // ── Before: dev baseline, same screen and scroll position (below the streak card).
    {
      const server = await serveBuild(BASELINE_BUILD);
      for (const device of DEVICES) {
        const { context, page } = await open(browser, server, device, { signedIn: false });
        await page.getByText(/Longest streak/).first().scrollIntoViewIfNeeded();
        await page.evaluate(() => {
          const el = [...document.querySelectorAll('div')].find((d) => /^Longest streak/.test(d.textContent ?? '') && d.children.length === 0);
          el?.scrollIntoView({ block: 'start' });
        });
        await page.waitForTimeout(500);
        issues += await shot(page, `before-${device.tag}.png`);
        await context.close();
      }
      server.close();
    }
    // ── After
    {
      const server = await serveBuild(AFTER_BUILD);
      for (const device of DEVICES) {
        {
          const { context, page } = await open(browser, server, device, { signedIn: false });
          await scrollTo(page, '[data-testid="weekly-quests"]');
          issues += await shot(page, `after-${device.tag}-preview-demo.png`);
          await context.close();
        }
        {
          const state = { progress: [2, 1, 1], claimed: false, weekStreak: 2, balanceCents: WALLET_BALANCE };
          const { context, page } = await open(browser, server, device, { signedIn: true, state });
          await page.getByTestId('weekly-quests-reward').waitFor({ timeout: 20_000 });
          await scrollTo(page, '[data-testid="weekly-quests"]');
          issues += await shot(page, `after-${device.tag}-1-in-progress.png`);
          await context.close();
        }
        {
          const state = { progress: [3, 3, 2], claimed: false, weekStreak: 2, balanceCents: WALLET_BALANCE };
          const { context, page, activity } = await open(browser, server, device, { signedIn: true, state });
          await page.getByTestId('weekly-quests-claim').waitFor({ timeout: 20_000 });
          await scrollTo(page, '[data-testid="weekly-quests"]');
          issues += await shot(page, `after-${device.tag}-2-complete.png`);
          await page.getByTestId('weekly-quests-claim').click();
          await page.getByText('Reward claimed').first().waitFor({ timeout: 20_000 });
          await waitForQuietNetwork(activity, 900, 20_000);
          await page.waitForTimeout(800);
          await scrollTo(page, '[data-testid="weekly-quests"]');
          issues += await shot(page, `after-${device.tag}-3-claimed.png`);
          // Balance refreshed after the claim ($42.60 -> $43.10).
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(400);
          issues += await shot(page, `after-${device.tag}-4-claimed-balance.png`);
          await context.close();
        }
      }
      server.close();
    }
  } finally {
    await browser.close();
  }
  console.log(issues === 0 ? 'TEXT-FIT: clean' : `TEXT-FIT: ${issues} issue(s)`);
}

run().catch((error) => { console.error(error); process.exit(1); });
