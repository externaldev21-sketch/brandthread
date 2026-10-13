#!/usr/bin/env node
/**
 * Cookie-consent overlay check (390x844): opens buyer + seller tab roots
 *   - with no stored choice (the consent card is up), and
 *   - with a stored choice (no card),
 * records where the floating tab bar sits in each, and screenshots both.
 * The tab bar must be in exactly the same place either way.
 *
 * The browser is pinned to Europe/Berlin (the card only shows where consent
 * is required). Also captures the Settings sheet, and the queue behind the
 * first-run "Watching Threads" coach (card hidden while it is up, shown
 * after it is dismissed).
 *
 *   node scripts/store-screenshots/cookie-consent-verify.mjs --out <dir> [--build] [--only a,b]
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, buildPreviewWeb, launchBrowser, openContext, serveBuild, waitForImages, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { BUYER_USER } from './demo-data.mjs';

const SCREENS = [
  { id: 'buyer-discover', role: 'buyer', path: '/(buyer)/discover' },
  { id: 'buyer-inbox', role: 'buyer', path: '/(buyer)/inbox' },
  { id: 'buyer-profile', role: 'buyer', path: '/(buyer)/profile' },
  { id: 'seller-dashboard', role: 'seller', path: '/(tabs)' },
];
/** The card only shows where consent is required: pin the browser to the EU. */
const EU = { timezoneId: 'Europe/Berlin' };
const STORED = JSON.stringify({ version: 1, timestamp: 1, necessary: true, analytics: false, marketing: false });

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const BAR_RECT = `(() => {
  const bar = document.querySelector('[data-testid="buyer-bottom-tab-bar"], [data-testid="seller-global-tab-bar"]');
  if (!bar) return null;
  const rects = [...bar.querySelectorAll('*')].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 30 && r.height > 30);
  const top = Math.min(...rects.map((r) => r.top)); const bottom = Math.max(...rects.map((r) => r.bottom));
  const card = document.querySelector('[data-testid="cookie-consent-card"]') || [...document.querySelectorAll('div')].find((d) => /uses cookies/.test(d.textContent || '') && d.children.length < 12);
  const c = card ? card.getBoundingClientRect() : null;
  return { barTop: Math.round(top * 10) / 10, barBottom: Math.round(bottom * 10) / 10, viewport: window.innerHeight,
    card: c ? { top: Math.round(c.top), bottom: Math.round(c.bottom), left: Math.round(c.left), right: Math.round(c.right) } : null };
})()`;

async function main() {
  const out = path.resolve(arg('--out') ?? 'scratch/cookie-consent');
  const only = arg('--only')?.split(',');
  mkdirSync(out, { recursive: true });
  if (process.argv.includes('--build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(path.dirname(DEFAULT_BUILD_DIR), 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const report = [];
  try {
    for (const screen of SCREENS.filter((s) => !only || only.includes(s.id))) {
      for (const state of ['banner', 'chosen']) {
        const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
        const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images, contextOptions: EU });
        try {
          await context.addInitScript(({ stored, chosen, guideKey }) => {
            try {
              localStorage.setItem(guideKey, '1');
              if (chosen) localStorage.setItem('bt:cookie-consent', stored); else localStorage.removeItem('bt:cookie-consent');
            } catch {}
          }, { stored: STORED, chosen: state === 'chosen', guideKey: `feed_gesture_guide_seen:${BUYER_USER.id}` });
          await page.goto(`${origin}${screen.path}?bt_preview=${screen.role}&demo=1`);
          await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
          await waitForQuietNetwork(activity, 900, 15_000);
          await waitForImages(page, 8_000);
          await page.waitForTimeout(2500);
          const m = await page.evaluate(BAR_RECT);
          await page.screenshot({ path: path.join(out, `${screen.id}-${state}.png`), animations: 'disabled', caret: 'hide' });
          report.push({ screen: screen.id, state, ...m });
          if (screen.id === 'buyer-discover' && state === 'banner') {
            const settings = page.getByRole('button', { name: 'Cookie settings' });
            if (await settings.count()) {
              await settings.first().click();
              await page.waitForTimeout(900);
              await page.screenshot({ path: path.join(out, `${screen.id}-settings.png`), animations: 'disabled', caret: 'hide' });
            }
          }
          console.log(`ok ${screen.id} ${state} ${JSON.stringify(m)}`);
        } catch (e) {
          console.log(`FAILED ${screen.id} ${state} ${String(e.message).split('\n')[0]}`);
        } finally {
          await context.close();
        }
      }
    }
    if (!only || only.includes('buyer-feed-coach')) {
      const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
      // Real clock here: the harness's fake clock stalls timers on the busy
      // video feed, which would hold the card's short launch delay forever.
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images, contextOptions: EU, installClock: false });
      try {
        await context.addInitScript(() => {
          try {
            localStorage.removeItem('bt:cookie-consent');
            for (const k of Object.keys(localStorage)) if (/feed_gesture_guide|feed-gestures-tip/.test(k)) localStorage.removeItem(k);
          } catch {}
        });
        // First launch: the coach has not been seen yet.
        await page.route(/feed-gestures-tip/, (route) => route.fulfill({ json: { seenVersion: 0 } }));
        await page.goto(`${origin}/(buyer)?bt_preview=buyer&demo=1`);
        await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
        await waitForQuietNetwork(activity, 900, 15_000);
        await page.waitForTimeout(3000);
        const during = await page.evaluate(() => ({
          coach: !!document.querySelector('[data-testid="feed-gesture-guide"]'),
          card: !!document.querySelector('[data-testid="cookie-consent-card"]'),
        }));
        await page.screenshot({ path: path.join(out, 'buyer-feed-coach-up.png'), animations: 'disabled', caret: 'hide' });
        if (during.coach) {
          await page.getByRole('button', { name: 'Tap to keep watching' }).click();
          await page.waitForTimeout(2000);
        }
        const after = await page.evaluate(() => ({
          coach: !!document.querySelector('[data-testid="feed-gesture-guide"]'),
          card: !!document.querySelector('[data-testid="cookie-consent-card"]'),
        }));
        await page.screenshot({ path: path.join(out, 'buyer-feed-coach-dismissed.png'), animations: 'disabled', caret: 'hide' });
        report.push({ screen: 'buyer-feed-coach', during, after });
        console.log(`ok buyer-feed-coach during=${JSON.stringify(during)} after=${JSON.stringify(after)}`);
      } catch (e) {
        console.log(`FAILED buyer-feed-coach ${String(e.message).split('\n')[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
