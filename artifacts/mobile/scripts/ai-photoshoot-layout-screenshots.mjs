#!/usr/bin/env node
/**
 * Verification screenshots (393x852) for the AI Photoshoot layout-bug
 * follow-up: top-of-screen and scrolled-down, both with a populated seller
 * catalog and with an empty one.
 *
 *   node scripts/ai-photoshoot-layout-screenshots.mjs [--skip-build]
 *
 * Output: docs/polish/screenshots/ai-photoshoot-layout-fixes/*.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, serveBuild,
  waitForImages, waitForQuietNetwork, DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUT = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'ai-photoshoot-layout-fixes');
mkdirSync(OUT, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

async function open(page, activity, origin) {
  await page.goto(`${origin}/?bt_preview=seller`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 800, 15_000);
  await page.waitForTimeout(1500);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, '/design-ai-photoshoot?bt_preview=seller');
    await page.waitForTimeout(1200);
    if (await page.evaluate(() => location.pathname === '/design-ai-photoshoot' && document.querySelectorAll('[data-testid]').length > 1)) return;
  }
  throw new Error('Failed to reach /design-ai-photoshoot');
}

async function settle(page, activity) {
  await page.waitForTimeout(700);
  await waitForImages(page);
  await waitForQuietNetwork(activity, 500, 8000);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log('  saved', name);
}

async function run(browser, images, emptyProducts, label) {
  const buildDir = DEFAULT_BUILD_DIR;
  const { origin, close } = await serveBuild(buildDir);
  try {
    const { context, page, activity } = await openContext(browser, {
      device: DEVICE, role: 'seller', origin, images,
      apiOptions: { emptyProducts },
    });
    try {
      await open(page, activity, origin);
      await settle(page, activity);
      await shot(page, `${label}-top`);
      await page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="screen-header"]')?.parentElement?.querySelector('div[style*="overflow"]');
        window.scrollTo(0, 0);
        document.querySelectorAll('*').forEach((el) => {
          if (el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 300) el.scrollTop = el.scrollHeight;
        });
      });
      await page.waitForTimeout(500);
      await shot(page, `${label}-scrolled`);
    } finally {
      await context.close();
    }
  } finally {
    await close();
  }
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  if (!skipBuild) buildPreviewWeb();
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    await run(browser, images, false, 'with-catalog');
    await run(browser, images, true, 'empty-catalog');
  } finally {
    await browser.close();
  }
  console.log('\nDone. Screenshots in', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
