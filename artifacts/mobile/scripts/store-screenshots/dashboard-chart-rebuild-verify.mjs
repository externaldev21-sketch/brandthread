/**
 * Seller Dashboard chart accuracy/consistency rebuild — before/after
 * verification. Captures the chart for all 5 ranges (Today/Week/Month/
 * Year/All) in both fresh (genuinely-zero) and demo (?demo=1) seller
 * preview modes at 393x852 (iPhone 14/15-class viewport), and reports any
 * console error seen along the way.
 *
 * Run:  node scripts/store-screenshots/dashboard-chart-rebuild-verify.mjs
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  MOBILE_ROOT,
  buildPreviewWeb,
  launchBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForQuietNetwork,
} from './harness.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/polish/screenshots/dashboard-chart-rebuild');
mkdirSync(OUT, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 3,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const RANGES = ['today', 'week', 'month', 'year', 'all'];
const RANGE_LABEL = { today: 'Today', week: 'Week', month: 'Month', year: 'Year', all: 'All' };

async function main() {
  console.log('Building web preview…');
  buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  const errors = [];

  try {
    for (const mode of ['fresh', 'demo']) {
      const { context, page, activity } = await openContext(browser, {
        device: DEVICE,
        role: 'seller',
        origin,
        images: {},
      });
      page.on('pageerror', (err) => errors.push(`[${mode}] pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`[${mode}] console.error: ${msg.text()}`);
      });

      const target = mode === 'demo' ? '/(tabs)?demo=1' : '/(tabs)';
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'seller', target);
        try {
          await page.waitForSelector('[data-testid="seller-dashboard-scroll"], body', { timeout: 15000 });
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
        }
      }
      await waitForQuietNetwork(activity, 600, 10_000);
      await page.waitForTimeout(900);

      for (const range of RANGES) {
        const pill = page.getByRole('button', { name: `Show ${RANGE_LABEL[range]}` });
        await pill.click({ trial: false }).catch(async () => {
          // Fall back to a coordinate tap if accessibility role lookup fails
          // under RN Web's ARIA shim.
          await page.getByText(RANGE_LABEL[range], { exact: true }).first().click();
        });
        await page.waitForTimeout(500);
        await waitForQuietNetwork(activity, 400, 6000);
        await page.waitForTimeout(300);
        const fileName = `${mode}-${range}.png`;
        await page.screenshot({ path: path.join(OUT, fileName) });
        console.log(`captured ${fileName}`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} console error(s) captured during the run:`);
    for (const e of errors.slice(0, 20)) console.error(' -', e);
    process.exitCode = 1;
  } else {
    console.log('\nNo console errors during the full 10-shot sweep.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
