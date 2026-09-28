#!/usr/bin/env node
/**
 * Item 82: tap every Activity row type and record exactly where it lands —
 * comment / mention / reply rows must open the post's comments scrolled to
 * and highlighting that comment (a reply inside its expanded thread).
 *
 * Drives the DEV bundle (what the owner's Replit preview serves) with every
 * signed-in API call answered 401, like a no-account preview, so the seeded
 * preview feed and comments are what's on screen. Buyer reaches Activity from
 * the tab bar, seller from the dashboard bell — the owner's own paths.
 *
 * Usage: start the dev server first (see activity-dev-preview-verify.mjs), then
 *   node scripts/store-screenshots/activity-deep-links-verify.mjs [origin] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/activity-deep-links'));
mkdirSync(OUT, { recursive: true });
const VIEW_H = 844;

async function run(browser, images, role) {
  const device = { viewport: { width: 390, height: VIEW_H }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin: ORIGIN, images });
  await context.route((url) => url.origin === 'https://api.brandthread.test' && !url.pathname.includes('/api/public/'), (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
  });
  page.setDefaultNavigationTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const settle = async (ms = 800) => { await waitForQuietNetwork(activity, 500, 10_000); await page.waitForTimeout(ms); };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${role}-${name}.png`) });
  const rows = page.locator('[data-testid^="activity-row-"]');
  // The dev bundle's LogBox toast (e.g. the pre-existing "Invalid DOM property
  // `transform-origin`" warning) can sit over the rows; note it, then clear it
  // so it doesn't swallow the tap.
  const overlays = new Set();
  const clearOverlay = async () => {
    const text = await page.evaluate(() => {
      const el = document.getElementById('error-overlay');
      if (!el) return '';
      const t = el.innerText;
      el.remove();
      return t;
    });
    if (text.trim()) overlays.add(text.trim().split('\n').slice(0, 2).join(' / ').slice(0, 160));
  };

  let chip = 'all';
  const openActivity = async () => {
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, ORIGIN, role, role === 'buyer' ? '/' : '/(tabs)');
      await settle(1500);
      const entry = role === 'buyer' ? page.getByTestId('buyer-tab-activity').first() : page.getByTestId('seller-dashboard-activity').first();
      try { await entry.waitFor({ timeout: 20_000 }); } catch (error) { if (attempt >= 3) throw error; continue; }
      const later = page.getByText('Continue setup later');
      if (await later.count()) { await later.first().click().catch(() => {}); await settle(800); }
      await entry.click();
      try { await rows.first().waitFor({ timeout: 20_000 }); break; } catch (error) { if (attempt >= 3) throw error; }
    }
    await settle(2500);
    // Orders sit under their own chip (All leaves them out, item 78).
    if (chip !== 'all') {
      await page.getByTestId(`activity-chip-${chip}`).first().click();
      await rows.first().waitFor({ timeout: 20_000 });
      await settle(1000);
    }
  };

  // The list virtualises: scroll through it to collect every row.
  const mountedKeys = () => rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  const wheel = (dy) => page.mouse.move(195, 500).then(() => page.mouse.wheel(0, dy));
  const findRow = async (testId) => {
    for (let i = 0; i < 25 && !(await page.getByTestId(testId).count()); i += 1) { await wheel(400); await page.waitForTimeout(250); }
  };
  const visibleText = (re) => page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    return [...document.querySelectorAll('div, span')].some((el) => el.childElementCount === 0 && rx.test(el.textContent ?? '')
      && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < 844
      && getComputedStyle(el).visibility !== 'hidden');
  }, re.source);

  const results = [];
  for (chip of ['all', 'orders']) {
  await openActivity();
  await shot(`00-activity-${chip}`);
  const seen = new Set(await mountedKeys());
  for (let i = 0; i < 25; i += 1) {
    await wheel(400);
    await page.waitForTimeout(300);
    const before = seen.size;
    for (const key of await mountedKeys()) seen.add(key);
    if (i > 3 && seen.size === before) break;
  }
  if (chip === 'all') await shot('00-activity-bottom');
  const keys = [...seen];
  await openActivity();
  for (const testId of keys) {
    if (!(await rows.count())) await openActivity();
    await findRow(testId);
    if (!(await page.getByTestId(testId).count())) { await openActivity(); await findRow(testId); }
    const label = await page.getByTestId(testId).first().getAttribute('aria-label');
    const before = page.url();
    await clearOverlay();
    await page.getByTestId(testId).first().click();
    await page.waitForURL((u) => u.toString() !== before, { timeout: 15_000 }).catch(() => {});
    await settle(1500);
    const url = new URL(page.url());
    const entry = { chip, row: testId.replace('activity-row-', ''), label, landed: `${url.pathname}${url.search}` };
    await clearOverlay();
    if (url.pathname.endsWith('/buyer-post-comments') && url.searchParams.get('commentId')) {
      const hl = page.getByTestId('comment-deep-link-highlight').first();
      entry.highlighted = await hl.waitFor({ timeout: 10_000 }).then(() => true, () => false);
      if (entry.highlighted) {
        const box = await hl.boundingBox();
        entry.highlightInView = !!box && box.y >= 0 && box.y + box.height <= VIEW_H;
        entry.highlightText = (await hl.innerText()).replace(/\s+/g, ' ').slice(0, 90);
        entry.highlightBg = await hl.evaluate((el) => getComputedStyle(el).backgroundColor);
      }
      await shot(`comment-${entry.row}`);
      // The harness's installed clock runs slower than wall time on the heavy
      // dev bundle, so wait out the 2.6s fade in PAGE time, not wall time.
      const pageNow = () => page.evaluate(() => performance.now());
      const shownAt = await pageNow();
      for (let i = 0; i < 60 && (await pageNow()) - shownAt < 3500; i += 1) await page.waitForTimeout(500);
      const left = await page.getByTestId('comment-deep-link-highlight').evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        return { visible: r.width > 0 && r.bottom > 0 && r.top < 844, bg: getComputedStyle(el).backgroundColor };
      }));
      entry.highlightFaded = !left.some((h) => h.visible);
      if (left.length) entry.highlightLeftInDom = left;
    } else {
      await shot(`dest-${entry.row}`);
      entry.errorShown = await visibleText(/could(n.t| not) load|not found|no longer available|something went wrong|try again/);
      entry.image = await page.evaluate(() => [...document.querySelectorAll('img')].filter((img) => {
        const r = img.getBoundingClientRect();
        return r.width > 200 && r.top < 844 && r.bottom > 0;
      }).length > 0);
    }
    results.push(entry);
    await clearOverlay();
    await page.goBack();
    await settle(1500);
    if (!(await rows.count())) await openActivity();
  }
  }
  await context.close();
  return { rows: results, devOverlays: [...overlays] };
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  try {
    const roles = process.env.VERIFY_ROLES ? process.env.VERIFY_ROLES.split(',') : ['buyer', 'seller'];
    for (const role of roles) {
      const results = await run(browser, images, role);
      console.log(`\n[${role}]`, JSON.stringify(results, null, 2));
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
