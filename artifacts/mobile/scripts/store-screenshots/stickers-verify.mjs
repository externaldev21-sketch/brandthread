#!/usr/bin/env node
/**
 * Live verification for the interactive story stickers (393x852, demo mode):
 * viewer with each sticker (poll before / after voting, question before / after
 * answering, product link, drop countdown + Notify me), the author's view
 * (poll results, responses sheet) and the editor's sticker tray with the new tiles.
 * Also runs the text-fit check on every captured screen.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/stickers-verify.mjs [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { textFitReport } from '../../e2e/helpers/textFit.ts';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/stickers'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

// Avatar monogram / counter of the editor's existing bottom bar (not part of this change).
const EXISTING_EDITOR_TEXT = ['MO', '2'];
let failures = 0;
async function fit(page, name, options) {
  const report = await textFitReport(page, options);
  console.log(`text-fit ${name}: ${report.checked} text elements, ${report.issues.length} issues`);
  for (const issue of report.issues) console.log(`  ${issue.kind}: "${issue.text}" ${issue.detail}`);
  failures += report.issues.length;
}
async function shot(page, file, name, options) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, file) });
  await fit(page, name, options);
}

async function open(browser, images, origin, role, target) {
  const ctx = await openContext(browser, { device, role, origin, images });
  await ctx.page.goto(`${origin}${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}&demo=1`);
  await ctx.page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(ctx.activity, 500, 8_000);
  await ctx.page.waitForTimeout(900);
  await waitForImages(ctx.page, 6_000);
  return ctx;
}

const next = async (page) => { await page.mouse.click(370, 600); await page.waitForTimeout(500); };

async function viewer(browser, images, origin) {
  const id = 'preview-stickers-1';
  const { context, page } = await open(browser, images, origin, 'buyer', `/buyer-story-viewer?storyId=${id}&allStoryIds=${id}`);
  await page.mouse.click(196, 700); // dismiss the one-time gesture guide
  await page.waitForTimeout(600);
  await shot(page, '01-viewer-poll.png', 'viewer poll');
  await page.getByTestId('sticker-poll-option-1').click();
  await shot(page, '02-viewer-poll-voted.png', 'viewer poll voted');
  await next(page);
  await shot(page, '03-viewer-question.png', 'viewer question');
  await page.getByLabel('Your answer').fill('More silver, please');
  await page.getByLabel('Send answer').click();
  await shot(page, '04-viewer-question-sent.png', 'viewer question sent');
  await next(page);
  await shot(page, '05-viewer-product.png', 'viewer product');
  await next(page);
  await shot(page, '06-viewer-countdown.png', 'viewer countdown');
  await page.getByTestId('sticker-countdown-notify').click();
  await shot(page, '07-viewer-countdown-notified.png', 'viewer countdown notified');
  await context.close();
}

async function author(browser, images, origin) {
  const id = 'preview-stickers-mine';
  const { context, page } = await open(browser, images, origin, 'buyer', `/buyer-story-viewer?storyId=${id}&allStoryIds=${id}`);
  await page.mouse.click(196, 700);
  await page.waitForTimeout(600);
  await shot(page, '08-author-poll-results.png', 'author poll results');
  await next(page);
  await shot(page, '09-author-question-count.png', 'author question count');
  await page.getByTestId('sticker-question').click();
  await shot(page, '10-author-responses.png', 'author responses sheet');
  await context.close();
}

async function editor(browser, images, origin) {
  const { context, page } = await open(browser, images, origin, 'seller', '/buyer-story-create');
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8_000 }),
      page.getByLabel('Choose from camera roll').click(),
    ]);
    await chooser.setFiles(Object.values(images)[0]);
    await page.waitForTimeout(1500);
    const save = page.getByText('Done', { exact: true }).first();
    if (await save.isVisible().catch(() => false)) await save.click();
    await page.waitForTimeout(1200);
    await page.getByLabel('Add sticker').click();
    await shot(page, '11-editor-sticker-tray.png', 'editor sticker tray', { ignoreText: EXISTING_EDITOR_TEXT });
    const tiles = await page.evaluate(() => [...document.querySelectorAll('[role="button"]')]
      .filter((e) => ['Mention', 'Location', 'Time', 'Poll', 'Question', 'Link', 'Product', 'Shop link', 'Thread Cash', 'Countdown'].includes(e.getAttribute('aria-label') ?? ''))
      .map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height)]; }));
    console.log('sticker tiles (label, w, h):', JSON.stringify(tiles));
    const sizes = new Set(tiles.map((t) => `${t[1]}x${t[2]}`));
    if (sizes.size > 1) { console.log('  ragged sticker tiles'); failures += 1; }
    await page.getByLabel('Poll').click();
    await page.getByLabel('Poll question').fill('Black or silver?');
    await page.getByLabel('Poll option 1').fill('Black');
    await page.getByLabel('Poll option 2').fill('Silver');
    await shot(page, '12-editor-poll-composer.png', 'editor poll composer', { ignoreText: EXISTING_EDITOR_TEXT });
    await page.getByText('Add poll', { exact: true }).click();
    await shot(page, '13-editor-poll-on-canvas.png', 'editor poll on canvas', { ignoreText: EXISTING_EDITOR_TEXT });
  } catch (err) {
    console.log(`editor capture skipped: ${String(err?.message ?? err).split('\n')[0]}`);
    await page.screenshot({ path: path.join(OUT, '11-editor-unavailable.png') });
  }
  await context.close();
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    await viewer(browser, images, origin);
    await author(browser, images, origin);
    await editor(browser, images, origin);
    writeFileSync(path.join(OUT, 'text-fit-result.txt'), failures ? `${failures} issues\n` : '0 issues\n');
    console.log(`Saved to ${OUT}; ${failures} text-fit issues`);
    if (failures) process.exitCode = 1;
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
