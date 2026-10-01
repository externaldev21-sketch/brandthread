#!/usr/bin/env node
/**
 * Captures the Payouts > Bank account tab at 393x852 (before/after the
 * "Payout setup checklist" row) from an already exported web build.
 *   node scripts/store-screenshots/payouts-row-verify.mjs <buildDir> <before|after> [outDir]
 * The preview API stub answers /api/seller/connect/status as a connected,
 * not-yet-verified account so the row is visible (demo preview, &demo=1).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const [buildDirArg, label = 'after', outArg] = process.argv.slice(2);
const OUT = path.resolve(outArg ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/onboarding'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

const STATUS = {
  connected: true, stripeAccountId: 'acct_demo', chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
  status: 'pending', verified: false, bankLast4: null, providerConfigured: true, payoutSchedule: null,
  requirementsDue: ['individual.verification.document', 'external_account'], taxInfoStatus: 'needed',
};

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(path.resolve(buildDirArg));
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    await context.route(/\/seller\/connect\/status/, (route) => {
      const req = route.request();
      const headers = { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(STATUS) });
    });
    await page.goto(`${origin}/payouts?bt_preview=seller&demo=1`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await waitForQuietNetwork(activity, 500, 8_000);
    await page.click('[data-testid="seller-payouts-tab-settings"]');
    await page.waitForTimeout(800);
    const row = await page.$('[data-testid="seller-payouts-setup-checklist"]');
    const anchor = row ?? (await page.$('[data-testid="seller-payouts-bank-account"]'));
    // Scroll so the Bank account section sits mid-screen, clear of the tab bar.
    await anchor?.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `payouts-bank-tab-${label}.png`) });
    console.log(`${label}: row present = ${Boolean(row)}`);
    const problems = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[data-testid="seller-payouts-setup-checklist"], [data-testid="seller-payouts-setup-checklist"] *')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const r = el.getBoundingClientRect();
        const pr = el.parentElement.getBoundingClientRect();
        const txt = el.textContent.trim().slice(0, 40);
        if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped: ${txt}`);
        if (r.left < 16 - 0.5 || r.right > window.innerWidth - 16 + 0.5) out.push(`outside gutter: ${txt}`);
        if (r.right > pr.right + 1 || r.left < pr.left - 1) out.push(`overflows parent: ${txt}`);
        if (parseFloat(getComputedStyle(el).fontSize) < 12) out.push(`font < 12: ${txt}`);
      }
      return out;
    });
    if (row) {
      console.log(problems.length ? `FIT PROBLEMS: ${JSON.stringify(problems)}` : 'fit ok');
      if (problems.length) process.exitCode = 1;
    }
    const zoomTarget = row ?? (await page.$('[data-testid="seller-payouts-bank-account"]'));
    if (zoomTarget) {
      const box = await zoomTarget.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 120), width: window.innerWidth, height: 300 }; });
      await page.screenshot({ path: path.join(OUT, `payouts-bank-tab-zoom-${label}.png`), clip: box });
    }
    await context.close();
  } finally {
    await browser.close();
    close();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
