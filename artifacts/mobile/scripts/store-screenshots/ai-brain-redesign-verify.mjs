#!/usr/bin/env node
/**
 * Verifies the ai-brain.tsx empty-state redesign: single greeting (no
 * double greeting/Copy action), outline silver chips (no grey fills),
 * consistent spacing, tap-to-send, and no big empty band under the
 * composer (the FlatList flex:1 fix).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'ai-brain-redesign'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    await page.goto(`${origin}/ai-brain?bt_preview=seller`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await waitForQuietNetwork(activity, 600, 10_000);
    await page.waitForTimeout(500);
    await waitForImages(page, 6_000);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    console.log('=== empty state ===');
    console.log('visible text snippet:', bodyText.replace(/\s+/g, ' | ').slice(0, 400));
    await page.screenshot({ path: path.join(OUT, '01-empty-state.png') });

    // Tap the first suggestion chip — should send immediately, no dead
    // intermediate state where the composer just has text sitting in it.
    const chips = page.locator('text=/What should I focus on today\\?|How is my business performing\\?/');
    const chipCount = await chips.count();
    console.log('suggestion chip found:', chipCount > 0);
    if (chipCount > 0) {
      await chips.first().click();
      await page.waitForTimeout(1200);
      const afterTapText = await page.locator('body').innerText().catch(() => '');
      console.log('=== after tapping a suggestion ===');
      console.log('visible text snippet:', afterTapText.replace(/\s+/g, ' | ').slice(0, 400));
      await page.screenshot({ path: path.join(OUT, '02-after-suggestion-tap.png') });
    }

    await context.close();
  } finally {
    close();
    await browser.close();
  }
  console.log(`\nWrote screenshots to ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
