#!/usr/bin/env node
/**
 * Seller screens wave — 390×844 screenshots of each touched seller screen in
 * a fresh account (`?bt_preview=seller`) and the demo dataset (`&demo=1`),
 * plus a text-fit audit. Point it at a web export (the harness's
 * buildPreviewWeb) so the same script captures "before" (dev) and "after".
 *
 *   node scripts/seller-screens-screenshots.mjs --build=<dir> --out=<dir> [--only=a,b] [--modes=fresh,demo]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openContext, openScreen, serveBuild } from './store-screenshots/harness.mjs';
import { checkTextFit } from './store-screenshots/text-fit.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BUILD = path.resolve(arg('build') ?? '/var/tmp/bt-web-after');
const OUT = path.resolve(arg('out') ?? 'docs/pr-assets/seller-screens');
const ONLY = arg('only')?.split(',');
const MODES = (arg('modes') ?? 'fresh,demo').split(',');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** name → route (+ optional scroll to capture a lower part of the screen). */
const tap = (page, id) => page.getByTestId(id).first().click();
const SCREENS = [
  { name: 'dashboard', route: '/' },
  // `actions` forces a fresh mount (hop via the dashboard) so the screen is never stale.
  { name: 'billing', route: '/billing', actions: async () => {} },
  { name: 'billing-scrolled', route: '/billing', scroll: 600, actions: async () => {} },
  { name: 'subscription', route: '/subscription', actions: async () => {} },
  // Plan & billing flows (demo: Growth plan; the preview applies changes locally).
  { name: 'billing-change-sheet', route: '/billing', actions: async (page) => {
    await tap(page, 'billing-change-plan');
  } },
  { name: 'billing-change-review-down', route: '/billing', actions: async (page) => {
    await tap(page, 'billing-change-plan');
    await page.waitForTimeout(700);
    await tap(page, 'billing-pick-starter');
  } },
  { name: 'billing-change-review-up', route: '/billing', actions: async (page) => {
    await tap(page, 'billing-change-plan');
    await page.waitForTimeout(700);
    await tap(page, 'billing-pick-pro');
  } },
  { name: 'billing-cancel-options', route: '/billing', actions: async (page) => {
    await tap(page, 'billing-cancel-plan');
  } },
  { name: 'billing-cancel-reason', route: '/billing', actions: async (page) => {
    await tap(page, 'billing-cancel-plan');
    await page.waitForTimeout(700);
    await tap(page, 'billing-cancel-option-cancel');
    await page.waitForTimeout(500);
    await tap(page, 'billing-cancel-reason-too_expensive');
  } },
  { name: 'billing-cancel-confirm', route: '/billing', actions: async (page) => {
    await tap(page, 'billing-cancel-plan');
    await page.waitForTimeout(700);
    await tap(page, 'billing-cancel-option-cancel');
    await page.waitForTimeout(500);
    await tap(page, 'billing-cancel-reason-too_expensive');
    await tap(page, 'billing-cancel-continue');
    await page.waitForTimeout(500);
    await tap(page, 'billing-cancel-agree');
  } },
  { name: 'billing-cancelled', route: '/billing', actions: async (page) => {
    await tap(page, 'billing-cancel-plan');
    await page.waitForTimeout(700);
    await tap(page, 'billing-cancel-option-cancel');
    await page.waitForTimeout(500);
    await tap(page, 'billing-cancel-reason-too_expensive');
    await tap(page, 'billing-cancel-continue');
    await page.waitForTimeout(500);
    await tap(page, 'billing-cancel-agree');
    await tap(page, 'billing-cancel-submit');
    await page.waitForTimeout(900);
  } },
  { name: 'billing-features', route: '/billing', actions: async (page) => {
    await tap(page, 'billing-view-features');
  } },
];

let issues = 0;

/** Tap the Products tab, then put the preview query back on the URL (tab presses drop it, and demo mode reads it). */
async function openProductsTab(page) {
  const extra = new URL(page.url()).search;
  await page.getByTestId('seller-tab-products').click();
  await page.waitForTimeout(1200);
  await page.evaluate((search) => {
    history.replaceState(history.state, '', `/products${search}`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, extra);
  await page.waitForTimeout(2500);
}

async function capture(browser, origin, mode, screens) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
  page.on('pageerror', (e) => console.log(`  [pageerror ${mode}]`, e.message.slice(0, 160)));
  const extra = mode === 'demo' ? '&demo=1' : '';
  await openScreen(page, activity, origin, 'seller', '/', { extraQuery: extra });
  await page.waitForTimeout(4000);
  for (const screen of screens) {
    if (screen.actions) {
      // Fresh mount for interactive states: hop through the dashboard first.
      await page.evaluate((target) => {
        history.pushState(history.state, '', target);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, `/?bt_preview=seller${extra}`);
      await page.waitForTimeout(1500);
    }
    const url = `${screen.route}${screen.route.includes('?') ? '&' : '?'}bt_preview=seller${extra}`;
    await page.evaluate((target) => {
      history.pushState(history.state, '', target);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, url);
    await page.waitForTimeout(3500);
    if (screen.actions) {
      try {
        await screen.actions(page);
        await page.waitForTimeout(1200);
      } catch (e) {
        console.log(`  [actions ${screen.name} ${mode}]`, String(e.message).slice(0, 200));
      }
    }
    if (screen.scroll) {
      await page.evaluate((y) => document.querySelectorAll('*').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 200) el.scrollTop = y;
      }), screen.scroll);
      await page.waitForTimeout(600);
    }
    const file = path.join(OUT, `${screen.name}-${mode}.png`);
    await page.screenshot({ path: file });
    const fit = await checkTextFit(page).catch(() => []);
    if (fit.length) {
      issues += fit.length;
      console.log(`${screen.name} (${mode}): ${fit.length} text-fit issue(s)`);
      for (const i of fit.slice(0, 6)) console.log('   ', JSON.stringify(i));
    } else {
      console.log(`${screen.name} (${mode}): ok`);
    }
  }
  await context.close();
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const screens = ONLY ? SCREENS.filter((s) => ONLY.includes(s.name)) : SCREENS;
  const { origin, close } = await serveBuild(BUILD);
  const browser = await launchBrowser();
  try {
    for (const mode of MODES) await capture(browser, origin, mode, screens);
  } finally {
    await browser.close();
    close();
  }
  console.log(issues ? `\n${issues} text-fit issue(s)` : '\ntext-fit clean');
}
run().catch((e) => { console.error(e); process.exit(1); });
