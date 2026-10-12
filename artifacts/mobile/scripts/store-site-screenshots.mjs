#!/usr/bin/env node
/**
 * My Store (Stan Store style): My Store with its live preview, the Add Product
 * type picker, the Pre-made catalog picker, Design presets, the product
 * editor's three steps (new pre-made, new pre-order, an existing pre-order),
 * the profile editor and the Share store sheet — 390×844 screenshots in a
 * fresh account (`?bt_preview=seller`) and the demo dataset (`&demo=1`), plus
 * the shared text-fit audit.
 *
 *   node scripts/store-site-screenshots.mjs --build=<web export> --out=<dir> [--modes=fresh,demo] [--only=a,b]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openContext, openScreen, serveBuild } from './store-screenshots/harness.mjs';
import { checkTextFit } from './store-screenshots/text-fit.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BUILD = path.resolve(arg('build') ?? '/var/tmp/bt-web-after');
const OUT = path.resolve(arg('out') ?? 'docs/pr-review/store-site');
const MODES = (arg('modes') ?? 'fresh,demo').split(',');
const ONLY = arg('only')?.split(',');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const tap = (id) => async (page) => {
  await page.locator(`[data-testid="${id}"]`).first().click();
  await page.waitForTimeout(900);
};
const tapLabel = (label) => async (page) => {
  await page.locator(`[aria-label="${label}"]`).first().click();
  await page.waitForTimeout(900);
};
const type = (id, text) => async (page) => {
  const el = page.locator(`[data-testid="${id}"]`).first();
  await el.click();
  await el.fill(text);
  // Web only: focusing a low field makes the browser scroll clipped
  // (overflow: hidden) app containers, shifting the screen up and pulling the
  // slid-away tab bar into the shot. Native never does this; undo it.
  await page.evaluate(unclip);
  await page.waitForTimeout(300);
};
function unclip() {
  window.scrollTo(0, 0);
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollTop && getComputedStyle(el).overflowY === 'hidden') el.scrollTop = 0;
  }
}
const flip = (id) => async (page) => {
  await page.locator(`[data-testid="${id}"] [role="switch"], [data-testid="${id}"] input[type="checkbox"]`).first().click({ force: true });
  await page.evaluate(unclip);
  await page.waitForTimeout(600);
};
const scrollDown = async (page) => { await page.mouse.move(195, 600); await page.mouse.wheel(0, 1500); await page.waitForTimeout(500); };
const scrollTo = (id) => async (page) => {
  await page.locator(`[data-testid="${id}"]`).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
};

const COAT = '/store-product?id=pv-block-preview-product-3';
const NEW_PREMADE = [type('store-product-title', 'Linen overshirt'), type('store-product-subtitle', 'Washed linen, boxy fit.'), type('store-product-price', '88')];
const NEW_PREORDER = [type('store-product-title', 'Field jacket'), type('store-product-subtitle', 'Waxed cotton. Made to order.'), type('store-product-price', '165')];

/** name → route + taps to run before the shot; demoOnly shots need the demo store. */
const SHOTS = [
  { name: 'my-store', route: '/my-store' },
  { name: 'my-store-link-copied', route: '/my-store', steps: [tap('my-store-link')] },
  { name: 'add-product-types', route: '/my-store', steps: [tap('my-store-add-product')] },
  { name: 'add-product-premade', route: '/my-store', steps: [tap('my-store-add-product'), tap('my-store-type-premade')] },
  { name: 'design-presets', route: '/my-store', steps: [tapLabel('Edit design')] },
  { name: 'design-white', route: '/my-store', steps: [tapLabel('Edit design'), tap('my-store-theme-white')] },
  { name: 'editor-new-premade-thumbnail', route: '/store-product?new=premade', steps: NEW_PREMADE },
  { name: 'editor-new-premade-checkout', route: '/store-product?new=premade', steps: [...NEW_PREMADE, tap('store-product-next')] },
  { name: 'editor-new-premade-publish', route: '/store-product?new=premade', steps: [...NEW_PREMADE, tap('store-product-next'), tap('store-product-next')] },
  { name: 'editor-new-preorder-thumbnail', route: '/store-product?new=preorder', steps: NEW_PREORDER },
  { name: 'editor-new-preorder-checkout', route: '/store-product?new=preorder', steps: [...NEW_PREORDER, tap('store-product-next'), scrollDown, flip('store-product-cap-toggle'), type('store-product-cap', '50'), scrollDown] },
  { name: 'editor-new-preorder-ship-date', route: '/store-product?new=preorder', steps: [...NEW_PREORDER, tap('store-product-next'), tap('store-product-ship-by')] },
  { name: 'editor-preorder-thumbnail', route: COAT, demoOnly: true },
  { name: 'editor-preorder-checkout', route: COAT, demoOnly: true, steps: [tap('store-product-next')] },
  { name: 'editor-preorder-checkout-details', route: COAT, demoOnly: true, steps: [tap('store-product-next'), scrollTo('store-product-field-3')] },
  { name: 'editor-preorder-publish', route: COAT, demoOnly: true, steps: [tap('store-product-next'), tap('store-product-next')] },
  { name: 'editor-button-style', route: COAT, demoOnly: true, steps: [async (p) => { await p.getByText('Button', { exact: true }).first().click(); await p.waitForTimeout(500); }] },
  { name: 'store-profile', route: '/store-profile' },
  { name: 'dashboard-share-sheet', route: '/', steps: [tap('seller-dashboard-share-store')] },
];

