/**
 * Seller drop waitlist ("hype"): captures the seller Drops list with the
 * new Waitlist row (?demo=1, plus fresh), the waitlist screen for an
 * upcoming drop with signups and one with a short history, at 393x852,
 * and runs the text-fit check on each capture.
 *
 * Run:  node scripts/store-screenshots/drop-hype-verify.mjs
 *       SKIP_BUILD=1 node scripts/store-screenshots/drop-hype-verify.mjs   (reuse the last build)
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, 'docs/pr-review/drop-hype');
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

async function open(browser, origin, url) {
  const ctx = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
  await ctx.page.goto(`${origin}${url}`);
  await ctx.page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(ctx.activity, 600, 10_000);
  await ctx.page.waitForTimeout(1200);
  return ctx;
}

async function main() {
  if (!process.env.SKIP_BUILD) buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  let problems = 0;
  const shot = async (page, name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const bad = await textFit(page);
    console.log(`${name}: text-fit ${bad.length ? 'PROBLEMS ' + JSON.stringify(bad) : 'OK'}`);
    problems += bad.length;
  };
  try {
    {
      const { context, page } = await open(browser, origin, '/seller-drops?bt_preview=seller&demo=1');
      const rows = await page.locator('[data-testid^="seller-drop-waitlist-"]').count();
      console.log(`demo drops: Waitlist rows=${rows}`);
      await shot(page, 'after-seller-drops-demo');
      // Through the real row, not a direct URL.
      await page.getByTestId('seller-drop-waitlist-preview-drop-night-shift').click();
      await page.getByTestId('drop-hype-total').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(800);
      console.log(`hype: total=${await page.getByTestId('drop-hype-total').innerText()} today="${await page.getByTestId('drop-hype-today').innerText()}"`);
      await shot(page, 'after-hype-demo');
      await context.close();
    }
    {
      const { context, page } = await open(browser, origin, '/seller-drop-hype?dropId=preview-drop-field-shell&bt_preview=seller&demo=1');
      await page.getByTestId('drop-hype-total').waitFor({ timeout: 10_000 });
      await shot(page, 'after-hype-demo-second-drop');
      await context.close();
    }
    {
      const { context, page } = await open(browser, origin, '/seller-drops?bt_preview=seller');
      await shot(page, 'after-seller-drops-fresh');
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
  if (problems) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
