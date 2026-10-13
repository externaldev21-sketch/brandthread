#!/usr/bin/env node
/**
 * Less-AI pass, session 4 (motion, native feel, forms): before/after captures
 * at 390x844 on the web preview (signed-in demo harness, fake API, demo=1).
 *
 *   node scripts/less-ai-s4-screenshots.mjs <build-dir> <out-dir> <shot-set>
 *
 * <build-dir> is a `buildPreviewWeb` export (run once on dev for "before",
 * once on the branch for "after"). <shot-set> picks which SHOTS group runs.
 * Motion shots capture a short frame strip (ms after the gesture) so a
 * still PNG can show what moved.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { launchBrowser, openContext, openScreen, serveBuild, waitForImages } from './store-screenshots/harness.mjs';

const [buildDir, outDir, set] = process.argv.slice(2);
if (!buildDir || !outDir || !set) {
  console.error('usage: less-ai-s4-screenshots.mjs <build-dir> <out-dir> <shot-set>');
  process.exit(1);
}

const DEVICE = {
  viewport: { width: 390, height: 844 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

/** Mouse press/release: the web preview's Pressables answer pointer events,
 *  and Chromium's synthetic touch taps don't reach the feed's tap handler. */
async function tap(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
}

/** Frames taken `ms` after `act()` resolves, named `<name>-<ms>ms`. */
async function strip(page, name, act, frames) {
  const t0 = Date.now();
  await act();
  for (const ms of frames) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(outDir, `${name}-${ms}ms.png`) });
  }
  console.log(`  ✓ ${name} (${frames.join('/')}ms)`);
}

async function still(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

const SHOTS = {
  motion: [
    {
      role: 'buyer', target: '/', name: 'feed-double-tap',
      run: (page) => strip(page, 'feed-double-tap', async () => {
        await tap(page, 110, 300);
        await page.waitForTimeout(120);
        await tap(page, 110, 300);
      }, [60, 200, 700]),
    },
    {
      role: 'buyer', target: '/', name: 'feed-rail-like',
      run: async (page) => {
        const like = page.locator('[data-testid^="like-btn-"]').first();
        await like.waitFor({ timeout: 15_000 });
        const box = await like.boundingBox();
        await strip(page, 'feed-rail-like', () => tap(page, box.x + box.width / 2, box.y + box.height / 2), [60, 160, 500]);
      },
    },
    {
      role: 'buyer', target: '/', name: 'feed-rail-save',
      run: async (page) => {
        const save = page.locator('[data-testid^="save-btn-"]').first();
        await save.waitFor({ timeout: 15_000 });
        const box = await save.boundingBox();
        await strip(page, 'feed-rail-save', () => tap(page, box.x + box.width / 2, box.y + box.height / 2), [60, 160, 500]);
      },
    },
    {
      role: 'seller', target: '/', name: 'seller-dashboard-hero',
      run: (page) => strip(page, 'seller-dashboard-hero', async () => {
        // Frames start the moment the hero's data has landed.
        await page.waitForFunction(() => /\$\d/.test(document.body.innerText), undefined, { timeout: 20_000 });
      }, [0, 200, 1000]),
      fresh: true,
    },
  ],
};

async function run() {
  const shots = SHOTS[set];
  if (!shots) throw new Error(`unknown shot set ${set}`);
  mkdirSync(outDir, { recursive: true });
  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(path.dirname(buildDir), 'demo-images'));
  try {
    for (const shot of shots) {
      const { context, page, activity } = await openContext(browser, {
        device: DEVICE, role: shot.role, origin: server.origin, images,
        contextOptions: { reducedMotion: 'no-preference', hasTouch: false, isMobile: false },
        // Real clock for motion frames: the fake clock paces animations.
        installClock: set !== 'motion',
      });
      try {
        await openScreen(page, activity, server.origin, shot.role, shot.target, { extraQuery: '&demo=1' });
        if (!shot.fresh) {
          await page.waitForTimeout(1500);
          await waitForImages(page).catch(() => {});
        }
        await shot.run(page);
      } catch (error) {
        console.error(`  ✗ ${shot.name}: ${error.message}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
