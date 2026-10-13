#!/usr/bin/env node
/**
 * Discover "less AI" pass (For You masonry, Brands tiles, People rows, Drops
 * cards, Trending now, section headers, video duration) — captures every
 * Discover tab on the store-screenshots harness (signed-in demo buyer, fake
 * API) from a static web export.
 *
 *   node scripts/discover-less-ai-screenshots.mjs <buildDir> <prefix> [width] [height]
 *
 * Writes <prefix>-<tab>.png into docs/pr-review/less-ai-discover/ and prints
 * a few layout measurements (masonry column x-positions, tile sizes).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const BUILD = path.resolve(process.argv[2]);
const PREFIX = process.argv[3] ?? 'after';
const VIEWPORT = { width: Number(process.argv[4] ?? 390), height: Number(process.argv[5] ?? 844) };
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/less-ai-discover');
mkdirSync(OUT, { recursive: true });

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
    const { page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
    page.setDefaultNavigationTimeout(240_000);
    await openScreen(page, activity, server.origin, 'buyer', '/(buyer)/discover');
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await page.getByTestId('discover-filter-row').first().waitFor({ timeout: 12_000 });
        break;
      } catch (error) {
        if (attempt === 5) {
          await page.screenshot({ path: path.join(OUT, `${PREFIX}-debug.png`) });
          throw error;
        }
        await page.evaluate(() => { history.pushState(history.state, '', '/discover?bt_preview=buyer'); dispatchEvent(new PopStateEvent('popstate')); });
      }
    }
    await waitForQuietNetwork(activity, 900, 20_000);
    await waitForImages(page);
    await page.waitForTimeout(1200);

    const shot = async (name) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${PREFIX}-${name}.png`) });
      console.log(`  saved ${PREFIX}-${name}.png`);
    };
    const scrollList = async (y) => {
      await page.evaluate((dy) => {
        const scrollers = [...document.querySelectorAll('div')].filter((el) => {
          const s = getComputedStyle(el);
          return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10;
        });
        const main = scrollers.sort((a, b) => b.clientHeight - a.clientHeight)[0];
        if (main) main.scrollTop = dy;
      }, y);
      await waitForImages(page);
      await page.waitForTimeout(500);
    };

    await shot('1-for-you');
    const masonry = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-testid^="discover-tile-"]')]
        .filter((el) => !el.dataset.testid.startsWith('discover-tile-video'))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0);
      return {
        tiles: tiles.length,
        columnsX: [...new Set(tiles.map((r) => Math.round(r.left)))],
        widths: [...new Set(tiles.map((r) => Math.round(r.width)))],
        heights: tiles.slice(0, 8).map((r) => Math.round(r.height)),
        trendingNow: !!document.querySelector('[data-testid="discover-trending-now"]'),
      };
    });
    console.log('  for you:', JSON.stringify(masonry));
    await scrollList(700);
    await shot('2-for-you-scrolled');
    await scrollList(1500);
    await shot('3-for-you-scrolled-more');
    await scrollList(0);

    for (const [key, name] of [['brands', '4-brands'], ['people', '5-people'], ['drops', '6-drops']]) {
      await page.getByTestId(`discover-filter-${key}`).first().click();
      await waitForQuietNetwork(activity, 900, 20_000);
      await waitForImages(page);
      await page.waitForTimeout(900);
      await shot(name);
    }
    await page.getByTestId('discover-filter-fits').first().click();
    await waitForQuietNetwork(activity, 900, 20_000);
    await waitForImages(page);
    await page.waitForTimeout(900);
    await shot('7-fits');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
