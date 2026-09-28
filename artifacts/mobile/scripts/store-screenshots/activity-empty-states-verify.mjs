#!/usr/bin/env node
/**
 * Item 85: every Activity filter's empty state, both roles — including a
 * genuinely new account with no activity at all.
 *
 * Production web export (so the dev-only seeded preview feed never stands
 * in for an empty one) signed in as the demo buyer / seller, with a fake of
 * the real GET /api/buyer/notifications:
 *   newUser — the feed is empty: all six chips show their empty state; each
 *             call-to-action is tapped and must land on a working screen.
 *   partial — one comment only: Comments and All show it, the other four
 *             chips show their own empty state.
 * Reaches Activity the owner's way (buyer tab bar / seller dashboard bell).
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/activity-empty-states-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/activity-empty-states'));
mkdirSync(OUT, { recursive: true });
const VIEW_H = 844;
const CHIPS = ['all', 'follows', 'likes', 'comments', 'orders', 'thread_cash'];

const ONE_COMMENT = [{
  id: 'c1', category: 'social', type: 'post_comment', title: 'Cory Commenter commented on your post', body: 'love this fit',
  actorId: 'u-cory', actorName: 'Cory Commenter', actorInitials: 'CC', actorColor: '#3F3F46',
  targetId: 'p1', targetType: 'post', isRead: true, isMuted: false, createdAt: new Date(DEMO_NOW - 20 * 60_000).toISOString(),
}];

async function installFakeFeed(context, getFeed) {
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
    if (p === '/api/buyer/notifications' && req.method() === 'GET') return json(getFeed());
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 0, latestId: getFeed()[0]?.id ?? null });
    return json({ ok: true });
  });
}

async function run(browser, images, origin, role) {
  const device = { viewport: { width: 390, height: VIEW_H }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  let feed = [];
  await installFakeFeed(context, () => feed);
  page.setDefaultNavigationTimeout(120_000);
  const alerts = [];
  page.on('dialog', (d) => { alerts.push(d.message()); void d.dismiss(); });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${role}-${name}.png`) });
  const settle = async (ms = 600) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
  const chipEl = (chip) => page.getByTestId(`activity-chip-${chip}`).first();

  // The owner's way in: buyer tab bar / seller dashboard bell (direct route as a fallback).
  let enteredVia = null;
  const openActivity = async () => {
    for (let attempt = 1; ; attempt += 1) {
      // (In the production export the buyer's home feed renders without the
      // tab bar's test ids, so the buyer starts on its Activity tab route
      // and taps the tab — the same screen the tab bar opens.)
      await openScreen(page, activity, origin, role, role === 'buyer' ? '/activity' : '/(tabs)');
      await settle(1200);
      const entry = role === 'buyer' ? page.getByTestId('buyer-tab-activity').first() : page.getByTestId('seller-dashboard-activity').first();
      const later = page.getByText('Continue setup later');
      if (await later.count()) { await later.first().click().catch(() => {}); await settle(500); }
      if (await entry.count()) { await entry.click(); enteredVia = role === 'buyer' ? 'buyer tab bar' : 'seller dashboard bell'; }
      else { await openScreen(page, activity, origin, role, '/activity-center'); enteredVia = 'direct route (entry not found)'; }
      try { await chipEl('all').waitFor({ timeout: 15_000 }); break; } catch (error) { if (attempt >= 3) throw error; }
    }
    await settle(1200);
  };
  const tabBarTop = () => page.evaluate(() => {
    const tops = [...document.querySelectorAll('[data-testid^="buyer-tab-"], [data-testid^="seller-tab-"]')]
      .map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0 && b.top > 500).map((b) => b.top);
    return tops.length ? Math.min(...tops) : 844;
  });
  const readEmpty = async (chip) => {
    const el = page.getByTestId(`activity-empty-${chip}`).first();
    if (!(await el.count())) return { shown: false };
    const title = await el.getByRole('heading').first().innerText().catch(() => null);
    const text = (await el.innerText()).replace(/\s+/g, ' ').trim();
    const action = page.getByTestId(`activity-empty-${chip}-action`).first();
    const hasAction = (await action.count()) > 0;
    const box = hasAction ? await action.boundingBox() : await el.boundingBox();
    const barTop = await tabBarTop();
    return {
      shown: true,
      title,
      text,
      action: hasAction ? (await action.innerText()).trim() : null,
      clearOfTabBar: !!box && box.y + box.height <= barTop,
    };
  };
  const rowsShown = () => page.locator('[data-testid^="activity-row-"]').count();
  const suggestionsShown = () => page.getByText('Suggested for you').count().then((n) => n > 0);

  const result = { alerts, newUser: {}, partial: {}, ctas: {} };

  // ── A brand-new account: nothing at all ────────────────────────────────────
  feed = [];
  await openActivity();
  for (const [index, chip] of CHIPS.entries()) {
    await chipEl(chip).click();
    await settle(500);
    result.newUser[chip] = { ...(await readEmpty(chip)), rows: await rowsShown() };
    if (chip === 'all') result.newUser.all.suggestedForYouBelow = await suggestionsShown();
    await shot(`new-${String(index + 1).padStart(2, '0')}-${chip}`);
  }

  // Every call-to-action goes somewhere real.
  const seen = new Set();
  for (const chip of CHIPS) {
    if (!result.newUser[chip].action) continue;
    await chipEl(chip).click();
    await settle(400);
    const before = page.url();
    await page.getByTestId(`activity-empty-${chip}-action`).first().click();
    await page.waitForURL((u) => u.toString() !== before, { timeout: 10_000 }).catch(() => {});
    await settle(1500);
    const url = new URL(page.url());
    const landed = `${url.pathname}${url.search}`;
    const errorShown = await page.evaluate(() => /could(n.t| not) load|not found|something went wrong|unmatched route/i.test(document.body.innerText));
    // Where each button is meant to go — a redirect elsewhere is a dead end.
    const intended = { 'Find people to follow': '/buyer-search', 'Share your store': '/share-store', 'Start shopping': '/discover', 'Open Thread Cash': '/thread-cash' }[result.newUser[chip].action];
    result.ctas[chip] = {
      label: result.newUser[chip].action, landed, navigated: page.url() !== before,
      landedWhereIntended: url.pathname === intended, errorShown,
    };
    if (!seen.has(url.pathname)) { seen.add(url.pathname); await shot(`cta-${chip}-${url.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}`); }
    await page.goBack();
    await settle(1000);
    if (!(await chipEl('all').count())) await openActivity();
  }

  // ── Some activity, just not in most filters ────────────────────────────────
  feed = ONE_COMMENT;
  await openActivity();
  for (const chip of CHIPS) {
    await chipEl(chip).click();
    await settle(500);
    result.partial[chip] = { empty: (await readEmpty(chip)).shown, rows: await rowsShown() };
  }
  await chipEl('likes').click();
  await settle(400);
  await shot('partial-likes-empty');

  result.enteredVia = enteredVia;
  await context.close();
  return result;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const roles = process.env.VERIFY_ROLES ? process.env.VERIFY_ROLES.split(',') : ['buyer', 'seller'];
    for (const role of roles) {
      const result = await run(browser, images, origin, role);
      console.log(`\n[${role}]`, JSON.stringify(result, null, 2));
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
