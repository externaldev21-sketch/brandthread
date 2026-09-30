/**
 * Traffic Sources sum-consistency verification — confirms the headline
 * total, the sum of the four legend row counts, and the row percentages all
 * agree, for demo mode across all 5 ranges. Captures a 393x852 screenshot
 * of demo Week (the range originally reported as mismatched: headline 300
 * vs. row sum 307).
 *
 * Run:  node scripts/store-screenshots/traffic-sources-consistency-verify.mjs
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

const OUT = path.join(MOBILE_ROOT, 'docs/polish/screenshots/traffic-sources-consistency');
mkdirSync(OUT, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 3,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const RANGES = ['today', 'week', 'month', 'year', 'all'];
const RANGE_LABEL = { today: 'Today', week: 'Week', month: 'Month', year: 'Year', all: 'All' };

function parseCompact(text) {
  const m = text.trim().match(/^([\d.]+)([KMB])?$/i);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const mult = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[m[2]?.toUpperCase()] ?? 1;
  return n * mult;
}

async function main() {
  console.log('Building web preview…');
  buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  const mismatches = [];

  try {
    const { context, page, activity } = await openContext(browser, {
      device: DEVICE,
      role: 'seller',
      origin,
      images: {},
    });

    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, 'seller', '/(tabs)?demo=1');
      try {
        await page.waitForSelector('[data-testid="seller-dashboard-traffic-sources"]', { timeout: 15000 });
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
        await page.getByText(RANGE_LABEL[range], { exact: true }).first().click();
      });
      await page.waitForTimeout(500);
      await waitForQuietNetwork(activity, 400, 6000);
      await page.waitForTimeout(300);

      const panel = page.locator('[data-testid="seller-dashboard-traffic-sources"]');
      await panel.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400); // let the segmented-bar fill-in animation settle

      // Row counts/shares come straight from each row's own accessibility
      // label ("<Label>: <count> visits, <sharePercent>%") — exact numbers,
      // no compact-format/locale parsing ambiguity.
      const rowLabels = await panel.locator('[aria-label$="%"]').evaluateAll(
        (els) => els.map((el) => el.getAttribute('aria-label')),
      );
      const rows = rowLabels
        .map((label) => {
          const m = label?.match(/:\s*([\d,]+)\s*visits,\s*([\d.]+)%/);
          return m ? { count: parseInt(m[1].replace(/,/g, ''), 10), sharePercent: parseFloat(m[2]) } : null;
        })
        .filter(Boolean);

      const panelText = (await panel.innerText().catch(() => '')) ?? '';
      const headlineLineMatch = panelText.match(/([\d,.]+[KMB]?)\s*store visits this period/i);
      const headline = headlineLineMatch ? parseCompact(headlineLineMatch[1].replace(/,/g, '')) : NaN;

      const rowSum = rows.reduce((sum, r) => sum + r.count, 0);
      const shareSum = rows.reduce((sum, r) => sum + r.sharePercent, 0);

      console.log(`[${range}] headline(compact)=${headlineLineMatch?.[1]}(=${headline}) rows=${JSON.stringify(rows)} rowSum=${rowSum} shareSum=${shareSum}`);

      // headline is the compact-formatted display value (e.g. "37.7K" for
      // 37,700) so it's compared to rowSum with compact-formatting's own
      // rounding tolerance, not exact equality.
      if (Number.isFinite(headline) && Math.abs(headline - rowSum) > Math.max(1, rowSum * 0.006)) {
        mismatches.push(`[${range}] headline (${headline}) != row sum (${rowSum})`);
      }
      if (rows.length > 0 && Math.abs(shareSum - 100) > 0.5) {
        mismatches.push(`[${range}] share percentages sum to ${shareSum}, not ~100`);
      }

      if (range === 'week') {
        await page.screenshot({ path: path.join(OUT, 'demo-week-full.png') });
        await panel.screenshot({ path: path.join(OUT, 'demo-week-traffic-sources.png') });
        console.log('captured demo-week screenshots');
      }
    }

    await context.close();
  } finally {
    await browser.close();
    close();
  }

  if (mismatches.length > 0) {
    console.error(`\n${mismatches.length} mismatch(es) found:`);
    for (const m of mismatches) console.error(' -', m);
    process.exitCode = 1;
  } else {
    console.log('\nHeadline, row sum, and share percentages agree across all 5 ranges.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
