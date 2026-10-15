/**
 * Tab-switch frame captures (390x844) for the layout-stability work: taps
 * Discover / Messages / Profile in the buyer preview and screenshots each
 * switch at 0/100/300/700/1500/3000ms, against the demo API with injected
 * latency so loading states are visible.
 *
 *   Build first with buildPreviewWeb() from ./store-screenshots/harness.mjs, then:
 *   node scripts/tab-switch-frames.mjs <webBuildDir> <outDir> [latencyMs]
 */
import fs from 'node:fs';
import { launchBrowser, serveBuild, openScreen } from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_TIME_ZONE, IMAGE_HOST, localStorageSeed, respond } from './store-screenshots/demo-data.mjs';
import { clerkStubScript } from './store-screenshots/clerk-stub.mjs';
const [buildDir, outDir, latArg] = process.argv.slice(2);
const LAT = Number(latArg ?? 600);
fs.mkdirSync(outDir, { recursive: true });
const DEMO_API = 'https://api.brandthread.test';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const { origin, close } = await serveBuild(buildDir);
const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
  locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'no-preference',
});
await context.addInitScript(clerkStubScript(BUYER_USER));
await context.addInitScript((seed) => {
  if (sessionStorage.getItem('bt:screenshot-seeded')) return;
  for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  localStorage.setItem('bt:intro-splash:launched:v1', 'true');
  sessionStorage.setItem('bt:screenshot-seeded', '1');
}, localStorageSeed('buyer', {}));
const activity = { lastApiAt: Date.now() };
await context.route('**/*', async (route) => {
  const req = route.request(); const url = new URL(req.url());
  if (url.origin === origin) return route.continue();
  if (url.origin === IMAGE_HOST) return route.fulfill({ status: 404, body: '' });
  if (url.origin === DEMO_API) {
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    activity.lastApiAt = Date.now();
    await sleep(LAT); // realistic network latency so loading states are visible
    const body = respond({ method: req.method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
    if (body === undefined) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED"}}' });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  }
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message.split('\n')[0]));
// Start on Profile so Discover and Messages are both genuinely first visits.
await openScreen(page, activity, origin, 'buyer', '/profile');
await page.waitForSelector('[data-testid="buyer-tab-discover"]', { timeout: 30000 });
await sleep(3000);
const marks = [0, 100, 300, 700, 1500, 3000];
async function tap(route, label) {
  await page.getByTestId(`buyer-tab-${route}`).click();
  const t0 = Date.now();
  for (const at of marks) {
    const wait = at - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    await page.screenshot({ path: `${outDir}/${label}-${String(at).padStart(4, '0')}ms.png` });
  }
}
await tap('discover', 'discover-1st');
await tap('inbox', 'messages-1st');
await tap('profile', 'profile-2nd');
await tap('discover', 'discover-2nd');
await tap('inbox', 'messages-2nd');
await tap('discover', 'discover-3rd');
await tap('inbox', 'messages-3rd');
await context.close(); await browser.close(); close();
