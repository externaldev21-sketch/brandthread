/**
 * Seller analytics reports at 393x852, in both preview modes:
 *   fresh (`?bt_preview=seller`)          — a brand-new store, honest empty states
 *   demo  (`?bt_preview=seller&demo=1`)   — populated sample data
 *
 * For every screen it asserts: no page errors, no console errors, no failed
 * or unseeded network calls, no clipped / off-screen text, and nothing under
 * the floating seller tab bar. Screenshots land in
 * <repo>/screenshots/seller-analytics/<mode>/.
 *
 * Run:  node scripts/store-screenshots/seller-analytics-verify.mjs
 *       SKIP_BUILD=1 to reuse the last web build.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../screenshots/seller-analytics');
const DEVICE = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};
const SCREENS = [
  ['/analytics', '01-analytics', 'Reports'],
  ['/analytics-product-stats', '02-product-stats', 'Product stats'],
  ['/analytics-content', '03-threads-videos', 'Threads and videos'],
  ['/analytics-audience', '04-audience', 'Audience'],
  ['/analytics-goals', '05-goals', 'Goals'],
  ['/analytics-export', '06-export', 'Export'],
  ['/analytics-advanced', '07-advanced', 'Advanced analytics'],
];
const MODES = ['fresh', 'demo'];
// Browser noise that is not an app error (fonts/analytics hosts are aborted on purpose by the harness).
const IGNORED_CONSOLE = /ERR_FAILED|net::ERR_|Failed to load resource|favicon|Download the React DevTools|was preloaded using link preload/i;

async function main() {
  if (!process.env.SKIP_BUILD) buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  const failures = [];
  try {
    for (const mode of MODES) {
      mkdirSync(path.join(OUT, mode), { recursive: true });
      for (const [route, name, marker] of SCREENS) {
        const label = `${mode}/${name}`;
        const problems = [];
        const unseeded = new Set();
        const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {}, onUnseeded: (r) => unseeded.add(r) });
        page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
        page.on('console', (msg) => { if (msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text())) problems.push(`console error: ${msg.text().slice(0, 200)}`); });
        page.on('requestfailed', (req) => {
          const url = new URL(req.url());
          if (url.origin === origin || url.hostname === 'api.brandthread.test') problems.push(`failed request: ${req.method()} ${url.pathname}`);
        });
        page.on('response', (res) => {
          const url = new URL(res.url());
          if (url.hostname === 'api.brandthread.test' && res.status() >= 400) problems.push(`HTTP ${res.status()}: ${url.pathname}`);
        });
        const target = mode === 'demo' ? `${route}?demo=1` : route;
        for (let attempt = 1; ; attempt += 1) {
          await openScreen(page, activity, origin, 'seller', target, {
            beforeNavigate: () => page.evaluate((demo) => {
              if (demo) localStorage.setItem('bt_preview_demo', '1'); else localStorage.removeItem('bt_preview_demo');
              // first-run tips would cover the screen under test
              localStorage.setItem('bt:first-run-tips:v1', JSON.stringify({ 'seller-analytics': true }));
            }, mode === 'demo'),
          });
          try { await page.getByText(marker, { exact: true }).first().waitFor({ timeout: 10_000 }); break; }
          catch (e) { if (attempt >= 4) { problems.push(`never rendered "${marker}" (${page.url()})`); break; } }
        }
        await waitForQuietNetwork(activity, 600, 10_000);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(OUT, mode, `${name}.png`) });

        // Scroll every scroll container to its end so the bottom of the content is on screen.
        await page.evaluate(() => document.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight; }));
        await page.waitForTimeout(500);
        const layout = await page.evaluate(() => {
          const out = [];
          const vw = window.innerWidth;
          const bar = document.querySelector('[data-testid="seller-global-tab-bar"]');
          const barTop = bar ? bar.getBoundingClientRect().top : Infinity;
          const barVisible = !!bar && bar.getBoundingClientRect().height > 0;
          let lowest = 0;
          for (const el of document.querySelectorAll('body *')) {
            const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!own) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (bar && bar.contains(el)) continue;
            const txt = el.textContent.trim().slice(0, 40);
            if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped: "${txt}" (${el.scrollWidth}>${el.clientWidth})`);
            if (r.right > vw + 0.5 || r.left < -0.5) out.push(`off-screen: "${txt}"`);
            const p = el.parentElement?.getBoundingClientRect();
            if (p && p.width > 0 && (r.right > p.right + 1 || r.left < p.left - 1) && getComputedStyle(el.parentElement).overflow === 'visible') out.push(`overflows parent: "${txt}"`);
            // Only elements inside the viewport matter for the bar check (off-screen content is scrolled away).
            if (r.top < window.innerHeight) lowest = Math.max(lowest, r.bottom);
          }
          if (barVisible && lowest > barTop + 0.5) out.push(`content under tab bar: lowest text bottom ${Math.round(lowest)} > bar top ${Math.round(barTop)}`);
          return { out, barVisible };
        });
        problems.push(...layout.out);
        if (!layout.barVisible) problems.push('seller tab bar not visible');
        for (const r of unseeded) problems.push(`unseeded API call: ${r}`);
        await page.screenshot({ path: path.join(OUT, mode, `${name}-end.png`) });
        console.log(`[${label}] ${problems.length === 0 ? 'clean' : problems.join(' | ')}`);
        if (problems.length) failures.push(`${label}: ${problems.join(' | ')}`);
        await context.close();
      }
    }
  } finally { await browser.close(); close(); }
  if (failures.length) { console.error(`\n${failures.length} screen(s) with problems:\n${failures.join('\n')}`); process.exit(1); }
  console.log('\nAll seller analytics screens verified in fresh and demo mode.');
}
main().catch((e) => { console.error(e); process.exit(1); });
