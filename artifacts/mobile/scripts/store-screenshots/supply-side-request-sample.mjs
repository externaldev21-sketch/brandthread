/**
 * Verification screenshots for the request-sample blank-render fix.
 * Captures the bare route (no manufacturerId, matching what the audit
 * crawler hits) at 393x852 to confirm it now shows a real header + empty
 * state instead of a blank page, plus the manufacturer-profile entry point.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_DIR, launchBrowser, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT_DIR = process.argv[2] ?? path.join(process.cwd(), '.supply-side-screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 393, height: 852 };

const SCREENS = [
  { name: '01-request-sample-no-id', path: '/request-sample' },
  { name: '02-manufacturer-profile', path: '/manufacturer-profile?id=1' },
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
      }, `${screen.path}${screen.path.includes('?') ? '&' : '?'}bt_preview=seller`);
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
