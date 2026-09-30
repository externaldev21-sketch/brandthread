#!/usr/bin/env node
/**
 * Verification screenshots (393x852) for the owner-vs-visitor profile split:
 *   01 seller profile, OWNER view              (role seller)
 *   02 seller profile, owner "..." menu        (View as visitor)
 *   03 seller profile, VISITOR preview         (owner -> View as visitor)
 *   04 seller profile as seen by a BUYER       (role buyer) + Products + Tagged tabs
 *   05 buyer profile, OWNER view               (role buyer)
 *   06 buyer profile as seen by OTHERS         (role seller viewing a buyer)
 *   07 product quick-buy from the seller's profile
 *
 *   node scripts/profile-owner-visitor-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/profile-owner-visitor/*.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, serveBuild,
  waitForImages, waitForQuietNetwork, DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUT = path.resolve(MOBILE_ROOT, 'docs', 'pr-review', 'profile-owner-visitor');
mkdirSync(OUT, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

/**
 * Boots the signed-in demo session, then drops the dev-preview flag so the
 * screens run their REAL code path (owner vs visitor by ids, real API client)
 * against the harness's fake API instead of the signed-out preview shortcut.
 */
async function open(page, activity, origin, role, target) {
  await page.goto(`${origin}/?bt_preview=${role}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 800, 15_000);
  await page.waitForTimeout(3000);
  await page.evaluate(() => { localStorage.removeItem('user_role'); });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, target);
    await page.waitForTimeout(1200);
    const here = target.split('?')[0];
    if (await page.evaluate((h) => location.pathname === h && document.querySelectorAll('[data-testid]').length > 2, here)) return;
  }
}

async function settle(page, activity) {
  await page.waitForTimeout(900);
  await waitForImages(page);
  await waitForQuietNetwork(activity, 600, 8000);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log('  saved', name);
}

/** Visible text of the screen, used to assert what a mode does / does not show. */
async function visibleText(page) {
  return page.evaluate(() => document.body.innerText);
}

function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) process.exitCode = 1;
}

async function session(browser, origin, images, role, fn) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role, origin, images });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message.split('\n')[0]));
  try {
    await fn({ page, activity, errors });
  } catch (error) {
    console.log('  FAILED:', String(error.message).split('\n')[0], '| at', await page.evaluate(() => location.pathname + location.search));
    console.log('  page text:', (await visibleText(page)).replace(/\s+/g, ' ').slice(0, 300));
    await shot(page, `FAILED-${role}`).catch(() => {});
    process.exitCode = 1;
  } finally { await context.close(); }
  if (errors.length) console.log('  (page errors:', errors.slice(0, 3).join(' | '), ')');
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    // ── Seller owner ────────────────────────────────────────────────────────
    await session(browser, origin, images, 'seller', async ({ page, activity }) => {
      console.log('\nseller owner');
      await open(page, activity, origin, 'seller', '/profile');
      await page.getByTestId('profile-hero').waitFor({ state: 'attached', timeout: 60000 });
      await settle(page, activity);
      const text = await visibleText(page);
      check('owner sees plan chip', /Plan/.test(text));
      check('owner sees Professional dashboard', text.includes('Professional dashboard'));
      check('owner sees Edit', /Edit/.test(text));
      await shot(page, '01-seller-owner');

      await page.getByTestId('seller-profile-more').click();
      await page.waitForTimeout(500);
      check('owner menu has View as visitor', (await visibleText(page)).includes('View as visitor'));
      await shot(page, '02-seller-owner-menu');

      await page.getByTestId('profile-menu-sheet-view-as-visitor').click();
      await page.getByTestId('seller-profile-visitor-preview').waitFor({ state: 'attached', timeout: 60000 });
      await settle(page, activity);
      const preview = await visibleText(page);
      check('preview hides plan chip', !/(Free|Growth|Pro|Active) Plan/.test(preview));
      check('preview hides Professional dashboard', !preview.includes('Professional dashboard'));
      check('preview hides Edit profile', !preview.includes('Edit profile'));
      check('preview shows the visitor banner', preview.includes('viewing your profile as a visitor'));
      await shot(page, '03-seller-visitor-preview');
    });

    // ── Seller as seen by a buyer ───────────────────────────────────────────
    await session(browser, origin, images, 'buyer', async ({ page, activity }) => {
      console.log('\nseller as seen by a buyer');
      await open(page, activity, origin, 'buyer', '/seller-profile?id=user_northline');
      await page.getByTestId('seller-profile-hero').waitFor({ state: 'attached', timeout: 60000 });
      await settle(page, activity);
      const text = await visibleText(page);
      check('visitor sees seller name', text.includes('Northline Studio'));
      check('visitor sees NO plan chip', !/(Free|Growth|Pro|Active) Plan/.test(text));
      check('visitor sees NO dashboard', !text.includes('Professional dashboard'));
      check('visitor sees NO Edit profile', !text.includes('Edit profile'));
      check('visitor sees Message', text.includes('Message'));
      await shot(page, '04-seller-visited-by-buyer-posts');

      await page.getByTestId('profile-tab-shop').click();
      await page.getByTestId('profile-product-tile-prod_nl_hoodie_ember').waitFor({ timeout: 30000 }).catch(() => {});
      await settle(page, activity);
      await shot(page, '05-seller-visited-by-buyer-products');

      await page.getByTestId('profile-tab-tagged').click();
      await settle(page, activity);
      await shot(page, '06-seller-visited-by-buyer-tagged');

      await page.getByTestId('profile-tab-shop').click();
      await settle(page, activity);
      await page.locator('[data-testid^="profile-product-tile-"]').first().click();
      await page.waitForTimeout(1500);
      await settle(page, activity);
      const pdp = await visibleText(page);
      check('product page offers Add to cart + purchase action', /Add to cart/i.test(pdp) && /(Buy now|Select options)/i.test(pdp));
      await shot(page, '07-product-quick-buy-from-profile');
    });

    // ── Buyer owner ─────────────────────────────────────────────────────────
    await session(browser, origin, images, 'buyer', async ({ page, activity }) => {
      console.log('\nbuyer owner');
      await open(page, activity, origin, 'buyer', '/profile');
      await page.getByTestId('buyer-profile').waitFor({ state: 'attached', timeout: 60000 });
      await settle(page, activity);
      const text = await visibleText(page);
      check('buyer owner sees Edit profile', text.includes('Edit profile'));
      await shot(page, '08-buyer-owner');
      await page.getByTestId('profile-tab-orders').click();
      await settle(page, activity);
      await shot(page, '09-buyer-owner-orders-private-tab');
    });

    // ── Buyer as seen by others ─────────────────────────────────────────────
    await session(browser, origin, images, 'seller', async ({ page, activity }) => {
      console.log('\nbuyer as seen by others');
      await open(page, activity, origin, 'seller', '/buyer-other-profile?userId=user_jordan');
      await page.getByTestId('buyer-other-profile').waitFor({ state: 'attached', timeout: 60000 });
      await settle(page, activity);
      const text = await visibleText(page);
      check('visitor sees buyer name + @username', text.includes('Jordan Reyes') && text.includes('@jordanreyes'));
      for (const hidden of ['Orders', 'Saved', 'Liked', 'Thread Cash', 'Addresses', 'Payment', 'Edit profile']) {
        check(`visitor sees NO "${hidden}"`, !text.includes(hidden));
      }
      await shot(page, '10-buyer-as-seen-by-others');
      await page.getByTestId('profile-tab-tagged').click();
      await settle(page, activity);
      await shot(page, '11-buyer-as-seen-by-others-tagged');
    });
  } finally {
    await browser.close();
    close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
