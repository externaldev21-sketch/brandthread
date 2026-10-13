#!/usr/bin/env node
/**
 * Verification for Discover's in-place search: drives the local Expo web
 * preview (`expo start --web --port <N>`, ?bt_preview=buyer&demo=1 so no
 * Clerk session or backend is needed) through tap → focused empty state →
 * typing → results → Cancel, saving a screenshot per step and a video of the
 * open/close animation.
 *
 *   node scripts/discover-search-screenshots.mjs --port <N> [--out <dir>] [--w 390 --h 844] [--prefix before|after]
 *   (--prefix before captures the old pushed /buyer-search flow from a dev checkout)
 *
 * Output: docs/pr-assets/discover-search/<w>x<h>/*.png (+ open-close.webm)
 */
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const PORT = arg('port', '8099');
const W = Number(arg('w', '390'));
const H = Number(arg('h', '844'));
const PREFIX = arg('prefix', 'after');
const OUT = arg('out', path.join(ROOT, `../../docs/pr-assets/discover-search/${W}x${H}`));
const ORIGIN = `http://localhost:${PORT}`;

async function shot(page, name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-${name}.png`) });
  console.log(`  saved ${PREFIX}-${name}`);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const videoDir = path.join(OUT, '.video');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark',
      recordVideo: { dir: videoDir, size: { width: W, height: H } },
    });
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/discover?bt_preview=buyer&demo=1&bt_capture=1`, { waitUntil: 'load', timeout: 240000 });
    await page.waitForTimeout(15000);
    // The placeholder Clerk key cannot load Clerk JS; hide Expo's dev error overlay for good.
    await page.addStyleTag({ content: '#error-overlay,#error-toast{display:none!important;pointer-events:none!important}' });
    await page.getByTestId('discover-search-bar').first().waitFor({ timeout: 60000 });
    await shot(page, '1-discover');

    await page.getByTestId('discover-search-bar').first().click();
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-2a-opening-midframe.png`) });
    await page.waitForTimeout(4000);
    await shot(page, '2-focused-empty');

    // Seed two recents so the Recent section shows, then come back to the empty state.
    if (PREFIX === 'before') {
      // Old flow: the bar pushed the separate /buyer-search page.
      await page.waitForTimeout(1500);
      await shot(page, '2-pushed-search-page');
      const oldField = page.getByTestId('buyer-search-field').first();
      await oldField.click();
      await page.waitForTimeout(800);
      await shot(page, '3-focused');
      await oldField.pressSequentially('coat', { delay: 60 });
      await page.waitForTimeout(3000);
      await shot(page, '4-typing');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
      await shot(page, '5-results');
      await ctx.close();
      return;
    }
    const field = page.getByTestId('buyer-search-field').first();
    if (await field.count()) {
      for (const term of ['wool coat', 'silver dress']) {
        await field.fill(term);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(600);
      }
      await field.fill('');
      await page.waitForTimeout(500);
      await shot(page, '3-focused-recents');

      await field.pressSequentially('coat', { delay: 60 });
      await page.waitForTimeout(3000);
      await shot(page, '4-typing-suggestions');

      await page.keyboard.press('Enter');
      await page.waitForTimeout(900);
      await shot(page, '5-results-top');
      for (const tab of ['brands', 'products', 'fits']) {
        await page.getByTestId(`discover-search-tab-${tab}`).first().click();
        await page.waitForTimeout(500);
        await shot(page, `6-results-${tab}`);
      }

      await page.getByTestId('buyer-search-cancel').first().click();
      await page.waitForTimeout(120);
      await page.screenshot({ path: path.join(OUT, `${PREFIX}-7a-closing-midframe.png`) });
      await shot(page, '7-closed');

      // One more open/close for the recording.
      await page.getByTestId('discover-search-bar').first().click();
      await page.waitForTimeout(1200);
      await page.getByTestId('buyer-search-cancel').first().click();
      await page.waitForTimeout(1200);
    }
    await ctx.close();
    const vids = readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
    if (vids[0]) renameSync(path.join(videoDir, vids[0]), path.join(OUT, `${PREFIX}-open-close.webm`));
  } finally {
    await browser.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
