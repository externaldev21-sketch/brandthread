#!/usr/bin/env node
/**
 * Store website (My store, Design editor, Settings, Share store sheet,
 * Dashboard header) — 390×844 screenshots in a fresh account
 * (`?bt_preview=seller`) and the demo dataset (`&demo=1`), with taps to open
 * each sheet, plus the shared text-fit audit.
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

/** name → route + taps to run before the shot. */
const SHOTS = [
  { name: 'dashboard-header', route: '/' },
  { name: 'dashboard-share-sheet', route: '/', steps: [tap('seller-dashboard-share-store')] },
  { name: 'share-sheet-qr', route: '/', steps: [tap('seller-dashboard-share-store'), tap('share-store-qr-row')] },
  { name: 'share-sheet-copied', route: '/', steps: [tap('seller-dashboard-share-store'), tap('share-store-link')] },
  { name: 'share-store-page', route: '/share-store' },
  { name: 'my-store', route: '/my-store' },
  { name: 'my-store-link-copied', route: '/my-store', steps: [tap('my-store-link')] },
  { name: 'my-store-checklist-closed', route: '/my-store', steps: [tap('my-store-checklist-close')] },
  { name: 'store-design', route: '/store-design' },
  { name: 'store-design-theme', route: '/store-design', steps: [tap('store-design-tool-theme')] },
  { name: 'store-design-theme-bone', route: '/store-design', steps: [tap('store-design-tool-theme'), tap('store-design-theme-bone')] },
  { name: 'store-design-header', route: '/store-design', steps: [tap('store-design-tool-header')] },
  { name: 'store-design-style-buttons', route: '/store-design', steps: [tap('store-design-tool-style'), tap('store-design-buttons-square')] },
  { name: 'store-design-style-font', route: '/store-design', steps: [tap('store-design-tool-style'), async (p) => { await p.getByText('Font', { exact: true }).first().click(); await p.waitForTimeout(500); }, tap('store-design-font-serif')] },
  { name: 'store-design-undo', route: '/store-design', steps: [tap('store-design-tool-theme'), tap('store-design-theme-white'), tap('store-design-theme-navy'), tap('store-design-undo')] },
  { name: 'store-site-settings', route: '/store-site-settings' },
  { name: 'store-site-settings-add-link', route: '/store-site-settings', steps: [tap('store-settings-add-link')] },
];

const SCREEN_MARKER = {
  '/': 'seller-dashboard-share-store',
  '/share-store': 'share-store-screen',
  '/my-store': 'my-store-screen',
  '/store-design': 'store-design-screen',
  '/store-site-settings': 'store-site-settings',
};

let issues = 0;

async function capture(browser, origin, mode, shots) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const extra = mode === 'demo' ? '&demo=1' : '';
  for (const shot of shots) {
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
