/**
 * Header/notch sweep verification (m-r route files, batch 1): captures the
 * migrated screens under ?bt_preview=seller at 393x852, no fake API (so
 * screens render through their real loading/empty/error states) — this is
 * purely to confirm every header sits below the safe-area inset and reads
 * at the standard ScreenHeader size, not to exercise real data.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_DIR, launchBrowser, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT_DIR = process.argv[2] ?? path.join(process.cwd(), '.header-sweep-screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 393, height: 852 };

const SCREENS = [
  { name: '01-meta-ads-setup', path: '/meta-ads-setup' },
  { name: '02-meta-ads-connect', path: '/meta-ads-connect' },
  { name: '03-meta-ads-manage', path: '/meta-ads-manage' },
  { name: '04-manufacturer-hub', path: '/manufacturer-hub' },
  { name: '05-manufacturer-compare', path: '/manufacturer-compare' },
  { name: '06-manufacturer-onboard', path: '/manufacturer-onboard' },
  { name: '07-muted-words', path: '/muted-words' },
  { name: '08-payouts', path: '/payouts' },
  { name: '09-post-analytics', path: '/post-analytics' },
  { name: '10-production-detail', path: '/production-detail' },
  { name: '11-marketing', path: '/(tabs)/marketing' },
  { name: '12-quote-compare', path: '/quote-compare' },
  { name: '13-quote-request', path: '/quote-request' },
  { name: '14-refund-detail', path: '/refund-detail' },
  { name: '15-request-sample', path: '/request-sample' },
  { name: '16-return-detail', path: '/return-detail' },
  { name: '17-rfq-list', path: '/rfq-list' },
  { name: '18-rfq-post', path: '/rfq-post' },
];

async function main() {
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      isMobile: true,
      hasTouch: true,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    const activity = { lastApiAt: 0 };
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === server.origin) return route.continue();
      activity.lastApiAt = Date.now();
      return route.abort();
    });

    const page = await context.newPage();
    await page.goto(`${server.origin}/?bt_preview=seller`);
    await page.waitForTimeout(2000);

    for (const screen of SCREENS) {
      await page.evaluate((url) => {
        history.pushState(history.state, '', url);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, `${screen.path}?bt_preview=seller`);
      await waitForQuietNetwork(activity, 500, 4000).catch(() => {});
      await page.waitForTimeout(1500);
      const file = path.join(OUT_DIR, `${screen.name}.png`);
      await page.screenshot({ path: file });
      console.log('captured', screen.name, '->', file);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
