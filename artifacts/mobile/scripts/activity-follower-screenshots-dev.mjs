#!/usr/bin/env node
/**
 * Faster-booting variant of activity-follower-screenshots.mjs: instead of a
 * full `expo export` (production build, several minutes, rebuilt from
 * scratch every run), this boots a plain `expo start --web` dev server once
 * and reuses it for every capture — Metro's dev-server transform cache makes
 * a second navigation/reload in the same session cheap, unlike export's
 * forced `rmSync` + full rebuild per run.
 *
 * Reuses the same demo-data/clerk-stub interception `openContext`/
 * `openScreen` from the store-screenshots harness — those only need an
 * `origin` to talk to, not a specific build mode.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  launchBrowser, openContext, openScreen, waitForImages, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, 'docs', 'pr-review', 'activity-follower-management');
const IMAGES_DIR = path.join(WORK_DIR, 'demo-images');
const PORT = 8097;
const DEMO_CLERK_KEY = `pk_test_${Buffer.from('clerk.brandthread.test$').toString('base64')}`;
const DEMO_API = 'https://api.brandthread.test';

const WIDTHS = [
  { id: '375x667', width: 375, height: 667 },
  { id: '390x844', width: 390, height: 844 },
  { id: '430x932', width: 430, height: 932 },
];

function startDevServer() {
  const env = {
    ...process.env,
    CI: '1',
    EXPO_NO_TELEMETRY: '1',
    EXPO_OFFLINE: '1',
    EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST: '1',
    EXPO_PUBLIC_API_BASE_URL: DEMO_API,
    EXPO_PUBLIC_DOMAIN: 'api.brandthread.test',
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: DEMO_CLERK_KEY,
    EXPO_PUBLIC_CLERK_PROXY_URL: '',
    EXPO_PUBLIC_SENTRY_DSN: '',
    EXPO_PUBLIC_META_PIXEL_ID: '',
    EXPO_PUBLIC_TIKTOK_PIXEL_ID: '',
    REPLIT_DEV_DOMAIN: `localhost:${PORT}`,
    REPL_ID: 'localdev',
    REPLIT_EXPO_DEV_DOMAIN: `localhost:${PORT}`,
  };
  const child = spawn('pnpm', ['exec', 'expo', 'start', '--web', '--port', String(PORT), '--clear'], {
    cwd: MOBILE_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  child.stdout.on('data', (d) => { buf += d.toString(); });
  child.stderr.on('data', (d) => { buf += d.toString(); });
  child.getLog = () => buf;
  return child;
}

async function waitForServer(origin, deadlineMs = 180_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      const res = await fetch(origin);
      if (res.ok || res.status === 200) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('Dev server did not start in time');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('Starting expo start --web dev server...');
  const server = startDevServer();
  const origin = `http://localhost:${PORT}`;
  try {
    await waitForServer(origin);
    console.log('Dev server is up:', origin);

    const browser = await launchBrowser();
    const images = await ensureDemoImages(browser, IMAGES_DIR);
    try {
      for (const device of WIDTHS) {
        console.log(`Capturing ${device.id}...`);
        const { context, page, activity } = await openContext(browser, {
          device: { viewport: { width: device.width, height: device.height }, scale: 2, isMobile: true, userAgent: undefined },
          role: 'buyer',
          origin,
          images,
        });
        page.setDefaultNavigationTimeout(120_000);
        page.setDefaultTimeout(30_000);
        page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[console] ${msg.text().slice(0, 200)}`); });
        await openScreen(page, activity, origin, 'buyer', '/activity-center');
        await page.waitForSelector('text=Activity', { timeout: 30_000 }).catch(() => {});
        await waitForImages(page);
        await waitForQuietNetwork(activity);
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(OUTPUT_DIR, `01-list-${device.id}.png`) });

        const row = page.locator('text=started following you').first();
        const rowCount = await row.count();
        console.log(`  follow row count: ${rowCount}`);
        if (rowCount > 0) {
          const box = await row.locator('xpath=ancestor::*[contains(@class,"") ][1]').boundingBox().catch(() => null) || await row.boundingBox().catch(() => null);
          if (box) {
            await page.mouse.move(box.x + Math.max(box.width - 10, 10), box.y + Math.max(box.height / 2, 10));
            await page.mouse.down();
            await page.mouse.move(box.x - 60, box.y + Math.max(box.height / 2, 10), { steps: 12 });
            await page.mouse.up();
            await page.waitForTimeout(500);
            await page.screenshot({ path: path.join(OUTPUT_DIR, `02-swipe-revealed-${device.id}.png`) });

            const moreBtn = page.locator('[aria-label="More options"]').first();
            const moreCount = await moreBtn.count();
            console.log(`  more button count: ${moreCount}`);
            if (moreCount > 0) {
              await moreBtn.click({ force: true });
              await page.waitForTimeout(500);
              await page.screenshot({ path: path.join(OUTPUT_DIR, `03-menu-open-${device.id}.png`) });

              const removeFollowerBtn = page.locator('text=Remove follower').first();
              if (await removeFollowerBtn.count()) {
                await removeFollowerBtn.click({ force: true });
                await page.waitForTimeout(500);
                await page.screenshot({ path: path.join(OUTPUT_DIR, `04-remove-follower-confirm-${device.id}.png`) });

                if (device.id === '390x844') {
                  const removeBtn = page.locator('text=Remove').last();
                  if (await removeBtn.count()) {
                    await removeBtn.click({ force: true });
                    await page.waitForTimeout(300);
                    await page.screenshot({ path: path.join(OUTPUT_DIR, `05-removed-toast-${device.id}.png`) });
                  }
                } else {
                  await page.keyboard.press('Escape').catch(() => {});
                }
              }
            }
          }
        }
        await context.close();
      }

      // Block-from-menu, and a seller-role shot — one pass at 390x844.
      {
        const { context, page, activity } = await openContext(browser, {
          device: { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined },
          role: 'buyer',
          origin,
          images,
        });
        page.setDefaultNavigationTimeout(120_000);
        page.setDefaultTimeout(30_000);
        await openScreen(page, activity, origin, 'buyer', '/activity-center');
        await waitForImages(page);
        await waitForQuietNetwork(activity);
        await page.waitForTimeout(600);
        const row = page.locator('text=started following you').first();
        if (await row.count()) {
          const box = await row.boundingBox().catch(() => null);
          if (box) {
            await page.mouse.move(box.x + Math.max(box.width - 10, 10), box.y + Math.max(box.height / 2, 10));
            await page.mouse.down();
            await page.mouse.move(box.x - 60, box.y + Math.max(box.height / 2, 10), { steps: 12 });
            await page.mouse.up();
            await page.waitForTimeout(400);
            const moreBtn = page.locator('[aria-label="More options"]').first();
            if (await moreBtn.count()) {
              await moreBtn.click({ force: true });
              await page.waitForTimeout(400);
              const blockBtn = page.locator('text=Block').first();
              if (await blockBtn.count()) {
                await blockBtn.click({ force: true });
                await page.waitForTimeout(400);
                await page.screenshot({ path: path.join(OUTPUT_DIR, '06-block-from-menu-390x844.png') });
              }
            }
          }
        }
        await context.close();
      }

      {
        const { context, page, activity } = await openContext(browser, {
          device: { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined },
          role: 'seller',
          origin,
          images,
        });
        page.setDefaultNavigationTimeout(120_000);
        page.setDefaultTimeout(30_000);
        await openScreen(page, activity, origin, 'seller', '/activity-center');
        await waitForImages(page);
        await waitForQuietNetwork(activity);
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(OUTPUT_DIR, '07-seller-list-390x844.png') });
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error('DEV SERVER LOG TAIL:\n', server.getLog?.().slice(-4000));
    throw err;
  } finally {
    server.kill('SIGKILL');
  }
  console.log(`Screenshots written to ${OUTPUT_DIR}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
