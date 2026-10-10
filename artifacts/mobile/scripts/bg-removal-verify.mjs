#!/usr/bin/env node
/**
 * Remove Background: browser verification at 393x852 — file chooser, sweep
 * frames, swatches, refine, save, signed-out safety, plus the text-fit audit on
 * every state. Needs a preview build first (see store-screenshots/harness.mjs
 * buildPreviewWeb). Output: docs/polish/screenshots/bg-removal/ + a .webm.
 *
 *   node scripts/bg-removal-verify.mjs [--nodemo]
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser, serveBuild, openContext, DEFAULT_BUILD_DIR, MOBILE_ROOT } from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { auditTextFit } from './text-fit-audit.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/polish/screenshots/bg-removal');
const PHOTO = path.join(MOBILE_ROOT, 'assets/images/products/leather-ankle-boots.jpg');
const noDemo = process.argv.includes('--nodemo');
mkdirSync(OUT, { recursive: true });

const srv = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const apiCalls = [];
const { context, page } = await openContext(browser, {
  device: { viewport: { width: 393, height: 852 }, scale: 3, isMobile: true, userAgent: undefined },
  role: 'seller', origin: srv.origin, images,
  contextOptions: { reducedMotion: 'no-preference', acceptDownloads: true, recordVideo: { dir: OUT, size: { width: 393, height: 852 } } },
});
page.on('request', (r) => { if (r.url().includes('bg-removal')) apiCalls.push(`${r.method()} ${r.url()}`); });
let failures = 0;
const shot = (n, opts = {}) => page.screenshot({ path: path.join(OUT, `${n}.png`), ...opts });
async function audit(state) {
  const issues = await auditTextFit(page);
  console.log(`TEXT-FIT [${state}]:`, issues.length ? issues : 'clean');
  failures += issues.length;
}
async function zoom(n, selector) {
  await page.locator(selector).first().screenshot({ path: path.join(OUT, `${n}.png`) });
}

await page.goto(`${srv.origin}/?bt_preview=seller`);
await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.evaluate((url) => { history.pushState(history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); },
  `/design-bg-removal?bt_preview=seller${noDemo ? '' : '&demo=1'}`);
await page.waitForSelector('[data-testid=bg-removal-dropzone]', { timeout: 20000 });
await page.waitForTimeout(800);
await shot('01-empty'); await audit('empty');

const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), page.click('[data-testid=bg-removal-dropzone]')]);
console.log('FILE CHOOSER OPENED:', !!chooser);
if (!chooser) process.exit(1);
await chooser.setFiles(PHOTO);
await page.waitForSelector('[data-testid=bg-removal-stage]', { timeout: 10000 });
await page.waitForTimeout(600);
await shot('02-loaded'); await audit('loaded');
await zoom('z-loaded-button', '[data-testid=bg-removal-run]');

await page.click('[data-testid=bg-removal-run]');
if (noDemo) {
  await page.waitForTimeout(500); await shot('11-signed-out-error'); await audit('signed-out-error');
} else {
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(250); if (i % 3 === 1) await shot(`03-sweep-${String(i).padStart(2, '0')}`); }
  await page.waitForSelector('[data-testid=bg-removal-save]', { timeout: 8000 });
  await page.waitForTimeout(600);
  await shot('04-done'); await audit('done');
  await zoom('z-done-actions', '[data-testid=bg-removal-save] >> xpath=../..');
  await zoom('z-done-corner', '[data-testid=bg-removal-undo] >> xpath=..');
  for (const label of ['White', 'Blur']) { await page.click(`[aria-label=${label}]`); await page.waitForTimeout(400); await shot(`05-swatch-${label.toLowerCase()}`); }
  await page.click('[aria-label=Transparent]');
  await page.click('[data-testid=bg-removal-refine]'); await page.waitForTimeout(500);
  await shot('06-refine'); await audit('refine');
  await zoom('z-refine-actions', '[data-testid=bg-removal-refine-done] >> xpath=..');
  await page.mouse.move(120, 330); await page.mouse.down();
  for (let k = 0; k <= 12; k++) await page.mouse.move(120 + k * 12, 330 + Math.sin(k) * 12);
  await page.mouse.up(); await page.waitForTimeout(300);
  await shot('07-refine-stroked');
  await page.click('[data-testid=bg-removal-refine-done]'); await page.waitForTimeout(1500);
  await shot('09-applied');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('[data-testid=bg-removal-save]')]);
  console.log('SAVE DOWNLOAD:', dl ? dl.suggestedFilename() : 'none');
  await page.waitForTimeout(400); await shot('10-saved'); await audit('saved');
}
console.log('BG-REMOVAL API CALLS:', apiCalls);
const tabBar = await page.evaluate(() => { const t = document.querySelector('[data-testid=seller-tab-bar], [aria-label*="tab" i]'); return t ? Math.round(t.getBoundingClientRect().top) : 'none'; });
console.log('TAB BAR TOP (viewport 852 high):', tabBar);
await context.close(); await srv.close(); await browser.close();
console.log(failures ? `TEXT-FIT FAILURES: ${failures}` : 'TEXT-FIT: all clean');
process.exit(failures ? 2 : 0);
