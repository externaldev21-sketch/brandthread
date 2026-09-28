#!/usr/bin/env node
/**
 * Live verification for the "Pinned chats section" PR (item 66) — drives the
 * real Expo web dev server (already running, e.g. `pnpm exec expo start
 * --web --port 8115`) with the `?bt_preview=buyer` dev-only seeded-inbox
 * bypass (see lib/previewInbox.ts), which never signs in through Clerk.
 * Clerk's browser SDK is stubbed to a "loaded, signed out" no-op so the app
 * never blocks on a real network call to a Clerk domain.
 *
 *   node scripts/inbox-pinned-section-screenshots.mjs [--port 8115]
 *
 * Output: docs/pr-review/inbox-pinned-section/390/*.png
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/inbox-pinned-section/390');

function parseArgs(argv) {
  let port = 8115;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') port = Number(argv[++i]);
  }
  return { port };
}

// A "loaded, signed out" no-op stand-in for Clerk's browser SDK — no network
// call to a real Clerk domain is ever made. bt_preview=buyer never reads
// window.Clerk's user/session (userId is null in that mode, see inbox.tsx's
// loadData), it only needs ClerkProvider to stop waiting on `load()`.
const CLERK_STUB = `(() => {
  const listeners = new Set();
  const noop = () => undefined;
  const target = {
    loaded: false,
    version: '0.0.0-screenshots',
    sdkMetadata: { name: 'screenshots', version: '0.0.0' },
    instanceType: 'development',
    isStandardBrowser: true,
    session: null,
    user: null,
    client: { id: 'client_demo', sessions: [], activeSessions: [], signIn: {}, signUp: {} },
    organization: null,
    __internal_lastEmittedResources: { client: null, session: null, user: null, organization: null },
    status: undefined,
    telemetry: { record: noop },
    async load() { this.loaded = true; },
    addListener(listener) {
      listeners.add(listener);
      listener({ client: null, session: null, user: null, organization: null });
      return () => listeners.delete(listener);
    },
    on(event, handler) { if (event === 'status') handler('ready'); },
    off: noop,
    setActive: async () => undefined,
    signOut: async () => undefined,
    handleRedirectCallback: async () => undefined,
    navigate: async () => undefined,
    buildUrlWithAuth: (url) => url,
  };
  window.Clerk = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === 'then' || typeof prop !== 'string') return undefined;
      return noop;
    },
  });
})();`;

async function main() {
  const { port } = parseArgs(process.argv.slice(2));
  const origin = `http://localhost:${port}`;
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
  });
  // Block real Clerk network domains outright (belt-and-suspenders with the
  // stub above) so a run never depends on outbound network access.
  await context.route(/clerk\.(com|dev|accounts\.dev)/, (route) => route.abort());
  await context.addInitScript(CLERK_STUB);
  const page = await context.newPage();

  console.log(`Opening ${origin}/(buyer)/inbox?bt_preview=buyer ...`);
  await page.goto(`${origin}/(buyer)/inbox?bt_preview=buyer`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByText('Brandthread Agent', { exact: false }).first().waitFor({ timeout: 45_000 });
  // Let images (avatars) and the row entrance animation settle.
  await page.waitForTimeout(1200);

  // Dismiss the cookie-consent banner (unrelated to this PR) so it doesn't
  // cover the bottom rows in the full-page shot.
  const acceptAll = page.getByText('Accept all', { exact: true });
  if (await acceptAll.count()) {
    await acceptAll.first().click();
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: path.join(OUT, '01-inbox-pinned-rows.png'), animations: 'disabled', caret: 'hide' });
  console.log('Saved 01-inbox-pinned-rows.png');

  // Close-up crop of the top of the list (agent thread + the two seeded
  // pinned rows, plus the first unpinned row for contrast) so the pin glyph
  // reads clearly at this small viewport. Located by the known pinned/
  // unpinned row testIDs rather than a guessed pixel offset, so it's
  // resilient to any layout above the list (stories tray, banners, etc.).
  const topBox = await page.getByTestId('inbox-conversation-preview-conversation-brandthread').boundingBox();
  const bottomBox = await page.getByTestId('inbox-conversation-preview-conversation-01').boundingBox();
  if (topBox && bottomBox) {
    const y0 = Math.max(0, topBox.y - 10);
    const y1 = bottomBox.y + bottomBox.height + 10;
    await page.screenshot({
      path: path.join(OUT, '02-pinned-rows-closeup.png'),
      clip: { x: 0, y: y0, width: 390, height: Math.min(y1 - y0, 844 - y0) },
      animations: 'disabled',
      caret: 'hide',
    });
    console.log('Saved 02-pinned-rows-closeup.png');
  } else {
    console.warn('Could not locate pinned rows for the close-up crop; skipped.');
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
