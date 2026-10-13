/**
 * Seller dashboard Live map: captures the dashboard with the map in
 * ?demo=1 (US/EU cities) and fresh (empty, "No orders today") modes, plus
 * the full-screen city list, at 393x852, and runs the text-fit check.
 *
 * Run:  node scripts/store-screenshots/live-map-verify.mjs
 *       SKIP_BUILD=1 node scripts/store-screenshots/live-map-verify.mjs   (reuse the last build)
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, 'docs/pr-review/live-map');
mkdirSync(OUT, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function textFit(page) {
  return page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('*')) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const text = el.textContent.trim().slice(0, 40);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') bad.push(`overflow: ${text}`);
      if (r.right > innerWidth + 1 || r.left < -1) bad.push(`offscreen: ${text}`);
      if (/…|\.\.\./.test(el.textContent) && el.children.length === 0) bad.push(`ellipsis: ${text}`);
    }
    return bad;
  });
}

async function main() {
  if (!process.env.SKIP_BUILD) buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  let problems = 0;
  const check = async (page, name) => {
    const bad = await textFit(page);
    console.log(`${name}: text-fit ${bad.length ? 'PROBLEMS ' + JSON.stringify(bad) : 'OK'}`);
    problems += bad.length;
  };
  try {
    for (const mode of ['demo', 'fresh']) {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
      await openScreen(page, activity, origin, 'seller', '/(tabs)', { extraQuery: mode === 'demo' ? '&demo=1' : '' });
      await waitForQuietNetwork(activity, 600, 10_000);
      await page.waitForTimeout(1200);
      const map = page.getByTestId('seller-dashboard-live-map');
      await map.waitFor({ timeout: 15_000 });
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="seller-dashboard-live-map"]');
        const top = el.getBoundingClientRect().top;
        let node = el.parentElement;
        while (node && !(node.scrollHeight > node.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(node).overflowY))) node = node.parentElement;
        (node ?? document.scrollingElement).scrollBy(0, top - 260);
      });
      await page.waitForTimeout(700);
      const count = await page.getByTestId('seller-live-map-count').innerText();
      const empty = await page.getByText('No orders today').count();
      console.log(`${mode}: Live count=${count}; "No orders today" visible=${empty}`);
      await page.screenshot({ path: path.join(OUT, `after-dashboard-${mode}.png`) });
      await check(page, `after-dashboard-${mode}`);

      await map.click();
      await page.getByTestId('seller-live-map-full').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, `after-fullscreen-${mode}.png`) });
      await check(page, `after-fullscreen-${mode}`);
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
  if (problems) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
