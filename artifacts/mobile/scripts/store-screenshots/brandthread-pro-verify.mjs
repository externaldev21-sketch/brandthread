#!/usr/bin/env node
/**
 * Screenshots for Brandthread Pro (advanced analytics, locked state, plans
 * commission note). Drives the dev bundle like activity-dev-preview-verify.mjs.
 *   npx expo start --web --port 8192   (env as in that script)
 *   node scripts/store-screenshots/brandthread-pro-verify.mjs http://localhost:8192 <outDir>
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, waitForQuietNetwork } from './harness.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8192';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/brandthread-pro'));
mkdirSync(OUT, { recursive: true });

const shots = [
  ['01-analytics-tab-advanced-row', '/analytics?bt_preview=seller&demo=1', {}],
  ['02-advanced-analytics-pro', '/analytics-advanced?bt_preview=seller&demo=1', {}],
  ['03-advanced-analytics-locked', '/analytics-advanced?bt_preview=seller&demo=1&locked=1', {}],
  ['04-plans-pro-preselected-commission', '/plans?bt_preview=seller&demo=1&highlight=pro&source=analytics-advanced', { scrollToText: 'Platform commission' }],
];

const browser = await launchBrowser();
for (const [name, route, opts] of shots) {
  const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: ORIGIN, images: {} });
  await page.goto(`${ORIGIN}${route}`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
  await page.getByText('Accept all').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await waitForQuietNetwork(activity).catch(() => {});
  if (opts.scrollToText) {
    await page.getByText(opts.scrollToText).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('ok', name, page.url());
  await context.close();
}
await browser.close();
