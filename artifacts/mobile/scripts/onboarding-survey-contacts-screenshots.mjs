#!/usr/bin/env node
/**
 * Screenshots (393x852) + text-fit check for feature 10: onboarding Sizes step,
 * "Brands you might like" row, contacts pre-permission and results.
 *
 *   node scripts/onboarding-survey-contacts-screenshots.mjs [--skip-build]
 *
 * The preview has no real Clerk session or contacts: the brands row, contacts
 * screens use the `&demo=1` sample data, and the Sizes step is shown from a
 * seeded onboarding draft. Output: docs/pr-assets/onboarding-survey-contacts/393x852
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { assertTextFits } from './textFitCheck.mjs';

const OUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'onboarding-survey-contacts', '393x852');
const VIEWPORT = { width: 393, height: 852 };
const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };

async function openReliably(page, activity, origin, target) {
  for (let i = 0; i < 5; i += 1) {
    await openScreen(page, activity, origin, 'buyer', target);
    await page.waitForTimeout(700);
    if ((await page.evaluate(() => window.location.pathname)).startsWith(target.split('?')[0])) return;
  }
  throw new Error(`never reached ${target}`);
}

async function main() {
  process.env.EXPO_PUBLIC_CONTACT_SYNC_ENABLED = '1';
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const issues = [];
  const shot = async (page, name, zoom) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
    issues.push(...(await assertTextFits(page, name)).map((i) => ({ screen: name, ...i })));
    if (zoom) {
      await page.screenshot({ path: path.join(OUT, `${name}-zoom.png`), animations: 'disabled', clip: zoom });
    }
  };
  try {
    // 1) Sizes step, from a seeded per-user onboarding draft.
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images: {} });
      await context.addInitScript(() => {
        localStorage.setItem('onboarding_draft:user_jordan', JSON.stringify({
          version: 8, ownerId: 'user_jordan', flow: 'buyer', step: 5, firstName: 'Jordan', lastName: '',
          username: 'jordanreyes', styleInterests: ['Streetwear', 'Minimal'],
          survey: { sizes: { tops: 'M', shoes: '10' }, likedBrandIds: [] },
        }));
      });
      await openReliably(page, activity, origin, '/onboarding?demo=1');
      await waitForQuietNetwork(activity, 600, 8000);
      await shot(page, '01-survey-sizes-step', { x: 0, y: 180, width: 393, height: 600 });
      await context.close();
    }
    // 2) Brands you might like row on Discover (demo sample brands).
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images: {} });
      await openReliably(page, activity, origin, '/discover?demo=1');
      await waitForQuietNetwork(activity, 800, 8000);
      await shot(page, '02-brands-you-might-like', { x: 0, y: 100, width: 393, height: 360 });
      await context.close();
    }
    // 3) Contacts pre-permission + results (demo people, no real contacts read).
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images: {} });
      await openReliably(page, activity, origin, '/find-friends-contacts?demo=1');
      await shot(page, '03-contacts-pre-permission');
      await page.getByText('Continue', { exact: true }).first().click();
      await page.waitForTimeout(1200);
      await shot(page, '04-contacts-results', { x: 0, y: 100, width: 393, height: 500 });
      await context.close();
    }
    // 4) The single "Find from contacts" entry row on the connections screen.
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images: {} });
      await openReliably(page, activity, origin, '/buyer-friend-requests');
      await waitForQuietNetwork(activity, 800, 8000);
      await shot(page, '05-connections-entry-row', { x: 0, y: 100, width: 393, height: 240 });
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
  console.log(issues.length ? `TEXT-FIT ISSUES: ${issues.length}` : 'TEXT-FIT: no issues');
  process.exitCode = issues.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
