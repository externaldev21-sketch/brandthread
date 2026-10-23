#!/usr/bin/env node
/**
 * Buyer settings + account + misc screen audit (docs/audit/buyer-settings.md).
 * Renders every screen in the area at 393x852 on the signed-in buyer demo
 * harness and saves a top + bottom-scrolled screenshot, plus the text-fit
 * problems, unseeded API calls, page errors and unlabeled buttons per screen.
 *
 *   node scripts/store-screenshots/buyer-settings-audit.mjs [--build] [outDir] [--only=a,b]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { checkTextFit } from './text-fit-check.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = path.resolve(args[0] ?? path.join(WORK_DIR, 'buyer-settings-audit'));
mkdirSync(OUT, { recursive: true });
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
if (process.argv.includes('--build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();

const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

export const SCREENS = [
  ['buyer-settings', '/buyer-settings'],
  ['buyer-settings-menu', '/buyer-settings-menu'],
  ...['activity', 'archive', 'qr', 'close-friends', 'story', 'messages', 'tags', 'comments', 'sharing', 'hidden-words', 'muted', 'restricted', 'favorites', 'content', 'suggested', 'payments', 'notifications', 'accessibility', 'language', 'media', 'appearance', 'privacy-center', 'about']
    .map((s) => [`detail-${s}`, `/buyer-settings-detail?section=${s}`]),
  ['buyer-account-center', '/buyer-account-center'],
  ['buyer-personal-details', '/buyer-personal-details'],
  ['change-password', '/change-password'],
  ['change-email', '/change-email'],
  ['change-phone', '/change-phone'],
  ['buyer-login-activity', '/buyer-login-activity'],
  ['account-type-settings', '/account-type-settings'],
  ['buyer-security', '/buyer-security'],
  ['delete-account', '/delete-account'],
  ['buyer-privacy-settings', '/buyer-privacy-settings'],
  ['buyer-blocked', '/buyer-blocked'],
  ['buyer-muted', '/buyer-muted'],
  ['buyer-restricted', '/buyer-restricted'],
  ['buyer-close-friends', '/buyer-close-friends'],
  ['muted-words', '/muted-words'],
  ['buyer-friend-requests', '/buyer-friend-requests'],
  ['push-notifications', '/push-notifications'],
  ['notification-channels', '/notification-channels'],
  ['appearance', '/appearance'],
  ['biometric-unlock', '/biometric-unlock'],
  ['languages', '/languages'],
  ['first-run-tips-settings', '/first-run-tips-settings'],
  ['help', '/help'],
  ['buyer-problem-report', '/buyer-problem-report'],
  ['buyer-download-data', '/buyer-download-data'],
  ['thread-cash', '/thread-cash'],
  ['thread-cash-history', '/thread-cash-history'],
  ['thread-cash-ledger', '/thread-cash-ledger'],
  ['thread-explainer', '/thread-explainer'],
  ['loyalty', '/loyalty'],
  ['buyer-gift-cards', '/buyer-gift-cards'],
  ['gift-card-buy', '/gift-card-buy'],
  ['buyer-invite', '/buyer-invite'],
  ['invite-code', '/invite/DEMO10'],
  ['buyer-saved', '/buyer-saved'],
  ['buyer-collection', '/buyer-collection'],
  ['buyer-recently-watched', '/buyer-recently-watched'],
  ['buyer-search-history', '/buyer-search-history'],
  ['buyer-your-activity', '/buyer-your-activity'],
  ['buyer-archive', '/buyer-archive'],
  ['buyer-qr-code', '/buyer-qr-code'],
  ['buyer-my-sizes', '/buyer-my-sizes'],
  ['shopping-preferences', '/shopping-preferences'],
  ['buyer-addresses', '/buyer-addresses'],
  ['buyer-payment-methods', '/buyer-payment-methods'],
  ['terms', '/terms'],
  ['privacy', '/privacy'],
];

async function main() {
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const report = {};
  try {
    for (const [name, target] of SCREENS) {
      if (only && !only.includes(name)) continue;
      const unseeded = new Set();
      const errors = [];
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images, onUnseeded: (r) => unseeded.add(r) });
      page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
      try {
        await openScreen(page, activity, origin, 'buyer', target);
        await page.waitForTimeout(1200);
        await waitForQuietNetwork(activity, 600, 8_000);
        await waitForImages(page, 5_000);
        await page.waitForTimeout(400);
        const fit = await checkTextFit(page, { label: name }).catch(() => []);
        const unlabeled = await page.evaluate(() => [...document.querySelectorAll('[role="button"],button')]
          .filter((el) => el.offsetParent !== null && !(el.getAttribute('aria-label') || el.innerText || '').trim())
          .map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
        const text = await page.evaluate(() => document.body.innerText.slice(0, 4000));
        await page.screenshot({ path: path.join(OUT, `${name}.png`) });
        const scrolled = await page.evaluate(() => {
          const els = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 40 && getComputedStyle(d).overflowY !== 'visible');
          els.forEach((el) => { el.scrollTop = el.scrollHeight; });
          return els.length;
        });
        if (scrolled) { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${name}-bottom.png`) }); }
        report[name] = { url: page.url(), fit: fit.length ? fit : undefined, unlabeled, unseeded: [...unseeded], errors: errors.slice(0, 8), text };
        console.log(`${name}: fit=${fit.length} unlabeled=${unlabeled.length} unseeded=${unseeded.size} errors=${errors.length}`);
      } catch (error) {
        report[name] = { failed: error.message };
        console.warn(`FAILED ${name}: ${error.message}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    close();
    writeFileSync(path.join(OUT, only ? 'report-partial.json' : 'report.json'), JSON.stringify(report, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
