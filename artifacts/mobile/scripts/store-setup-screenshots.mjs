#!/usr/bin/env node
/**
 * Screenshots for the store identity setup steps (name + handle, logo /
 * banner / accent with crop, social links) at 393x852 in seller preview mode,
 * saved to docs/pr-assets/store-identity-setup/.
 *
 *   node scripts/store-setup-screenshots.mjs        (SKIP_BUILD=1 reuses the last export)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'store-identity-setup');
mkdirSync(OUTPUT_DIR, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`) });
  console.log('  saved', name);
}


const fitIssues = [];

/** Flags clipped, truncated or escaping text on the current screen. */
async function checkTextFit(page, label) {
  const issues = await page.evaluate((viewportWidth) => {
    const found = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const text = el.textContent.trim().slice(0, 40);
      const style = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) found.push(`clipped: "${text}"`);
      if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) found.push(`ellipsis: "${text}"`);
      const parent = el.parentElement;
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (rect.left < pr.left - 1 || rect.right > pr.right + 1) found.push(`escapes parent: "${text}"`);
      }
      if (rect.right > viewportWidth + 1 || rect.left < -1) found.push(`outside viewport: "${text}"`);
    }
    return found;
  }, DEVICE.viewport.width);
  if (issues.length) fitIssues.push(...issues.map((i) => `[${label}] ${i}`));
  console.log(`  text fit ${label}: ${issues.length ? issues.join('; ') : 'clean'}`);
}

async function zoom(page, testId, name) {
  await page.getByTestId(testId).first().screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`) });
  console.log('  saved', name);
}

async function pickFile(page, triggerTestId, file) {
  await page.getByTestId(triggerTestId).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Choose from Library').click();
  await (await chooser).setFiles(file);
}

async function run() {
  if (!process.env.SKIP_BUILD) buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const errors = [];
  try {
    const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [console]', m.text().slice(0, 300)); });
    page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message.slice(0, 400)); });
    // A push that lands while the app is still settling its auth gate gets
    // bounced to "/", so retry from a fresh load until the route sticks.
    const open = async (route) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await openScreen(page, activity, origin, 'seller', route);
        await waitForQuietNetwork(activity, 500, 8000);
        await page.waitForTimeout(2500);
        if (page.url().includes(route)) return;
      }
      throw new Error(`Could not open ${route}`);
    };

    // 1. name + handle
    await open('/store-setup-name');
    await shot(page, '01-name-empty');
    await page.getByTestId('store-setup-name-input').fill('Night Owl Studio');
    await page.waitForTimeout(900);
    await shot(page, '02-name-available');
    await checkTextFit(page, 'name available');
    await zoom(page, 'store-setup-cta', '12-zoom-cta');
    await page.getByTestId('store-setup-handle-input').fill('admin');
    await page.waitForTimeout(900);
    await shot(page, '03-handle-taken');
    await checkTextFit(page, 'handle taken');
    await page.getByTestId('store-setup-handle-input').fill('ab');
    await page.waitForTimeout(900);
    await shot(page, '04-handle-invalid');
    await checkTextFit(page, 'handle invalid');

    // 2. logo + banner + accent
    await open('/store-setup-brand');
    await shot(page, '05-brand-empty');
    await checkTextFit(page, 'brand empty');
    await pickFile(page, 'store-setup-banner', images['look-mono']);
    await page.waitForTimeout(1200);
    await shot(page, '06-banner-crop');
    await checkTextFit(page, 'banner crop');
    await page.getByTestId('media-cropper-save').click();
    await page.waitForTimeout(1500);
    await pickFile(page, 'store-setup-logo', images['portrait-mono']);
    await page.waitForTimeout(1200);
    await shot(page, '07-logo-crop');
    await page.getByTestId('media-cropper-save').click();
    await page.waitForTimeout(1500);
    await page.getByTestId('store-setup-accent-C0C0C0').click();
    await waitForImages(page);
    await shot(page, '08-brand-filled');
    await checkTextFit(page, 'brand filled');
    await zoom(page, 'store-setup-swatches', '13-zoom-accent-swatches');
    await zoom(page, 'store-setup-logo', '14-zoom-logo-tile');

    // 3. socials
    await open('/store-setup-socials');
    await shot(page, '09-socials-empty');
    await page.getByTestId('store-setup-instagram-input').fill('@nightowlstudio');
    await page.getByTestId('store-setup-tiktok-input').fill('https://www.tiktok.com/@nightowlstudio?lang=en');
    await shot(page, '10-socials-valid');
    await checkTextFit(page, 'socials valid');
    await page.getByTestId('store-setup-tiktok-input').fill('https://evil.com/nightowl');
    await shot(page, '11-socials-rejected');
    await checkTextFit(page, 'socials rejected');
    await context.close();
  } finally {
    await browser.close();
    await close();
  }
  if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
  if (fitIssues.length) {
    console.log('Text fit issues:\n' + fitIssues.join('\n'));
    process.exitCode = 1;
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
