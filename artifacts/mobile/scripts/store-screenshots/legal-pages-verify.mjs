#!/usr/bin/env node
/**
 * One-off verification for the legal pages PR. Captures at 393x852:
 *   seller-agreement, refund-policy, terms (regression: unchanged look),
 *   and the buyer Settings -> About Brandthread list.
 *
 *   node scripts/store-screenshots/legal-pages-verify.mjs [--skip-build] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { checkTextFit } from './text-fit-check.mjs';
import { WORK_DIR } from './harness.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = path.resolve(args[0] ?? path.join(MOBILE_ROOT, 'screenshots/legal-pages'));
mkdirSync(OUT, { recursive: true });

const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

const SHOTS = [
  { file: 'seller-agreement.png', role: 'buyer', target: '/seller-agreement', ready: 'Seller Agreement' },
  { file: 'seller-agreement-full.png', role: 'buyer', target: '/seller-agreement', ready: 'Seller Agreement', fullPage: true },
  { file: 'refund-policy.png', role: 'buyer', target: '/refund-policy', ready: 'Refund Policy' },
  { file: 'refund-policy-full.png', role: 'buyer', target: '/refund-policy', ready: 'Refund Policy', fullPage: true },
  { file: 'terms.png', role: 'buyer', target: '/terms', ready: 'Terms of Service' },
  { file: 'about-list.png', role: 'buyer', target: '/buyer-settings-detail?section=about', ready: 'Seller agreement' },
  { file: 'about-list-seller.png', role: 'seller', target: '/buyer-settings-detail?section=about', ready: 'Seller agreement' },
];

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const shot of SHOTS) {
      const { context, page, activity } = await openContext(browser, { device, role: shot.role, origin, images });
      try {
        const sep = shot.target.includes('?') ? '&' : '?';
        await page.goto(`${origin}${shot.target}${sep}bt_preview=${shot.role}`);
        await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
        await page.waitForSelector(`text=${shot.ready}`, { timeout: 20_000 }).catch(() => console.warn(`  ready text missing: ${shot.ready}`));
        await waitForQuietNetwork(activity, 500, 8_000);
        await waitForImages(page, 6_000);
        await page.waitForTimeout(500);
        const bodyText = await page.evaluate(() => document.body.innerText);
        if (/LAWYER REVIEW/i.test(bodyText)) throw new Error(`${shot.file}: review marker visible in rendered text`);
        if (shot.fullPage) {
          // The page scrolls inside a ScrollView, so capture it in steps.
          const total = await page.evaluate(() => {
            const el = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 50)
              .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
            return el ? el.scrollHeight : 0;
          });
          console.log(`  ${shot.file}: scroll height ${total}`);
          await page.evaluate(() => {
            const el = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 50)
              .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
            if (el) el.scrollTop = 1400;
          });
          await page.waitForTimeout(300);
        }
        const problems = await checkTextFit(page, { label: shot.file });
        if (problems.length) process.exitCode = 1;
        await page.screenshot({ path: path.join(OUT, shot.file) });
        console.log(`Captured ${shot.file}: ${page.url()}`);
      } catch (error) {
        console.warn(`  FAILED ${shot.file}: ${error.message}`);
        process.exitCode = 1;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await close();
  }
}

main();
