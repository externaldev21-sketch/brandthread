#!/usr/bin/env node
/**
 * Item 105 — live check of the checkout's express wallet button at 390×844.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo buyer,
 * fake API) onto /buyer-checkout and captures the Payment card:
 *   1. Chromium (no Apple Pay) → neutral, unbranded "Express checkout"
 *   2. Safari-with-Apple-Pay (window.ApplePaySession.canMakePayments() →
 *      true, injected) → "Buy with  Pay"
 *   3. A colored theme (Purple) → button stays pure white / black
 * and reads the button's computed fill, text colors and font family.
 *
 *   node scripts/wallet-button-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/wallet-button-105/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/wallet-button-105');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;

async function capture(browser, images, origin, { name, applePay = false, theme = null }) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  if (applePay) await page.addInitScript(() => { window.ApplePaySession = { canMakePayments: () => true }; });
  if (theme) {
    await page.addInitScript(([userId, themeId]) => {
      localStorage.setItem(`@brandthread/app-theme:v1:${userId}`, themeId);
      localStorage.setItem('@brandthread/app-theme:v1:guest', themeId);
    }, [BUYER_USER.id, theme]);
  }
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/buyer-checkout?source=cart', {
      beforeNavigate: () => page.evaluate(([key, value]) => localStorage.setItem(key, value), [CHECKOUT_KEY, JSON.stringify(checkoutSession())]),
    });
    try { await page.getByTestId('checkout-express-pay').waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  const btn = page.getByTestId('checkout-express-pay');
  await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500);
  const info = await btn.evaluate((el) => {
    // The white fill sits on the pressable's animated inner view.
    const nodes = [el, ...el.querySelectorAll('div')];
    const filled = nodes.find((n) => getComputedStyle(n).backgroundColor !== 'rgba(0, 0, 0, 0)');
    const texts = [...el.querySelectorAll('div')].filter((d) => d.children.length === 0 && /[A-Za-z]/.test(d.textContent));
    const r = el.getBoundingClientRect();
    return {
      label: el.getAttribute('aria-label'),
      fill: filled ? getComputedStyle(filled).backgroundColor : null,
      height: Math.round(r.height),
      text: texts.map((t) => ({ text: t.textContent, color: getComputedStyle(t).color, font: getComputedStyle(t).fontFamily.split(',')[0] })),
    };
  });
  console.log(`  ${name}:`, JSON.stringify(info));
  const box = await page.getByTestId('checkout-payment').boundingBox();
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 85, clip: { x: 0, y: Math.max(0, box.y - 8), width: VIEWPORT.width, height: Math.min(box.height + 16, VIEWPORT.height - box.y) } });
  await page.screenshot({ path: path.join(OUT, `${name}-full.jpg`), type: 'jpeg', quality: 80 });
  await context.close();
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    await capture(browser, images, server.origin, { name: '01-web-no-apple-pay' });
    await capture(browser, images, server.origin, { name: '02-web-safari-apple-pay', applePay: true });
    await capture(browser, images, server.origin, { name: '03-purple-theme-safari-apple-pay', applePay: true, theme: 'purple' });
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
