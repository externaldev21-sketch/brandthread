/**
 * Shared browser harness for the store screenshot and list-performance
 * scripts: builds the web app in preview mode, serves it, and opens screens
 * with a signed-in demo account, seeded storage and a fake API.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { clerkStubScript } from './clerk-stub.mjs';
import { BUYER_USER, IMAGE_HOST, SELLER_USER, localStorageSeed, respond } from './demo-data.mjs';

export const MOBILE_ROOT = path.resolve(import.meta.dirname, '../..');
export const WORK_DIR = path.join(MOBILE_ROOT, '.store-screenshots');
export const DEFAULT_BUILD_DIR = path.join(WORK_DIR, 'web-build');

// A syntactically valid Clerk key for a domain that does not exist. The real
// Clerk script is never loaded; clerk-stub.mjs stands in for it.
const DEMO_CLERK_KEY = `pk_test_${Buffer.from('clerk.brandthread.test$').toString('base64')}`;
const DEMO_API = 'https://api.brandthread.test';

/**
 * Exports the web app with the preview bypass enabled
 * (EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST, the same switch the navigation
 * tests use) and every service pointed at demo hosts. `--clear` matters:
 * Metro otherwise reuses transforms that inlined other EXPO_PUBLIC_* values.
 */
export function buildPreviewWeb(outputDir = DEFAULT_BUILD_DIR, cwd = MOBILE_ROOT) {
  rmSync(outputDir, { recursive: true, force: true });
  const env = {
    ...process.env,
    EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST: '1',
    EXPO_PUBLIC_API_BASE_URL: DEMO_API,
    EXPO_PUBLIC_DOMAIN: 'api.brandthread.test',
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: DEMO_CLERK_KEY,
    EXPO_PUBLIC_CLERK_PROXY_URL: '',
    EXPO_PUBLIC_SENTRY_DSN: '',
    EXPO_PUBLIC_META_PIXEL_ID: '',
    EXPO_PUBLIC_TIKTOK_PIXEL_ID: '',
  };
  const args = ['exec', 'expo', 'export', '--clear', '--platform', 'web', '--output-dir', outputDir];
  const result = process.platform === 'win32'
    ? spawnSync(`pnpm ${args.join(' ')}`, { cwd, env, stdio: 'inherit', shell: true })
    : spawnSync('pnpm', args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0 || !existsSync(path.join(outputDir, 'index.html'))) {
    throw new Error('The web build failed; see the Expo output above.');
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Serves an exported build with the app's own production static server. */
export async function serveBuild(buildDir) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(MOBILE_ROOT, 'server', 'serve.js')], {
    env: { ...process.env, PORT: String(port), EXPO_WEB_BUILD_DIR: buildDir },
    stdio: 'ignore',
  });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const response = await fetch(`${origin}/`);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('The static web server did not start.');
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return { origin, close: () => child.kill() };
}

export async function launchBrowser() {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch();
  } catch (error) {
    if (String(error?.message).includes("Executable doesn't exist")) {
      throw new Error('Chromium for Playwright is not installed. Run once:  pnpm exec playwright install chromium');
    }
    throw error;
  }
}

const HIDE_SCROLLBARS_CSS = `
  *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  * { scrollbar-width: none !important; caret-color: transparent !important; }
`;

/**
 * Opens a fresh browser context for one device and role. Returns the context,
 * the page, and `activity.lastApiAt` (when the fake API last answered).
 */
export async function openContext(browser, { device, role, origin, images, seedOptions = {}, apiOptions = {}, onUnseeded }) {
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.scale,
    isMobile: device.isMobile,
    hasTouch: device.isMobile,
    userAgent: device.userAgent,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const user = role === 'seller' ? SELLER_USER : BUYER_USER;
  await context.addInitScript(clerkStubScript(user));
  await context.addInitScript((seed) => {
    if (sessionStorage.getItem('bt:screenshot-seeded')) return;
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
    sessionStorage.setItem('bt:screenshot-seeded', '1');
  }, localStorageSeed(role, seedOptions));
  await context.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    });
  }, HIDE_SCROLLBARS_CSS);

  const activity = { lastApiAt: Date.now() };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin === IMAGE_HOST) {
      const name = url.pathname.split('/').pop().replace(/\.jpg$/, '');
      const file = images[name];
      if (file) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(file) });
      return route.fulfill({ status: 404, body: '' });
    }
    if (url.origin === DEMO_API) {
      const cors = {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type,x-store-context',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      activity.lastApiAt = Date.now();
      const body = respond({ method: request.method(), path: url.pathname, query: url.searchParams, role, options: apiOptions });
      if (body === undefined) {
        onUnseeded?.(`${request.method()} ${url.pathname}`);
        return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED","message":"Not part of the demo data"}}' });
      }
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    // Everything else (analytics, fonts CDNs, Clerk, …) stays offline so runs are repeatable.
    return route.abort();
  });

  const page = await context.newPage();
  return { context, page, activity };
}

/** Waits until every <img> on the page has finished loading (or failed). */
export async function waitForImages(page, timeout = 10_000) {
  await page.waitForFunction(
    () => [...document.images].every((image) => image.complete),
    undefined,
    { timeout },
  ).catch(() => undefined);
}

/** Waits for the API to go quiet: no demo API request for `quietMs`. */
export async function waitForQuietNetwork(activity, quietMs = 700, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && Date.now() - activity.lastApiAt < quietMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
