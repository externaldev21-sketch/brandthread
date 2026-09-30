#!/usr/bin/env node
/**
 * Live verification for claude/dm-seller-tools at 393x852 against the
 * seller preview (no network: the new screens skip protected calls in
 * preview, so edits here are local-only).
 *
 *   node scripts/dm-seller-tools-screenshots.mjs [--skip-build]
 *
 * Output: <repo>/docs/pr-assets/claude/dm-seller-tools/*.png
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/claude/dm-seller-tools');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function shot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ok ${name}`);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
    // Inbox "+" menu
    await openScreen(page, activity, origin, 'seller', '/seller-inbox');
    await waitForQuietNetwork(activity, 500, 8000);
    await page.waitForTimeout(2500);
    await page.getByLabel('Create or join a group').first().click({ timeout: 60000 });
    await page.getByText('Quick replies').first().waitFor({ timeout: 10_000 });
    await shot(page, '01-inbox-plus-menu');
    await page.getByText('Quick replies').first().click();

    // Quick replies: empty -> editor -> list
    await page.getByText('No quick replies').first().waitFor({ timeout: 10_000 });
    await shot(page, '02-quick-replies-empty');
    await page.getByText('New quick reply').first().click();
    await page.getByTestId('quick-reply-shortcut').fill('shipping');
    await page.getByTestId('quick-reply-title').fill('Shipping times');
    await page.getByTestId('quick-reply-body').fill('Orders ship within 2 business days. You will get a tracking link as soon as it leaves.');
    await shot(page, '03-quick-reply-editor');
    await page.getByTestId('quick-reply-save').click();
    await page.getByText('Shipping times').first().waitFor({ timeout: 10_000 });
    await shot(page, '04-quick-replies-list');

    // Away message
    await openScreen(page, activity, origin, 'seller', '/away-message');
    await page.getByText('Send away message').first().waitFor({ timeout: 10_000 });
    await shot(page, '05-away-message-always');
    await page.getByText('Outside hours').first().click();
    await page.mouse.move(200, 600);
    await page.mouse.wheel(0, 600);
    await shot(page, '06-away-message-outside-hours');

    // Seller conversation: attach sheet -> Quick replies picker
    await openScreen(page, activity, origin, 'seller', '/seller-conversation?id=preview-conversation-01');
    await waitForQuietNetwork(activity, 500, 8000);
    await page.waitForTimeout(800);
    const plus = page.getByLabel(/attach|add/i).first();
    if (await plus.count()) {
      await plus.click();
      await page.getByText('Quick replies').first().waitFor({ timeout: 8000 });
      await shot(page, '07-attach-sheet-quick-replies-row');
      await page.getByTestId('seller-conversation-quick-replies-row').click();
      await page.getByText('Manage quick replies').first().waitFor({ timeout: 8000 });
      await shot(page, '08-quick-replies-picker');
    } else {
      console.warn('  ! could not find the attach button by label; conversation shots skipped');
      await shot(page, '07-seller-conversation');
    }
    await context.close();
  } finally {
    await browser.close();
    await close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
