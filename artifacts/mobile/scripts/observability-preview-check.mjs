#!/usr/bin/env node
/**
 * Proves the web preview (393x852) still loads with analytics and crash
 * reporting unconfigured: no page errors, and no request to PostHog or Sentry.
 * With --with-key it builds with a dummy EXPO_PUBLIC_POSTHOG_KEY and proves
 * that, with no cookie consent given, still nothing is sent.
 *
 *   node scripts/observability-preview-check.mjs [--with-key] [--skip-build]
 *
 * Output: docs/pr-assets/observability/*.png (repo root)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openContext, openScreen, serveBuild, buildPreviewWeb, MOBILE_ROOT } from './store-screenshots/harness.mjs';

const withKey = process.argv.includes('--with-key');
const buildDir = path.join(MOBILE_ROOT, '.store-screenshots', withKey ? 'obs-build-key' : 'obs-build');
const outDir = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'observability');
mkdirSync(outDir, { recursive: true });

if (!process.argv.includes('--skip-build')) {
  if (withKey) process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_dummy_key_for_preview_check';
  buildPreviewWeb(buildDir);
}

const server = await serveBuild(buildDir);
const browser = await launchBrowser();
const device = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
};
// The harness answers the app's own API with demo data and aborts every other
// external host, so a PostHog/Sentry request would still show up in 'request'.
const { page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images: {} });
const errors = [];
const watched = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
});
page.on('request', (r) => {
  if (/posthog|sentry\.io|ingest\./i.test(r.url())) watched.push(r.url());
});
await openScreen(page, activity, server.origin, 'buyer', '/');
await page.waitForTimeout(3000);
await page.screenshot({
  path: path.join(outDir, withKey ? 'preview-393-key-no-consent.png' : 'preview-393-no-keys.png'),
  animations: 'disabled',
});
console.log(JSON.stringify({ withKey, analyticsOrSentryRequests: watched, consoleErrors: errors }, null, 2));
await browser.close();
server.close();
