#!/usr/bin/env node
/**
 * Records the landing page's phone clip (assets/landing/app-capture.*) from
 * the real buyer app with the demo catalogue: Threads feed → swipe → Shop →
 * product sheet → size → Add to cart.
 *
 * 1. Start the dev bundle with the screenshot harness env (see
 *    store-screenshots/harness.mjs buildPreviewWeb for the variables):
 *      pnpm exec expo start --web --port 8099
 * 2. node scripts/landing-capture-record.mjs [origin] [workDir]
 *
 * Frames come from Chrome's screencast at 2x (forced device scale factor, so
 * the clip is sharp), then ffmpeg builds the MP4, WebM and poster in
 * assets/landing/. A first pass only warms Metro so the recorded pass has no
 * bundling pauses.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, openContext, openScreen } from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const WORK = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'landing-capture'));
const OUT = path.join(MOBILE_ROOT, 'assets', 'landing');
// Trim of the recorded pass (seconds from the first feed frame).
const CLIP_START = 1.0;
const CLIP_LENGTH = 11.6;

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(path.join(WORK, 'frames'), { recursive: true });
const { chromium } = await import('playwright');
const browser = await chromium.launch({ args: ['--force-device-scale-factor=2'] });
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));

async function pass(record) {
  const { context, page, activity } = await openContext(browser, {
    device: { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true },
    role: 'buyer',
    origin: ORIGIN,
    images,
    contextOptions: { reducedMotion: 'no-preference' },
  });
  page.setDefaultNavigationTimeout(240_000);
  await openScreen(page, activity, ORIGIN, 'buyer', '/?bt_preview=buyer');
  await page.waitForTimeout(record ? 6000 : 9000);
  await page.getByText('Tap to keep watching').click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(800);

  const cdp = await context.newCDPSession(page);
  const frames = [];
  if (record) {
    cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
      const file = path.join(WORK, 'frames', `f${String(frames.length).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, t: metadata.timestamp });
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1688 });
  }
  const swipe = async (fromY, steps, step) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: fromY }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + i, y: fromY - i * step }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const visibleShopPill = async () => {
    const pills = page.getByTestId('shop-tag-pill');
    for (let i = 0; i < await pills.count(); i++) {
      const box = await pills.nth(i).boundingBox();
      if (box && box.y > 0 && box.y < 844) return pills.nth(i);
    }
    throw new Error('No Shop pill on screen');
  };

  await page.waitForTimeout(1800);
  await swipe(650, 14, 34); // next post: Maison Vela
  await page.waitForTimeout(2000);
  await (await visibleShopPill()).tap();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: /^Shop Liquid Silver Dress/ }).click();
  await page.getByText('Liquid Silver Dress').last().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1700);
  await swipe(640, 10, 22); // reveal the sizes
  await page.waitForTimeout(1000);
  await page.locator('[aria-label="M"]').last().click();
  await page.waitForTimeout(700);
  await page.getByText('Add to cart', { exact: true }).last().click();
  await page.waitForTimeout(2600);

  if (record) {
    await cdp.send('Page.stopScreencast');
    // Each frame is held until the next one arrived.
    const lines = ['ffconcat version 1.0'];
    frames.forEach((frame, i) => {
      const next = frames[i + 1]?.t ?? frame.t + 0.1;
      lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, next - frame.t).toFixed(4)}`);
    });
    lines.push(`file '${frames.at(-1).file}'`);
    fs.writeFileSync(path.join(WORK, 'frames.ffconcat'), lines.join('\n'));
  }
  await context.close();
}

await pass(false);
await pass(true);
await browser.close();

const input = ['-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'frames.ffconcat'), '-ss', String(CLIP_START), '-t', String(CLIP_LENGTH)];
const scale = 'fps=30,scale=540:1168:flags=lanczos';
const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
ffmpeg([...input, '-vf', scale, '-an', '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', path.join(OUT, 'app-capture.mp4')]);
ffmpeg([...input, '-vf', scale, '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '1', path.join(OUT, 'app-capture.webm')]);
ffmpeg(['-i', path.join(OUT, 'app-capture.mp4'), '-frames:v', '1', '-q:v', '3', path.join(OUT, 'app-capture-poster.jpg')]);
for (const name of ['app-capture.mp4', 'app-capture.webm', 'app-capture-poster.jpg']) {
  console.log(`${name}: ${(fs.statSync(path.join(OUT, name)).size / 1024).toFixed(0)} KB`);
}
