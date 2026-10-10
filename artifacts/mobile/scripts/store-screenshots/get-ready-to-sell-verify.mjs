#!/usr/bin/env node
/**
 * Captures the seller dashboard's "Get ready to sell" card at 390x844 from an
 * already exported web build (demo seller preview):
 *   node scripts/store-screenshots/get-ready-to-sell-verify.mjs <buildDir> <label> [outDir]
 * "fresh" stubs GET /api/seller/launch-checklist with nothing done; "demo"
 * uses &demo=1's sample checklist.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const [buildDirArg, label = 'after', outArg] = process.argv.slice(2);
const OUT = path.resolve(outArg ?? path.join(MOBILE_ROOT, '.store-screenshots', 'get-ready'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
const IDS = ['name_handle', 'logo_banner', 'accent', 'socials', 'first_product', 'shipping', 'preview', 'publish', 'payouts'];
const FRESH = { steps: IDS.map((id) => ({ id, done: false })), doneCount: 0, total: IDS.length, complete: false, handle: null, dismissed: false };

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(path.resolve(buildDirArg));
  try {
    for (const mode of ['fresh', 'demo']) {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
      await context.route(/\/seller\/launch-checklist$/, (route) => {
        const req = route.request();
        const headers = { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,OPTIONS' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(FRESH) });
      });
      await page.goto(`${origin}/?bt_preview=seller${mode === 'demo' ? '&demo=1' : ''}`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
      await waitForQuietNetwork(activity, 600, 10_000);
      try { await page.getByText('Necessary only', { exact: true }).click({ timeout: 2000 }); } catch {}
      for (const t of ['Close', 'Not now', 'Skip for now']) { try { await page.getByRole('button', { name: t }).first().click({ timeout: 800 }); } catch {} }
      const card = await page.$('[data-testid="get-ready-to-sell"]') ?? await page.$('text=Launch your store');
      await card?.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `${label}-${mode}.png`) });
      console.log(`${label}-${mode}: card present = ${Boolean(card)}`);
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
