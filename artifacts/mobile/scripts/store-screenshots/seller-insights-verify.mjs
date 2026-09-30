/**
 * Seller analytics insights screenshots at 393x852 (demo data: &demo=1).
 * Run:  node scripts/store-screenshots/seller-insights-verify.mjs
 * Output: <repo>/screenshots/seller-analytics/
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../screenshots/seller-analytics');
mkdirSync(OUT, { recursive: true });
const DEVICE = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};
const SCREENS = [
  ['/analytics', '01-analytics-reports', 'Reports', true],
  ['/analytics-product-stats', '02-product-stats', 'Product stats'],
  ['/analytics-content', '03-content', 'Content Analytics'],
  ['/analytics-audience', '04-audience', 'Audience'],
  ['/analytics-best-time', '05-best-time', 'Best time to post'],
  ['/analytics-goals', '06-goals', 'Goals'],
  ['/analytics-export', '07-export', 'Export analytics'],
];

async function main() {
  if (!process.env.SKIP_BUILD) buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  const errors = [];
  try {
    for (const [route, name, marker, scrollEnd] of SCREENS) {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
      page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      await openScreen(page, activity, origin, 'seller', `${route}?demo=1`, {
        beforeNavigate: () => page.evaluate(() => localStorage.setItem('bt_preview_demo', '1')),
      });
      await page.getByText(marker, { exact: true }).first().waitFor({ timeout: 15_000 });
      await waitForQuietNetwork(activity, 600, 10_000);
      await page.waitForTimeout(1500);
      if (scrollEnd) {
        await page.evaluate(() => document.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight; }));
        await page.waitForTimeout(500);
      }
      const issues = await page.evaluate(() => {
        const out = [];
        const vw = window.innerWidth;
        for (const el of document.querySelectorAll('body *')) {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!own) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const txt = el.textContent.trim().slice(0, 40);
          if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped: "${txt}" (${el.scrollWidth}>${el.clientWidth})`);
          if (r.right > vw + 0.5 || r.left < -0.5) out.push(`off-screen: "${txt}"`);
          const p = el.parentElement?.getBoundingClientRect();
          if (p && p.width > 0 && (r.right > p.right + 1 || r.left < p.left - 1) && getComputedStyle(el.parentElement).overflow === 'visible') out.push(`overflows parent: "${txt}"`);
        }
        return out;
      });
      console.log(`[text-fit] ${name}: ${issues.length === 0 ? 'clean' : issues.join(' | ')}`);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      console.log('captured', name);
      await context.close();
    }
  } finally { await browser.close(); close(); }
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });
