#!/usr/bin/env node
/**
 * Captures the native-feel menus/sheets/swipes at 390x844 on the web preview:
 * ⋯ pull-down menus, long-press preview menus, detent sheets, swipe rows.
 *
 *   node scripts/store-screenshots/native-feel-verify.mjs [outDir] [--demo] [--only=name,name]
 *
 * Expects a preview build in .store-screenshots/web-build (harness.mjs
 * `buildPreviewWeb`).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(MOBILE_ROOT, 'docs/pr-review/native-feel'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
const suffix = demo ? '-demo' : '';

async function clickLabel(page, label) {
  await page.getByLabel(label, { exact: false }).first().click();
}

async function openSellerTab(page, name) {
  await page.getByRole('tab', { name }).or(page.getByRole('button', { name })).first().click();
  await page.waitForTimeout(1500);
}

async function longPress(page, locator, ms = 700) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('long-press target not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function swipeLeft(page, locator, distance = 160) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('swipe target not visible');
  const y = box.y + box.height / 2;
  const x = box.x + box.width - 30;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x - (distance * i) / 12, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

export const FLOWS = [
  { name: 'orders-pulldown', role: 'seller', target: '/', act: async (p) => { await openSellerTab(p, /orders/i); await clickLabel(p, 'More order actions'); }, wait: 'pulldown-menu' },
  { name: 'products-pulldown', role: 'seller', target: '/', act: async (p) => { await openSellerTab(p, /products/i); await p.getByLabel(/^more/i).first().click(); }, wait: 'pulldown-menu' },
  { name: 'seller-profile-pulldown', role: 'seller', target: '/(tabs)/profile', act: (p) => p.getByTestId('seller-profile-more').first().click(), wait: 'pulldown-menu' },
  { name: 'buyer-profile-pulldown', role: 'buyer', target: '/(buyer)/profile', act: (p) => p.getByTestId('buyer-profile-more').first().click(), wait: 'pulldown-menu' },
];

async function run(browser, images, origin, flow) {
  const { context, page, activity } = await openContext(browser, { device, role: flow.role, origin, images });
  const file = path.join(OUT, `${flow.name}${suffix}.png`);
  try {
    await openScreen(page, activity, origin, flow.role, flow.target, { extraQuery: demo ? '&demo=1' : '' });
    await waitForQuietNetwork(activity, 700, 12_000);
    await page.waitForTimeout(1200);
    await waitForImages(page, 6_000);
    if (flow.before) {
      await page.screenshot({ path: path.join(OUT, `${flow.name}-before${suffix}.png`) });
    }
    await flow.act(page, { longPress, swipeLeft });
    if (flow.wait) await page.getByTestId(flow.wait).first().waitFor({ timeout: 6_000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: file });
    console.log(`Captured ${flow.name}${suffix}`);
  } catch (e) {
    console.error(`FAILED ${flow.name}${suffix}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: file.replace('.png', '-FAILED.png') }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    for (const flow of FLOWS) {
      if (only.length && !only.includes(flow.name)) continue;
      await run(browser, images, origin, flow);
    }
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
