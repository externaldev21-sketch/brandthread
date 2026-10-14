#!/usr/bin/env node
/**
 * Shared-element product photo — filmstrip of tap-to-open (Saved grid →
 * product page) and Back (product page → Saved grid) at 393x852, plus the
 * frame rate of each morph, on the store-screenshots harness.
 *
 * Motion is on here (the harness defaults to reduced motion) and the real
 * clock is used so frame timing is honest. A second pass with reduced motion
 * shows the morph is skipped.
 *
 *   node scripts/shared-photo-screenshots.mjs --build <web export dir> --tag <before|after> [--measure]
 *
 * --measure takes no screenshots (they stall frames), only the morph frame rate.
 *
 * Output: docs/pr-assets/shared-photo/<tag>-*.jpg
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { IMAGE_HOST } from './store-screenshots/demo-data.mjs';
import {
  MOBILE_ROOT, WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BUILD = path.resolve(arg('build', path.join(WORK_DIR, 'web-build')));
const TAG = arg('tag', 'after');
const MEASURE = process.argv.includes('--measure');
const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/shared-photo');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const saved = (id, title, image, i) => ({
  id: `s${i}`, type: 'product', targetId: id, title, brand: 'NORTHLINE STUDIO',
  image: `${IMAGE_HOST}/demo/${image}.jpg`, priceCents: 9800, savedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
});
const SAVED = [
  saved('prod_nl_hoodie_ember', 'Heavyweight Hoodie — Ember', 'hoodie-ember', 1),
  saved('prod_nl_jacket_rust', 'Field Shell Jacket — Rust', 'jacket-rust', 2),
  saved('prod_nl_hoodie_bone', 'Heavyweight Hoodie — Bone', 'hoodie-bone', 3),
  saved('prod_nl_hoodie_moss', 'Heavyweight Hoodie — Moss', 'hoodie-moss', 4),
];
const TARGET = SAVED[1];

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

async function setup(browser, images, origin, reducedMotion) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const ctx = await openContext(browser, {
    device, role: 'buyer', origin, images, installClock: false, contextOptions: { reducedMotion },
  });
  await ctx.context.route((url) => url.pathname.endsWith('/buyer/saved'), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    return route.fulfill(json(origin, SAVED));
  });
  return ctx;
}

/** Counts animation frames while the overlay is on screen; returns { ms, frames, fps }. */
async function armFrameMeter(page) {
  await page.evaluate(() => {
    const w = window;
    w.__morph = { start: 0, end: 0, frames: 0 };
    const tick = () => {
      const on = !!document.querySelector('[data-testid="shared-photo-overlay"]');
      const m = w.__morph;
      if (on) { if (!m.start) m.start = performance.now(); m.frames++; m.end = performance.now(); }
      if (!m.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function readFrameMeter(page) {
  return page.evaluate(() => {
    const m = window.__morph; m.done = true;
    const ms = m.end - m.start;
    return { ms: Math.round(ms), frames: m.frames, fps: ms > 0 ? Math.round((m.frames - 1) / (ms / 1000)) : 0 };
  });
}

async function filmstrip(page, name, count, gapMs) {
  if (MEASURE) return;
  const t0 = Date.now();
  for (let i = 0; i < count; i++) {
    await page.screenshot({ path: path.join(OUT, `${TAG}-${name}-${i}.jpg`), type: 'jpeg', quality: 80 });
    console.log(`  ${name}-${i} @ ${Date.now() - t0}ms`);
    if (gapMs) await page.waitForTimeout(gapMs);
  }
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const label = reducedMotion === 'reduce' ? 'reduce-motion' : 'motion';
      const { context, page, activity } = await setup(browser, images, server.origin, reducedMotion);
      // A client-side push to this screen stays hidden behind Home in the
      // preview; a full load after the session is up shows it.
      await openScreen(page, activity, server.origin, 'buyer', '/(buyer)');
      await page.waitForTimeout(1500);
      await page.goto(`${server.origin}/buyer-saved?bt_preview=buyer`);
      await page.getByText(TARGET.title).first().waitFor({ timeout: 20_000 });
      await waitForQuietNetwork(activity); await waitForImages(page); await page.waitForTimeout(800);
      if (reducedMotion === 'no-preference' && !MEASURE) await page.screenshot({ path: path.join(OUT, `${TAG}-grid.jpg`), type: 'jpeg', quality: 86 });

      console.log(`[${label}] open`);
      await armFrameMeter(page);
      await page.getByLabel(TARGET.title, { exact: true }).first().tap();
      await filmstrip(page, `${label}-open`, reducedMotion === 'reduce' ? 1 : 5, 40);
      await page.getByRole('radio', { name: /^Size, / }).first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1500);
      console.log(`[${label}] open morph`, JSON.stringify(await readFrameMeter(page)));
      if (!MEASURE) await page.screenshot({ path: path.join(OUT, `${TAG}-${label}-pdp.jpg`), type: 'jpeg', quality: 86 });

      console.log(`[${label}] back`);
      await armFrameMeter(page);
      await page.getByLabel('Back to previous screen').first().tap();
      await filmstrip(page, `${label}-back`, reducedMotion === 'reduce' ? 1 : 4, 40);
      await page.waitForTimeout(1000);
      console.log(`[${label}] back morph`, JSON.stringify(await readFrameMeter(page)));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