const SCREEN_MARKER = {
  '/': 'seller-dashboard-share-store',
  '/my-store': 'my-store-screen',
  '/store-product': 'store-product-screen',
  '/store-profile': 'store-profile-screen',
};

let issues = 0;

async function capture(browser, origin, mode, shots) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const extra = mode === 'demo' ? '&demo=1' : '';
  for (const shot of shots) {
    if (shot.demoOnly && mode !== 'demo') continue;
    // A fresh context per shot: sheets and in-memory preview data start clean.
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
    page.on('pageerror', (e) => console.log(`  [pageerror ${mode}/${shot.name}]`, e.message.slice(0, 160)));
    await openScreen(page, activity, origin, 'seller', '/', { extraQuery: extra });
    await page.waitForTimeout(4000);
    const url = `${shot.route}${shot.route.includes('?') ? '&' : '?'}bt_preview=seller${extra}`;
    // A full load keeps `demo=1` in the URL while the screen first reads its
    // data (a client-side push briefly replaces the URL with "/"). Retry
    // until the screen's own testID is on the page.
    const marker = SCREEN_MARKER[shot.route.split('?')[0]];
    for (let attempt = 0; attempt < 3; attempt++) {
      if (shot.route !== '/') await page.goto(`${origin}${url}`);
      await page.waitForTimeout(4500);
      if (!marker || await page.locator(`[data-testid="${marker}"]`).count()) break;
    }
    try {
      for (const step of shot.steps ?? []) await step(page);
    } catch (e) {
      console.log(`  [step failed ${mode}/${shot.name}]`, String(e).slice(0, 200));
    }
    await page.screenshot({ path: path.join(OUT, `${shot.name}-${mode}.png`) });
    const fit = await checkTextFit(page).catch(() => []);
    if (fit.length) {
      issues += fit.length;
      console.log(`${shot.name} (${mode}): ${fit.length} text-fit issue(s)`);
      for (const i of fit.slice(0, 6)) console.log('   ', JSON.stringify(i));
    } else {
      console.log(`${shot.name} (${mode}): ok`);
    }
    await context.close();
  }
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const shots = ONLY ? SHOTS.filter((s) => ONLY.includes(s.name)) : SHOTS;
  const { origin, close } = await serveBuild(BUILD);
  const browser = await launchBrowser();
  try {
    for (const mode of MODES) await capture(browser, origin, mode, shots);
  } finally {
    await browser.close();
    close();
  }
  console.log(issues ? `\n${issues} text-fit issue(s)` : '\ntext-fit clean');
}
run().catch((e) => { console.error(e); process.exit(1); });
