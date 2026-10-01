#!/usr/bin/env node
/**
 * Drives the rebuilt create flow in the web preview at 393×852 and saves a
 * screenshot of every step (capture → gallery → edit → post, THREAD and POST).
 *
 *   node scripts/store-screenshots/create-flow-verify.mjs <mediaDir> <outDir> [--role seller|buyer] [--skip-build]
 *
 * <mediaDir> needs: land1..4.jpg, port1..3.jpg, clip1.mp4 (any photos/video).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { DEFAULT_BUILD_DIR, buildPreviewWeb, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { findTextFitViolations } from './text-fit.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(n);
const roleArg = process.argv.includes('--role') ? process.argv[process.argv.indexOf('--role') + 1] : 'seller';
const [mediaDir, outDir] = args.filter((a) => a !== roleArg);
mkdirSync(outDir, { recursive: true });
const m = (f) => path.join(mediaDir, f);
const device = { id: 'iphone-393', viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };

if (!flag('--skip-build')) buildPreviewWeb();
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const log = [];
const fitIssues = [];
let n = 0;
async function shot(page, name) {
  n += 1;
  const file = path.join(outDir, `${String(n).padStart(2, '0')}-${name}.png`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  log.push(file);
  console.log('shot', file);
  const issues = await findTextFitViolations(page);
  for (const v of issues) { console.log(`  TEXTFIT ${name}: [${v.kind}] "${v.text}" — ${v.detail}`); fitIssues.push({ name, ...v }); }
}
/** Zoomed crop of one button group / card: the element itself, or its parent when `parent` is set. */
async function zoom(page, testId, name, { parent = false } = {}) {
  let loc = page.getByTestId(testId).first();
  if (parent) loc = loc.locator('..');
  const file = path.join(outDir, `zoom-${name}.png`);
  await loc.screenshot({ path: file, animations: 'disabled', caret: 'hide' }).catch((e) => console.log('zoom failed', name, String(e.message).split('\n')[0]));
  log.push(file);
}
async function fresh(target) {
  const { context, page, activity } = await openContext(browser, { device, role: roleArg, origin: server.origin, images: {} });
  await context.grantPermissions(['camera', 'microphone'], { origin: server.origin }).catch(() => {});
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).split('\n')[0]));
  await openScreen(page, activity, server.origin, roleArg, target);
  const ok = await page.getByTestId('create-post-screen').waitFor({ timeout: 12000 }).then(() => true).catch(() => false);
  if (!ok) {
    await page.evaluate((url) => { history.pushState(history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, `${target}&bt_preview=${roleArg}`);
    await page.getByTestId('create-post-screen').waitFor({ timeout: 20000 });
  }
  return { context, page, activity };
}
const tid = (page, id) => page.getByTestId(id);
const pickFiles = async (page, files) => { await page.locator('[data-testid="gallery-file-input"]').setInputFiles(files.map(m)); await page.waitForTimeout(1200); };

try {
  // ── Camera (opt-in on web; fake device) ──
  {
    const { context, page } = await fresh('/create-post?capture=1');
    await tid(page, 'capture-screen').waitFor({ timeout: 20000 });
    await shot(page, 'capture-thread');
    await zoom(page, 'create-mode-bar', 'capture-mode-bar');
    await zoom(page, 'capture-durations', 'capture-durations');
    await zoom(page, 'capture-rail', 'capture-rail');
    await tid(page, 'create-mode-post').click();
    await page.waitForTimeout(800);
    await shot(page, 'capture-post-mode');
    await context.close();
  }

  // ── THREAD (TikTok) ──
  if (roleArg === 'seller') {
    const { context, page } = await fresh('/create-post?mode=thread');
    await tid(page, 'gallery-picker').waitFor({ timeout: 20000 });
    await shot(page, 'thread-picker-empty');
    await pickFiles(page, ['land1.jpg', 'port1.jpg', 'land2.jpg', 'port2.jpg', 'land3.jpg', 'clip1.webm']);
    await shot(page, 'thread-picker-grid');
    await page.getByTestId('gallery-tab-videos').click();
    await shot(page, 'thread-picker-videos');
    await page.getByTestId('gallery-tab-photos').click();
    const tiles = page.locator('[data-testid^="gallery-tile-"]');
    for (let i = 0; i < 4; i += 1) await tiles.nth(i).click();
    await shot(page, 'thread-picker-selected');
    await zoom(page, 'gallery-clear', 'gallery-buttons', { parent: true });
    await zoom(page, 'gallery-tab-all', 'gallery-tabs', { parent: true });
    await tid(page, 'gallery-next').click();
    await tid(page, 'slide-editor').waitFor({ timeout: 15000 });
    await shot(page, 'thread-edit-slides');
    await zoom(page, 'aspect-3x4', 'slide-aspect-row', { parent: true });
    await zoom(page, 'slide-delete', 'slide-buttons', { parent: true });
    await tid(page, 'aspect-1x1').click();
    await shot(page, 'thread-edit-1x1');
    await tid(page, 'aspect-9x16').click();
    await shot(page, 'thread-edit-9x16');
    await tid(page, 'edit-next').click();
    await tid(page, 'post-screen').waitFor();
    await page.getByTestId('caption-input').fill('New drop! #fall @maya');
    await shot(page, 'thread-post');
    await zoom(page, 'chip-hashtags', 'post-chips', { parent: true });
    await zoom(page, 'post-drafts', 'post-buttons', { parent: true });
    await zoom(page, 'row-products', 'post-rows', { parent: true });
    await tid(page, 'row-visibility').click();
    await shot(page, 'thread-post-visibility');
    await page.getByTestId('create-header-back').last().click();
    await tid(page, 'row-options').click();
    await shot(page, 'thread-post-options');
    await page.getByTestId('create-header-back').last().click();
    await tid(page, 'row-schedule').click();
    await shot(page, 'thread-post-schedule');
    await page.getByTestId('create-header-back').last().click();
    await tid(page, 'edit-cover').click();
    await shot(page, 'thread-post-cover');
    await page.getByTestId('cover-done').click();
    await tid(page, 'post-submit').click();
    await page.waitForTimeout(1500);
    await shot(page, 'thread-publish-state');
    await context.close();

    // video
    const v = await fresh('/create-post?mode=thread');
    await tid(v.page, 'gallery-picker').waitFor({ timeout: 20000 });
    await pickFiles(v.page, ['clip1.webm', 'land1.jpg']);
    await v.page.getByTestId('gallery-tab-videos').click();
    await v.page.locator('[data-testid^="gallery-tile-"]').first().click();
    await shot(v.page, 'thread-picker-video-selected');
    await tid(v.page, 'gallery-next').click();
    await tid(v.page, 'video-editor').waitFor({ timeout: 15000 });
    await shot(v.page, 'thread-video-trim');
    await v.context.close();
  }

  // ── POST (Instagram) ──
  {
    const { context, page } = await fresh('/create-post?mode=post');
    await tid(page, 'post-picker').waitFor({ timeout: 20000 });
    await shot(page, 'post-picker-empty');
    await pickFiles(page, ['land1.jpg', 'port1.jpg', 'land2.jpg', 'clip1.webm', 'port2.jpg']);
    const tiles = page.locator('[data-testid^="picker-tile-"]');
    await tiles.first().click();
    await shot(page, 'post-picker-single');
    await tid(page, 'picker-multi').click();
    for (let i = 1; i < 5; i += 1) await tiles.nth(i).click();
    await shot(page, 'post-picker-multi');
    await tid(page, 'picker-next').click();
    await tid(page, 'carousel-editor').waitFor({ timeout: 15000 });
    await shot(page, 'post-carousel');
    await tid(page, 'tool-filter').click();
    await tid(page, 'filter-noir').click();
    await shot(page, 'post-filter');
    await zoom(page, 'tool-panel', 'post-filter-grid');
    await zoom(page, 'tool-filter', 'post-tool-buttons', { parent: true });
    await tid(page, 'tool-edit').click();
    await shot(page, 'post-edit-tools');
    await zoom(page, 'tool-panel', 'post-edit-grid');
    await tid(page, 'edit-brightness').click();
    await shot(page, 'post-edit-slider');
    await tid(page, 'edit-done').click();
    for (let i = 0; i < 5 && !(await tid(page, 'tool-trim').count()); i += 1) await tid(page, 'slide-prev').click();
    await shot(page, 'post-carousel-video-slide');
    await tid(page, 'tool-trim').click();
    await shot(page, 'post-trim');
    await tid(page, 'edit-next').click();
    await tid(page, 'post-screen').waitFor();
    await page.getByTestId('caption-input').fill('Weekend views! Who likes hiking?');
    await shot(page, 'post-caption-screen');
    await zoom(page, 'post-submit', 'post-share-button', { parent: true });
    await tid(page, 'row-people').click();
    await shot(page, 'post-tag-people');
    await page.getByTestId('create-header-back').last().click();
    await page.getByTestId('create-header-back').first().click();
    await shot(page, 'post-discard-draft');
    await context.close();
  }
} catch (error) {
  console.log('FAILED:', String(error.message).split('\n')[0]);
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: path.join(outDir, 'FAILED.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
console.log(`${log.length} screenshots in ${outDir}`);
console.log(fitIssues.length ? `TEXT-FIT: ${fitIssues.length} issue(s)` : 'TEXT-FIT: clean');
if (fitIssues.length) process.exitCode = 2;
