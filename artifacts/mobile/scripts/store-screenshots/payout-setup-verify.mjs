#!/usr/bin/env node
/**
 * Captures the payout setup checklist at 393x852 in every state (demo data,
 * signed-out preview: ?bt_preview=seller&demo=1&state=...). Run after
 * buildPreviewWeb():  node scripts/store-screenshots/payout-setup-verify.mjs [outDir] [--build]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const args = process.argv.slice(2);
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/onboarding'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };
const STATES = ['not_started', 'in_progress', 'in_review', 'restricted', 'complete'];

async function main() {
  if (args.includes('--build')) buildPreviewWeb();
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    for (const state of STATES) {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
      await page.goto(`${origin}/payout-setup?bt_preview=seller&demo=1&state=${state}`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await waitForQuietNetwork(activity, 500, 8_000);
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, `payout-setup-${state}.png`) });
      // Text-fit pass: no clipped text, nothing overflowing its parent, nothing past the viewport.
      const problems = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('[data-testid="payout-setup-scroll"] *, [data-testid="payout-setup-cta"] *, [data-testid="payout-setup-cta"]')) {
          if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const r = el.getBoundingClientRect();
          const pr = el.parentElement.getBoundingClientRect();
          const txt = el.textContent.trim().slice(0, 40);
          if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped: ${txt}`);
          if (r.left < 16 - 0.5 || r.right > window.innerWidth - 16 + 0.5) out.push(`outside 16px gutter: ${txt}`);
          if (r.right > pr.right + 1 || r.left < pr.left - 1) out.push(`overflows parent: ${txt}`);
          if (parseFloat(getComputedStyle(el).fontSize) < 12) out.push(`font < 12: ${txt}`);
        }
        return out;
      });
      if (problems.length) { console.error(`FIT PROBLEMS (${state}):`, problems); process.exitCode = 1; } else console.log(`fit ok (${state})`);
      const list = await page.$('[data-testid="payout-step-identity"]');
      if (list) {
        const box = await list.evaluate((el) => { const r = el.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        await page.screenshot({ path: path.join(OUT, `zoom-card-${state}.png`), clip: box });
      }
      const cta = await page.$('[data-testid="payout-setup-cta"]');
      if (cta) await cta.screenshot({ path: path.join(OUT, `zoom-button-${state}.png`) });
      console.log(`Captured ${state}: ${page.url()}`);
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
