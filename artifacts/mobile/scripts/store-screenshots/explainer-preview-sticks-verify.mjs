#!/usr/bin/env node
/**
 * Dev's fast-preview sequence, hands-on at 390x844 on the plain preview
 * build: `?bt_preview=seller&tips=1`, open a screen, dismiss its explainer,
 * leave, come back — nothing. Then reload the page — still nothing, on every
 * screen. Navigation inside the app is client-side (no reload) like tapping
 * through it; the reload is a real page reload.
 *
 *   node scripts/store-screenshots/explainer-preview-sticks-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, MOBILE_ROOT, DEFAULT_BUILD_DIR,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'explainer-preview-sticks'));
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
const SCREENS = [
  ['explain-design-gallery', '/design', 'ok'],
  ['explain-manufacturer-hub', '/manufacturer-hub', 'close'],
  ['seller-orders', '/orders', 'outside'],
];

const sheet = (id) => `[data-testid="first-run-tip-explainer-${id}"]`;

async function nav(page, activity, route) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, route);
    await waitForQuietNetwork(activity, 600, 10_000).catch(() => {});
    await page.waitForTimeout(800);
    if (new URL(page.url()).pathname === route) return;
  }
  throw new Error(`could not navigate to ${route}`);
}

async function visible(page, id, timeout) {
  return page.locator(sheet(id)).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
}

async function dismiss(page, how) {
  if (how === 'ok') await page.getByTestId('first-run-tip-explainer-ok').first().click();
  else if (how === 'close') await page.getByTestId('first-run-tip-explainer-close').first().click();
  else await page.mouse.click(195, 60);
  await page.waitForTimeout(400);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const failures = [];
  const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };
  try {
    const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    // Dev's own URL: the preview with tips turned on.
    await page.goto(`${origin}/?bt_preview=seller&tips=1`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await waitForQuietNetwork(activity, 800, 15_000);
    await page.waitForTimeout(2500);

    for (const [i, [id, route, how]] of SCREENS.entries()) {
      await nav(page, activity, route);
      const first = await visible(page, id, 12_000);
      check(first, `${route}: explainer shows on first visit`);
      if (!first) continue;
      await page.screenshot({ path: path.join(OUT, `${i + 1}a-${id}-first-visit.png`) });
      await dismiss(page, how);
      check((await page.locator(sheet(id)).count()) === 0, `${route}: dismissed with ${how}`);
      // Leave to another screen and come back (client-side, no reload).
      await nav(page, activity, route === '/analytics' ? '/products' : '/analytics');
      await nav(page, activity, route);
      const back = await visible(page, id, 4000);
      check(!back, `${route}: leave → return shows nothing`);
      await page.screenshot({ path: path.join(OUT, `${i + 1}b-${id}-return.png`) });
    }

    // Full page reload, then every screen again.
    for (const [i, [id, route]] of SCREENS.entries()) {
      await page.goto(`${origin}${route}?bt_preview=seller&tips=1`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await waitForQuietNetwork(activity, 800, 15_000);
      if (new URL(page.url()).pathname !== route) await nav(page, activity, route);
      const again = await visible(page, id, 5000);
      check(!again, `${route}: after a page reload shows nothing`);
      await page.screenshot({ path: path.join(OUT, `${i + 1}c-${id}-after-reload.png`) });
    }
  } finally {
    await browser.close();
    await close();
  }
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
