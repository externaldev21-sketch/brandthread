#!/usr/bin/env node
/**
 * Screenshots for the referral program (invite screen + Thread Cash history
 * row) at 393x852 using the preview-demo opt-in (?bt_preview=buyer&demo=1).
 *   node scripts/referral-screenshots.mjs [--skip-build]
 * Output: docs/pr-assets/referral-thread-cash/
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, serveBuild, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'referral-thread-cash');

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  mkdirSync(OUT, { recursive: true });
  try {
    for (const [name, route] of [
      ['invite-screen', '/buyer-invite'],
      ['thread-cash-history-referral-row', '/thread-cash'],
    ]) {
      const context = await browser.newContext({
        viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark',
      });
      await context.route('**/*', (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
      const page = await context.newPage();
      await page.goto(`${origin}${route}?bt_preview=buyer&demo=1`);
      await page.waitForTimeout(6000);
      await page.getByText('Necessary only').first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
      await page.mouse.move(200, 500);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `${name}-scrolled.png`), fullPage: false });
      console.log('saved', name);
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
