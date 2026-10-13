#!/usr/bin/env node
/**
 * App Store / Google Play screenshots of REAL brand stores (item 119), taken
 * from the live web app, signed out, at every store size in devices.mjs.
 *
 *   STORE_WEB_URL=https://<live web app> STORE_HANDLES=handle1,handle2,handle3 \
 *     node scripts/store-screenshots/real-stores.mjs
 *
 * For each brand: its storefront (/store/<handle>) and its first product.
 * Output: store-screenshots/real-stores/<device>/<NN>-<handle>-<store|product>.png
 *
 * Nothing is faked: if a page doesn't load (unknown handle, store not
 * published), that shot is skipped with the reason. Only public pages are
 * opened; no sign-in, token or paid API is used.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEVICES, pixelSize } from './devices.mjs';
import { MOBILE_ROOT } from './harness.mjs';
import { parseHandles, parseWebOrigin, shotsFor } from './real-stores-lib.mjs';

const origin = parseWebOrigin(process.env.STORE_WEB_URL);
const handles = parseHandles(process.env.STORE_HANDLES);
if (!origin || handles.length === 0) {
  console.error('Set STORE_WEB_URL (https origin of the live web app) and STORE_HANDLES (up to 3 store handles).');
  process.exit(1);
}

const OUT = path.join(MOBILE_ROOT, 'store-screenshots', 'real-stores');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const report = [];

for (const device of DEVICES) {
  const dir = path.join(OUT, device.id);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: device.viewport, deviceScaleFactor: device.scale, userAgent: device.userAgent, isMobile: device.isMobile, hasTouch: true,
  });
  const page = await context.newPage();
  let n = 0;
  for (const handle of handles) {
    for (const shot of shotsFor(handle)) {
      n += 1;
      const file = path.join(dir, `${String(n).padStart(2, '0')}-${shot.id}.png`);
      try {
        if (shot.path) {
          await page.goto(`${origin}${shot.path}`, { waitUntil: 'networkidle', timeout: 45_000 });
        } else {
          await page.goto(`${origin}${shot.from}`, { waitUntil: 'networkidle', timeout: 45_000 });
          const link = page.locator('a[href*="/store/product/"], [href*="/store/product/"]').first();
          if (await link.count()) await link.click();
          else await page.getByRole('link').filter({ hasText: /\$\d/ }).first().click({ timeout: 8_000 });
          await page.waitForURL(/\/store\/product\//, { timeout: 15_000 });
          await page.waitForLoadState('networkidle');
        }
        await page.waitForTimeout(800);
        if (/not found|doesn.t exist|unavailable/i.test(await page.locator('body').innerText())) throw new Error('page says the store or product is not available');
        await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
        report.push({ device: device.id, file: path.relative(OUT, file), size: pixelSize(device), title: shot.title, status: 'captured' });
      } catch (error) {
        report.push({ device: device.id, title: shot.title, status: 'skipped', reason: String(error?.message ?? error).split('\n')[0] });
      }
    }
  }
  await context.close();
}
await browser.close();

const lines = ['# Real-store screenshots', '', `Source: ${origin}, stores: ${handles.map((h) => `@${h}`).join(', ')}`, '', '| Device | File | Pixels | Screen | Status |', '|---|---|---|---|---|'];
for (const r of report) lines.push(`| ${r.device} | ${r.file ?? '—'} | ${r.size ? `${r.size.width}×${r.size.height}` : '—'} | ${r.title} | ${r.status}${r.reason ? `: ${r.reason}` : ''} |`);
writeFileSync(path.join(OUT, 'README.md'), `${lines.join('\n')}\n`);
const skipped = report.filter((r) => r.status === 'skipped');
console.log(`${report.length - skipped.length} captured, ${skipped.length} skipped. See store-screenshots/real-stores/README.md`);
