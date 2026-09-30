/**
 * Verification screenshots for the supply-side hard-findings fix: seller
 * role, fresh data, 393x852, using the same fake-API harness (openContext)
 * as the half-done audit itself. Confirms these detail/list screens now
 * render real seeded data instead of hitting the mock API's 404 fallback
 * (the fake backend previously had no handler at all for these endpoints).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT_DIR = process.argv[2] ?? path.join(process.cwd(), '.supply-side-hard-findings-screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 393, height: 852 };

const SCREENS = [
  { name: '01-rfq-list', path: '/rfq-list' },
  { name: '02-rfq-compare', path: '/rfq-compare?rfqId=sample-1' },
  { name: '03-quote-detail', path: '/quote-detail?quoteId=sample-1' },
  { name: '04-quote-compare', path: '/quote-compare?requestId=sample-1' },
  { name: '05-sample-detail', path: '/sample-detail?id=prod_nl_jacket_rust' },
  { name: '06-production-detail', path: '/production-detail?id=prod_nl_jacket_rust' },
  { name: '07-freelancer-jobs', path: '/freelancer-jobs' },
  { name: '08-freelancer-profile', path: '/freelancer-profile?id=prod_nl_jacket_rust' },
  { name: '09-invite-manufacturer', path: '/invite-manufacturer' },
  { name: '10-manufacturer-messages', path: '/manufacturer-messages' },
];

async function main() {
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
    const { context, page, activity } = await openContext(browser, {
      device: { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: undefined },
      role: 'seller',
      origin: server.origin,
      images,
    });
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200)); });

    for (const screen of SCREENS) {
      consoleErrors.length = 0;
      // A full navigation (not the client-side pushState/popstate trick used
      // elsewhere) — more reliable for a first deep link into a pushed
      // (non-tab) screen than history.pushState, which occasionally leaves
      // the previous tab's content mounted on this app's web router.
      await page.goto(`${server.origin}${screen.path}${screen.path.includes('?') ? '&' : '?'}bt_preview=seller`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await waitForQuietNetwork(activity, 800, 8000).catch(() => {});
      await page.waitForTimeout(1500);
      const file = path.join(OUT_DIR, `${screen.name}.png`);
      await page.screenshot({ path: file });
      console.log('captured', screen.name, '->', file, consoleErrors.length ? `CONSOLE ERRORS: ${JSON.stringify(consoleErrors)}` : '(no console errors)');
    }
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
