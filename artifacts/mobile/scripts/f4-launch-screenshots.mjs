#!/usr/bin/env node
/**
 * Launch checklist + best time to launch (items 45, 56), live on the
 * store-screenshots harness with `&demo=1` (the seller web preview never
 * calls the API, so demo rows come from lib/productLaunchChecklist.ts).
 *
 *   node scripts/f4-launch-screenshots.mjs <buildDir> <outDir> <before|after>
 *
 * "before" runs the same steps against a build of dev at 390x844: dev has no
 * demo launches, so its list is the empty state and the editor is opened via
 * the product sheet's ?productId= deep link.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] ?? 'after';
const BEFORE = MODE === 'before';
mkdirSync(OUT, { recursive: true });
const VIEWPORT = BEFORE ? { width: 390, height: 844 } : { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEMO = '&demo=1';

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'hide' });
  console.log(`  ok ${name}`);
}
async function overflowCheck(page, label) {
  const issues = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ');
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      const offScreen = (r.right > vw + 1 || r.left < -1) && r.top >= 0 && r.top < innerHeight;
      if (ellipsis || offScreen) out.push({ text: text.slice(0, 40), ellipsis, offScreen });
    }
    return out;
  });
  console.log(`overflow[${label}]:`, issues.length ? JSON.stringify(issues) : 'none');
}
async function waitText(page, text, pathForRetry) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try { await page.getByText(text, { exact: true }).first().waitFor({ timeout: 12_000 }); return; }
    catch (error) {
      if (attempt === 5) { await shot(page, 'debug-wait'); throw error; }
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, pathForRetry);
    }
  }
}
const go = (page, url) => page.evaluate((u) => { history.pushState(history.state, '', u); dispatchEvent(new PopStateEvent('popstate')); }, url);

async function launchesFlow(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await openScreen(page, activity, origin, 'seller', '/product-launches', { extraQuery: DEMO });
  await waitText(page, BEFORE ? 'No scheduled launches' : 'Heavyweight Hoodie — Ember', `/product-launches?bt_preview=seller${DEMO}`);
  await waitForImages(page);
  await page.waitForTimeout(800);
  await shot(page, `${MODE}-01-launches-list`);
  await overflowCheck(page, 'list');

  if (BEFORE) {
    await go(page, `/product-launches?productId=demo-launch-1&bt_preview=seller${DEMO}`);
  } else {
    await page.getByText('Heavyweight Hoodie — Ember', { exact: true }).first().click();
  }
  await waitText(page, BEFORE ? 'Schedule launch' : 'Edit launch', `/product-launches?productId=demo-launch-1&bt_preview=seller${DEMO}`);
  await page.waitForTimeout(900);
  await shot(page, `${MODE}-02-editor-top`);
  await overflowCheck(page, 'editor-top');
  if (!BEFORE) {
    await page.getByTestId('launch-best-time').click();
    await page.waitForTimeout(600);
    await page.getByTestId('launch-best-time').scrollIntoViewIfNeeded();
    await shot(page, `${MODE}-03-editor-best-time-applied`);
  }
  await page.getByText(BEFORE ? 'Notify my followers' : 'LAUNCH CHECKLIST', { exact: true }).last().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(600);
  await shot(page, `${MODE}-04-editor-bottom`);
  await overflowCheck(page, 'editor-bottom');
  if (BEFORE) { await context.close(); return; }
  await page.getByTestId('launch-checklist').screenshot({ path: path.join(OUT, 'zoom-01-checklist-warnings.png') });

  // Back to the list, open the blocked launch.
  await page.getByLabel('Go back').last().click();
  await page.waitForTimeout(900);
  await page.getByText('Field Shell Jacket — Rust', { exact: true }).first().click();
  await waitText(page, 'Edit launch', `/product-launches?bt_preview=seller${DEMO}`);
  await page.waitForTimeout(700);
  await page.getByText('Finish the required steps to schedule this launch.', { exact: true }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(600);
  await shot(page, `${MODE}-05-editor-blocked`);
  await overflowCheck(page, 'editor-blocked');
  await page.getByTestId('launch-checklist').screenshot({ path: path.join(OUT, 'zoom-02-checklist-blocked.png') });

  // Tapping a fixable row closes the editor and opens the screen that fixes it.
  await page.getByLabel('Set a price, required').click();
  await page.waitForTimeout(2500);
  await shot(page, `${MODE}-06-fix-opens-product-editor`);
  await context.close();
}

async function audienceFlow(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await openScreen(page, activity, origin, 'seller', '/analytics-audience', { extraQuery: DEMO });
  await waitText(page, 'Devices', `/analytics-audience?bt_preview=seller${DEMO}`);
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(1200);
  await page.getByText(/Groups with fewer than/).last().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(700);
  await shot(page, `${MODE}-07-audience-bottom`);
  await overflowCheck(page, 'audience');
  if (BEFORE) { await context.close(); return; }
  await page.getByText('Most active times', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, `${MODE}-08-audience-most-active-hours`);
  await page.getByTestId('most-active-times').screenshot({ path: path.join(OUT, 'zoom-03-most-active-hours.png') });
  await page.getByText('Days', { exact: true }).last().click();
  await page.waitForTimeout(500);
  await page.getByTestId('most-active-times').screenshot({ path: path.join(OUT, 'zoom-04-most-active-days.png') });
  await context.close();
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    await launchesFlow(browser, images, server.origin);
    await audienceFlow(browser, images, server.origin);
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
