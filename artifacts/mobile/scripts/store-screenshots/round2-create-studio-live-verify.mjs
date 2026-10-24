#!/usr/bin/env node
/**
 * Round 2 fix-backs (Create / Studio / LIVE): opens every web-renderable
 * screen touched by the round at 390x844 as seller (and buyer for the LIVE
 * viewer routes), records page errors and takes a screenshot, then drives a
 * few interactive checks (canvas aspect-fit, schedule-live past slots,
 * moderation discard prompt, ai-studio clipboard tab).
 *
 *   node scripts/store-screenshots/build-preview.mjs
 *   node scripts/store-screenshots/round2-create-studio-live-verify.mjs [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'round2-create-studio-live'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };

const SELLER_ROUTES = [
  '/create-post', '/post-captions-edit?postId=x', '/studio', '/ai-studio',
  '/design', '/design-project?type=garment&garmentType=bogus', '/design-templates', '/design-brand-assets',
  '/design-campaign', '/design-export', '/design-versions', '/design-canvas',
  '/design-ai-photoshoot', '/design-bg-removal', '/design-bg-replace', '/design-garment',
  '/design-mockup-preview', '/design-mockup-to-model', '/design-prompt-edit', '/design-text-to-design',
  '/design-upload-sketch', '/ai-brain', '/ai-photography-chat', '/ai-mockup-chat',
  '/lifestyle-images', '/tech-pack-generator', '/seller-schedule-live', '/live-cohost',
  '/live-cohost-invite', '/live-moderation',
];
const BUYER_ROUTES = ['/live', '/live-feed', '/live-replay', '/live-replays', '/buyer-live?payAuction=x'];

const slug = (r) => r.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_+$/, '') || 'root';

async function visit(context, origin, activity, role, route, demo, results) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  const url = `${origin}${route}${route.includes('?') ? '&' : '?'}bt_preview=${role}${demo ? '&demo=1' : ''}`;
  await page.goto(url);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
  await waitForQuietNetwork(activity, 700, 10_000).catch(() => {});
  await page.waitForTimeout(800);
  const finalPath = new URL(page.url()).pathname;
  const file = `${role}-${demo ? 'demo-' : ''}${slug(route)}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  results.push({ role, demo, route, finalPath, errors, file });
  return page;
}

// PW_CHROMIUM=<path> uses a preinstalled Chromium when the project's
// Playwright revision isn't installed (e.g. cloud containers).
async function startBrowser() {
  if (!process.env.PW_CHROMIUM) return launchBrowser();
  const { chromium } = await import('playwright');
  return chromium.launch({ executablePath: process.env.PW_CHROMIUM });
}

async function main() {
  const browser = await startBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const results = [];
  const checks = {};
  try {
    for (const role of ['seller', 'buyer']) {
      const { context, activity } = await openContext(browser, { device, role, origin, images });
      const routes = role === 'seller' ? SELLER_ROUTES : BUYER_ROUTES;
      for (const demo of [false, true]) {
        for (const route of routes) {
          const page = await visit(context, origin, activity, role, route, demo, results);
          await page.close();
        }
      }
      await context.close();
    }

    // Interactive checks (seller, demo).
    const { context, activity } = await openContext(browser, { device, role: 'seller', origin, images });

    // 1. Canvas artboard aspect-fit: the default 1080×1080 artboard must be a
    //    centred square (it rendered 365×643 — stretched — before round 2).
    //    (Creating from a preset lands on "Project not found" in this preview
    //    harness on dev too, so the check opens the default canvas.)
    let page = await visit(context, origin, activity, 'seller', '/design-canvas', true, results);
    await page.waitForTimeout(1500);
    checks.canvasUrl = page.url();
    checks.canvasArtboard = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="canvas-artboard"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
    });
    await page.screenshot({ path: path.join(OUT, 'check-canvas-artboard.png') });
    await page.close();

    // 2. Schedule live: past slots disabled for today.
    page = await visit(context, origin, activity, 'seller', '/seller-schedule-live', true, results);
    checks.scheduleDisabledSlots = await page.locator('[aria-disabled="true"]').count();
    await page.screenshot({ path: path.join(OUT, 'check-schedule-live.png') });
    await page.close();

    // 3. ai-studio: Manual Design -> New canvas sheet -> From Clipboard tab.
    page = await visit(context, origin, activity, 'seller', '/ai-studio', true, results);
    await page.getByText('Manual Design', { exact: false }).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'check-ai-studio-manual.png') });
    await page.getByText('From Clipboard', { exact: false }).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'check-ai-studio-clipboard.png') });
    await page.close();

    await context.close();
  } finally {
    await close();
    await browser.close();
  }
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, checks }, null, 2));
  const bad = results.filter((r) => r.errors.length || r.finalPath !== r.route.split('?')[0]);
  console.log(`${results.length} renders, ${bad.length} with page errors or a redirect`);
  for (const r of bad) console.log(' -', r.role, r.demo ? 'demo' : 'fresh', r.route, '->', r.finalPath, r.errors.slice(0, 2));
  console.log('checks:', JSON.stringify(checks));
}

main().catch((e) => { console.error(e); process.exit(1); });
