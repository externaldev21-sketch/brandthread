/**
 * Seller Dashboard — opens on Today, shows the empty-sales message once, and
 * hides the flat "—" under stat tiles. Captures the dashboard as it first
 * opens (no range tap) in fresh (no demo) and ?demo=1 modes at 393x852, plus
 * the fresh Week range, and runs a text-fit check on each capture.
 *
 * Run:  node scripts/store-screenshots/dashboard-today-default-verify.mjs
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../screenshots/dashboard-today-default');
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
  buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  let problems = 0;
  try {
    for (const mode of ['fresh', 'demo']) {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
      await openScreen(page, activity, origin, 'seller', mode === 'demo' ? '/(tabs)?demo=1' : '/(tabs)');
      await waitForQuietNetwork(activity, 600, 10_000);
      await page.waitForTimeout(1200);
      const shots = [[`${mode}-opens-on-today`, null]];
      if (mode === 'fresh') shots.push(['fresh-week', 'Week']);
      for (const [name, range] of shots) {
        if (range) {
          await page.getByText(range, { exact: true }).first().click();
          await page.waitForTimeout(700);
        }
        await page.screenshot({ path: path.join(OUT, `${name}.png`) });
        const bad = await textFit(page);
        const msgs = await page.getByText(/No sales yet/).count();
        console.log(`${name}: "No sales yet…" occurrences=${msgs}; text-fit ${bad.length ? 'PROBLEMS ' + JSON.stringify(bad) : 'OK'}`);
        problems += bad.length;
      }
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
  if (problems) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
