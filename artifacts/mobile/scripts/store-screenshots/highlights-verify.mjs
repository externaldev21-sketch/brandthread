#!/usr/bin/env node
/**
 * Live verification for Close Friends + story highlights (393x852, demo mode).
 * Captures: Highlights manager, its edit sheet with the new "Select stories"
 * row, the Select stories grid, and the highlight opened in the story viewer.
 * The other-profile highlights row needs a real backend (that screen has no
 * seeded "other person" in the preview), so it is not captured here.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/highlights-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { textFitReport } from '../../e2e/helpers/textFit.ts';

let failures = 0;
async function fit(page, name, options) {
  const report = await textFitReport(page, options);
  console.log(`text-fit ${name}: ${report.checked} text elements, ${report.issues.length} issues`);
  for (const issue of report.issues) console.log(`  ${issue.kind}: "${issue.text}" ${issue.detail}`);
  failures += report.issues.length;
}

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/highlights'));
mkdirSync(OUT, { recursive: true });

const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

const HIGHLIGHTS = [
  { id: 'hl_demo_1', emoji: '🔥', label: 'Drops', coverColor: '#1C1C1E', createdAt: '2026-09-01T10:00:00.000Z' },
  { id: 'hl_demo_2', emoji: '✨', label: 'Behind the scenes', coverColor: '#3A3A3C', createdAt: '2026-09-02T10:00:00.000Z' },
];

async function open(browser, images, origin, target) {
  const ctx = await openContext(browser, { device, role: 'buyer', origin, images });
  await ctx.context.addInitScript((value) => {
    if (!localStorage.getItem('bt:highlights:v1')) localStorage.setItem('bt:highlights:v1', value);
  }, JSON.stringify(HIGHLIGHTS));
  await ctx.page.goto(`${origin}${target}${target.includes('?') ? '&' : '?'}bt_preview=buyer&demo=1`);
  await ctx.page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(ctx.activity, 500, 8_000);
  await ctx.page.waitForTimeout(900);
  await waitForImages(ctx.page, 6_000);
  return ctx;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    let ctx = await open(browser, images, origin, '/buyer-highlights-manager');
    await ctx.page.screenshot({ path: path.join(OUT, '01-highlights-manager.png') });
    await fit(ctx.page, 'highlights-manager');
    await ctx.page.getByLabel('Edit Drops').first().click();
    await ctx.page.waitForTimeout(600);
    await ctx.page.screenshot({ path: path.join(OUT, '02-highlight-edit-select-stories.png') });
    await fit(ctx.page, 'highlight-edit-sheet');
    await ctx.context.close();

    ctx = await open(browser, images, origin, '/buyer-highlight-stories?highlightId=hl_demo_1');
    await ctx.page.screenshot({ path: path.join(OUT, '03-select-stories.png') });
    await fit(ctx.page, 'select-stories', { groupSelectors: ['[data-testid^="highlight-story-"]'] });
    await ctx.context.close();

    ctx = await open(browser, images, origin, '/buyer-story-viewer?highlightId=preview-highlight-1');
    await ctx.page.mouse.click(196, 426); // dismiss the one-time gesture guide
    await ctx.page.waitForTimeout(700);
    await ctx.page.screenshot({ path: path.join(OUT, '04-highlight-viewer.png') });
    await fit(ctx.page, 'highlight-viewer');
    await ctx.context.close();
    console.log(`Saved to ${OUT}`);
    if (failures) process.exitCode = 1;
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
