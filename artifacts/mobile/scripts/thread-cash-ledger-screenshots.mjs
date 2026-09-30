#!/usr/bin/env node
/**
 * Thread Cash wallet entry row + Ledger screen at 393x852 (demo preview).
 *   node scripts/thread-cash-ledger-screenshots.mjs <outDir>
 * Builds the preview web app, serves it, and screenshots with &demo=1.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, DEFAULT_BUILD_DIR, buildPreviewWeb, serveBuild, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/thread-cash-ledger'));
mkdirSync(OUT, { recursive: true });
if (!process.env.SKIP_BUILD) buildPreviewWeb();
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true };

async function session(demo) {
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images: {} });
  page.setDefaultNavigationTimeout(240_000);
  await openScreen(page, activity, server.origin, 'buyer', `/thread-cash${demo ? '?demo=1' : ''}`);
  await waitForQuietNetwork(activity, 900, 20_000);
  await page.waitForTimeout(1500);
  return { context, page };
}
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, name) }); console.log('ok', name); };

try {
  const { context, page } = await session(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  const row = page.getByTestId('thread-cash-open-ledger');
  await row.scrollIntoViewIfNeeded();
  await shot(page, '01-wallet-ledger-row.png');
  await row.click();
  await page.getByTestId('thread-cash-ledger-balance').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await shot(page, '02-ledger-all.png');
  await page.getByRole('button', { name: 'Spent' }).click();
  await page.waitForTimeout(800);
  await shot(page, '03-ledger-spent.png');
  await page.getByRole('button', { name: 'Expired' }).click();
  await page.waitForTimeout(800);
  await shot(page, '04-ledger-expired.png');
  await context.close();

  // Fresh account (no demo): real empty state, no invented data.
  const fresh = await openContext(browser, { device, role: 'buyer', origin: server.origin, images: {} });
  fresh.page.setDefaultNavigationTimeout(240_000);
  await openScreen(fresh.page, fresh.activity, server.origin, 'buyer', '/thread-cash');
  await fresh.page.getByTestId('thread-cash-open-ledger').click({ timeout: 60_000 });
  await fresh.page.getByTestId('thread-cash-ledger-balance').waitFor({ timeout: 30_000 });
  await fresh.page.waitForTimeout(800);
  await shot(fresh.page, '05-ledger-empty.png');
} finally {
  await browser.close();
  server.close();
}
