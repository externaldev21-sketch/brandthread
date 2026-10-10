/**
 * Screenshot of the web-only /subscribe hand-off (yearly web checkout) at
 * 393x852 in the dev web preview, where it never calls the checkout API.
 *   node scripts/subscribe-handoff-screenshot.mjs [outDir]   (SKIP_BUILD=1 reuses the last build)
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { buildPreviewWeb, serveBuild, launchBrowser, DEFAULT_BUILD_DIR } from './store-screenshots/harness.mjs';

const out = path.resolve(process.argv[2] ?? '../../screenshots/subscribe-handoff');
mkdirSync(out, { recursive: true });
if (!process.env.SKIP_BUILD) buildPreviewWeb();
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
const page = await context.newPage();
const apiCalls = [];
page.on('request', (r) => { if (r.url().includes('/subscription/checkout')) apiCalls.push(r.url()); });
await page.route('**/*', (r) => (new URL(r.request().url()).origin === server.origin ? r.continue() : r.abort()));
await page.goto(`${server.origin}/?bt_preview=seller`);
await page.waitForTimeout(2500);
await page.evaluate((url) => { history.pushState(history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }, '/subscribe?plan=growth&billing=annual');
await page.waitForTimeout(2500);
await page.getByText('Necessary only', { exact: true }).first().click({ timeout: 1500 }).catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, 'subscribe-handoff-393.png') });
await browser.close();
await server.close?.();
if (apiCalls.length) {
  console.error(`preview called the checkout API: ${apiCalls.join(', ')}`);
  process.exit(1);
}
console.log(`Wrote ${path.join(out, 'subscribe-handoff-393.png')}`);
process.exit(0);
