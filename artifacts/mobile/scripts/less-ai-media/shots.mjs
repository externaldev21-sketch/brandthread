#!/usr/bin/env node
/**
 * Before/after screenshots for the less-AI "Photos & media" pass (items
 * 46-55), at 390×844 on the store-screenshots harness (signed-in demo
 * account, fake API, demo photography).
 *
 *   node scripts/less-ai-media/shots.mjs <buildDir> <outDir> <prefix> <set>
 *
 * <buildDir> is a web export made with harness.mjs buildPreviewWeb();
 * <set> picks the screens (see SETS). One demo photo ('hoodie-bone') is
 * served as a 404 so the broken-photo fallback is visible.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from '../store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from '../store-screenshots/harness.mjs';

const [buildDir, outDir, prefix = 'after', setName = 'photos'] = process.argv.slice(2);
if (!buildDir || !outDir) {
  console.error('usage: shots.mjs <buildDir> <outDir> <prefix> <set>');
  process.exit(1);
}
const OUT = path.resolve(outDir);
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };
const BROKEN = new Set(['hoodie-bone']);

const scrollBy = (y) => async (page) => {
  await page.mouse.move(195, 500);
  await page.mouse.wheel(0, y);
  await page.waitForTimeout(900);
};
const tapText = (re) => async (page) => {
  await page.getByText(re).first().click();
  await page.waitForTimeout(1200);
};

export const SETS = {
  photos: [
    { name: '01-product-page', role: 'buyer', target: '/buyer-product-detail?productId=prod_nl_hoodie_ember', expect: /Heavyweight Hoodie/ },
    { name: '02-product-page-no-photo', role: 'buyer', target: '/buyer-product-detail?productId=prod_nl_hoodie_bone', expect: /Heavyweight Hoodie/ },
    { name: '03-bag', role: 'buyer', target: '/cart', expect: /^Cart \(\d+\)$/ },
    { name: '04-discover', role: 'buyer', target: '/discover', after: scrollBy(700) },
    { name: '05-seller-products', role: 'seller', target: '/products', expect: /Heavyweight Hoodie/ },
  ],
};

async function run() {
  const shots = SETS[setName];
  if (!shots) throw new Error(`unknown set ${setName}`);
  const server = await serveBuild(path.resolve(buildDir));
  const browser = await launchBrowser();
  const all = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const images = Object.fromEntries(Object.entries(all).filter(([name]) => !BROKEN.has(name)));
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  try {
    for (const shot of shots) {
      const { context, page, activity } = await openContext(browser, { device, role: shot.role, origin: server.origin, images });
      page.setDefaultNavigationTimeout(240_000);
      try {
        await openScreen(page, activity, server.origin, shot.role, shot.target, { extraQuery: shot.query ?? '' });
        const url = `${shot.target}${shot.target.includes('?') ? '&' : '?'}bt_preview=${shot.role}${shot.query ?? ''}`;
        for (let attempt = 0; attempt < 6; attempt++) {
          const pathOk = await page.evaluate((p) => location.pathname === p, shot.target.split('?')[0]);
          const textOk = !shot.expect || await page.getByText(shot.expect).first().isVisible().catch(() => false);
          if (pathOk && textOk) break;
          await page.waitForTimeout(1500);
          await page.evaluate((u) => { history.pushState(history.state, '', u); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, url);
          await page.waitForTimeout(2500);
        }
        await waitForQuietNetwork(activity, 900, 20_000);
        await page.waitForTimeout(2500);
        await waitForImages(page);
        if (shot.after) await shot.after(page);
        await waitForImages(page);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUT, `${prefix}-${shot.name}.png`) });
        console.log(`  ✓ ${prefix}-${shot.name}`);
      } catch (error) {
        console.log(`  ✗ ${prefix}-${shot.name}: ${error.message.split('\n')[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
