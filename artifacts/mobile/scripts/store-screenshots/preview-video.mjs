#!/usr/bin/env node
/**
 * App Store App Preview (item 120): a 15–30 s screen recording of the real
 * brand stores in the live web app, converted to the 6.9" iPhone preview
 * format (886 × 1920, 30 fps, H.264 + silent AAC track).
 *
 *   STORE_WEB_URL=https://<live web app> STORE_HANDLES=handle1,handle2,handle3 \
 *     node scripts/store-screenshots/preview-video.mjs
 *
 * Shot list (each step shows something actually happening, no decorative
 * motion): open brand 1's store → scroll its products → open a product →
 * scroll the product page → brand 2's store → brand 3's store.
 * Output: store-screenshots/preview-video/app-preview-iphone-6.9in.mp4
 *
 * Needs ffmpeg on PATH. Signed out, public pages only.
 */
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { MOBILE_ROOT } from './harness.mjs';
import { PREVIEW, ffmpegArgs, parseHandles, parseWebOrigin } from './real-stores-lib.mjs';

const origin = parseWebOrigin(process.env.STORE_WEB_URL);
const handles = parseHandles(process.env.STORE_HANDLES);
if (!origin || handles.length === 0) {
  console.error('Set STORE_WEB_URL (https origin of the live web app) and STORE_HANDLES (up to 3 store handles).');
  process.exit(1);
}

const OUT = path.join(MOBILE_ROOT, 'store-screenshots', 'preview-video');
const RAW = path.join(OUT, 'raw');
rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

// 443 × 960 CSS px at 2x = the 886 × 1920 frame.
const viewport = { width: PREVIEW.width / 2, height: PREVIEW.height / 2 };
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const context = await browser.newContext({
  viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  recordVideo: { dir: RAW, size: { width: PREVIEW.width, height: PREVIEW.height } },
});
const page = await context.newPage();
const started = Date.now();
const glide = async (dy, ms = 1600) => {
  const steps = Math.round(ms / 16);
  for (let i = 0; i < steps; i += 1) { await page.mouse.wheel(0, dy / steps); await page.waitForTimeout(16); }
};
const open = async (p) => { await page.goto(`${origin}${p}`, { waitUntil: 'networkidle', timeout: 45_000 }); await page.waitForTimeout(1200); };

try {
  const [first, ...rest] = handles;
  await open(`/store/${encodeURIComponent(first)}`);
  await glide(700);
  await page.waitForTimeout(600);
  const product = page.locator('[href*="/store/product/"]').first();
  if (await product.count()) {
    await product.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await glide(600);
    await page.waitForTimeout(800);
  }
  for (const h of rest) {
    await open(`/store/${encodeURIComponent(h)}`);
    await glide(500, 1400);
    await page.waitForTimeout(700);
  }
} finally {
  await context.close();
  await browser.close();
}

const seconds = (Date.now() - started) / 1000;
const webm = readdirSync(RAW).find((f) => f.endsWith('.webm'));
if (!webm) { console.error('No recording was produced.'); process.exit(1); }
const output = path.join(OUT, 'app-preview-iphone-6.9in.mp4');
const ff = spawnSync('ffmpeg', ffmpegArgs(path.join(RAW, webm), output, seconds), { stdio: 'inherit' });
if (ff.status !== 0) { console.error('ffmpeg failed; the raw WebM is in', RAW); process.exit(1); }
renameSync(path.join(RAW, webm), path.join(OUT, 'raw.webm'));
rmSync(RAW, { recursive: true, force: true });
console.log(`Wrote ${path.relative(MOBILE_ROOT, output)} (${Math.min(PREVIEW.maxSeconds, Math.max(PREVIEW.minSeconds, seconds)).toFixed(1)} s). Upload it in App Store Connect → Previews and Screenshots → iPhone 6.9" Display.`);
