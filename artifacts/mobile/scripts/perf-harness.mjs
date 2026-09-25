#!/usr/bin/env node
/**
 * Web performance harness.
 *
 * Serves the static web export (artifacts/mobile/static-build, built via
 * `pnpm run build`) and uses Playwright to visit each route, recording
 * standard browser timing: Time to First Byte, First Contentful Paint,
 * DOMContentLoaded and Load.
 *
 * These are real browser metrics (not app-level console logs), so they
 * work the same whether the export was built in dev or production mode —
 * that's the fairest way to compare the two, since dev-mode JS is
 * unminified and includes extra checks (see PERF_NOTES.md).
 *
 * Only the statically pre-rendered public routes (`PUBLIC_ROUTES` in
 * scripts/build-web.js) are reachable without a live backend + signed-in
 * Clerk session, so those are what this script measures by default.
 * Once pointed at an environment with a real API server and a logged-in
 * session (e.g. a staging deploy), pass --routes to add authenticated
 * buyer/seller routes such as /buyer-product-detail or /(tabs)/products.
 *
 * Usage:
 *   pnpm run build                 # produces static-build/
 *   node scripts/perf-harness.mjs [--base-url http://localhost:PORT] [--routes /a,/b]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_ROUTES = ['/', '/privacy', '/terms', '/community-guidelines'];

function parseArgs(argv) {
  const args = { baseUrl: null, routes: DEFAULT_ROUTES, port: 4173 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base-url') args.baseUrl = argv[++i];
    else if (argv[i] === '--routes') args.routes = argv[++i].split(',').map((r) => r.trim()).filter(Boolean);
    else if (argv[i] === '--port') args.port = parseInt(argv[++i], 10);
  }
  return args;
}

async function measureRoute(page, baseUrl, route) {
  const url = `${baseUrl}${route}`;
  const start = Date.now();
  const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  const status = response ? response.status() : null;
  // The Expo Router web export hydrates client-side after `load`; give the
  // first paint a moment to land before reading paint timing.
  await page.waitForTimeout(500);

  const timing = await page.evaluate(() => {
    const [nav] = performance.getEntriesByType('navigation');
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find((p) => p.name === 'first-contentful-paint');
    return {
      ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav ? Math.round(nav.loadEventEnd) : null,
      firstContentfulPaint: fcp ? Math.round(fcp.startTime) : null,
      transferSizeKb: nav ? Math.round(nav.transferSize / 1024) : null,
    };
  });

  return {
    route,
    status,
    wallClockMs: Date.now() - start,
    ...timing,
  };
}

function findPinnedChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return null;
  const candidate = fs
    .readdirSync(root)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .reverse()
    .map((name) => path.join(root, name, 'chrome-linux', 'chrome'))
    .find((p) => fs.existsSync(p));
  return candidate ?? null;
}

function printTable(results) {
  const cols = ['route', 'status', 'ttfb', 'firstContentfulPaint', 'domContentLoaded', 'load', 'transferSizeKb'];
  const header = ['Route', 'HTTP', 'TTFB (ms)', 'FCP (ms)', 'DCL (ms)', 'Load (ms)', 'Transfer (KB)'];
  const rows = results.map((r) => cols.map((c) => String(r[c] ?? '—')));
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(fmt(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(fmt(row));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let baseUrl = args.baseUrl;
  let server = null;

  if (!baseUrl) {
    const staticBuildDir = path.join(projectRoot, 'static-build');
    if (!fs.existsSync(staticBuildDir)) {
      console.error('static-build/ not found. Run `pnpm run build` first, or pass --base-url for an already-running server.');
      process.exit(1);
    }
    process.env.PORT = String(args.port);
    ({ server } = await import('../server/serve.js'));
    await new Promise((resolve) => server.listen(args.port, '0.0.0.0', resolve));
    baseUrl = `http://localhost:${args.port}`;
    console.log(`Serving static-build/ at ${baseUrl}`);
  }

  const { chromium } = await import('playwright');
  // Prefer a pre-installed browser (some CI/sandbox images pin a chromium
  // build under /opt/pw-browsers that doesn't exactly match this project's
  // Playwright version) so this script doesn't require a network fetch of
  // a matching browser build. Falls back to Playwright's own resolution
  // (PLAYWRIGHT_BROWSERS_PATH / a normal `playwright install`) otherwise.
  const launchOptions = { executablePath: findPinnedChromium() };
  const browser = await chromium.launch(
    launchOptions.executablePath ? launchOptions : {},
  );
  const page = await browser.newPage();

  const results = [];
  for (const route of args.routes) {
    try {
      results.push(await measureRoute(page, baseUrl, route));
    } catch (error) {
      results.push({ route, status: 'ERROR', wallClockMs: null, error: String(error) });
    }
  }

  await browser.close();
  if (server) server.close();

  printTable(results);
  return results;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
