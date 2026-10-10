/**
 * Before/after captures (390x844) for the data-sync reviews PR:
 *  - app/product-store.tsx star row (was a hardcoded 4.8 (23));
 *  - app/seller-reviews.tsx stats strip (Avg rating / Total, was averaged on
 *    the client from the listed rows).
 * Each screen is shot for a fresh account (no reviews) and with &demo=1.
 *
 * The seller web preview never calls the API (lib/api.ts
 * rejectSellerPreviewApiRequest), so the demo pass shows the &demo=1 preview
 * fixtures (lib/previewReviews.ts) and the fresh pass the no-reviews state.
 *
 *   node scripts/store-screenshots/data-sync-reviews-screenshots.mjs <buildDir> <before|after> [outDir]
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  MOBILE_ROOT, WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { SELLER_PRODUCTS } from './demo-data.mjs';

const [buildDir, prefix = 'after', outArg] = process.argv.slice(2);
if (!buildDir) throw new Error('usage: <buildDir> <before|after> [outDir]');
const OUT = path.resolve(outArg ?? path.join(MOBILE_ROOT, 'docs/pr-review/data-sync-reviews'));
mkdirSync(OUT, { recursive: true });
const DEVICE = { viewport: { width: 390, height: 844 }, scale: 1, isMobile: true };
const PRODUCT = SELLER_PRODUCTS[0];
const DEMO_PRODUCT = { id: 'preview-product-2', name: 'Heavyweight Hoodie' }; // lib/previewSellerProducts.ts
async function open(browser, images, origin, mode, target) {
  const fresh = mode === 'fresh';
  const { context, page, activity } = await openContext(browser, {
    device: DEVICE, role: 'seller', origin, images,
    seedOptions: fresh ? { fresh: true } : {}, apiOptions: fresh ? { fresh: true } : {},
  });
  // A brand-new store with exactly one listing, so the product page has something to show.
  if (fresh) {
    await context.addInitScript((product) => {
      if (sessionStorage.getItem('bt:drs-seeded')) return;
      localStorage.setItem('@brandthread/products', JSON.stringify([product]));
      sessionStorage.setItem('bt:drs-seeded', '1');
    }, PRODUCT);
  }
  page.on('pageerror', (e) => console.log('  PAGEERROR', String(e).slice(0, 200)));
  const extraQuery = fresh ? '' : '&demo=1';
  for (let attempt = 0; attempt < 4; attempt++) {
    await openScreen(page, activity, origin, 'seller', target, { extraQuery });
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname === target.split('?')[0]) break;
  }
  // demo=1 is read from the URL when a screen mounts; the client-side push
  // above mounts it before the query lands, so reload the deep link itself.
  if (!fresh) {
    await page.goto(`${origin}${target}${target.includes('?') ? '&' : '?'}bt_preview=seller&demo=1`);
    await page.waitForTimeout(2500);
  }
  await waitForQuietNetwork(activity, 900, 15_000);
  await waitForImages(page);
  return { context, page };
}

async function need(page, locator, name) {
  try { await locator.first().waitFor({ timeout: 20_000 }); } catch (e) {
    await page.screenshot({ path: path.join(WORK_DIR, `fail-${prefix}-${name}.png`) });
    throw e;
  }
}

/** Every visible text node that is clipped or wider than its box. */
async function overflowing(page) {
  return page.evaluate(() => [...document.querySelectorAll('div,span')]
    .filter((el) => el.children.length === 0 && el.textContent.trim() && el.offsetParent !== null)
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible')
    .map((el) => el.textContent.trim().slice(0, 60)));
}

async function main() {
  const server = await serveBuild(path.resolve(buildDir));
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const mode of ['fresh', 'demo']) {
      // Fresh: the store's one seeded listing. Demo: the app's own &demo=1 catalogue.
      const product = mode === 'fresh' ? PRODUCT : DEMO_PRODUCT;
      // The local catalogue loads after sign-in settles; a screen that mounted
      // first shows "not found", so reopen until it mounts with the product.
      let s;
      for (let attempt = 1; ; attempt++) {
        s = await open(browser, images, server.origin, mode, `/product-store?id=${encodeURIComponent(product.id)}`);
        try {
          await s.page.getByText(product.name, { exact: true }).first().waitFor({ timeout: 10_000 });
          break;
        } catch (e) {
          await s.context.close();
          if (attempt === 4) throw e;
        }
      }
      // Bring the product info (name, price, stock, stars) up under the header.
      await s.page.getByText(product.name, { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await s.page.waitForTimeout(600);
      await s.page.screenshot({ path: path.join(OUT, `${prefix}-product-store-${mode}.png`) });
      console.log(`  ok ${prefix}-product-store-${mode}`, 'overflow:', await overflowing(s.page));
      await s.context.close();

      s = await open(browser, images, server.origin, mode, '/seller-reviews');
      await need(s.page, s.page.getByText('My Reviews'), `reviews-${mode}`);
      if (mode === 'demo' && prefix === 'after') await need(s.page, s.page.getByText('Avg rating'), `reviews-${mode}-stats`);
      await s.page.waitForTimeout(600);
      await s.page.screenshot({ path: path.join(OUT, `${prefix}-seller-reviews-${mode}.png`) });
      console.log(`  ok ${prefix}-seller-reviews-${mode}`, 'overflow:', await overflowing(s.page));
      await s.context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
