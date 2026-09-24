#!/usr/bin/env node
/**
 * Regenerates the App Store and Google Play screenshots.
 *
 *   pnpm run screenshots                  build the web app, then capture everything
 *   pnpm run screenshots -- --skip-build  reuse the last build (much faster)
 *   pnpm run screenshots -- --only discover,cart --devices iphone-6.9in
 *
 * Output: store-screenshots/<device>/<NN-screen>.png plus a README.md that
 * lists every file, its pixel size and the store field it belongs in.
 *
 * The app runs in its web build with a signed-in demo account (see
 * clerk-stub.mjs) and a fake API full of demo data (see demo-data.mjs). No real
 * server, account or payment provider is involved.
 *
 * A screen that fails to render (for example because another branch is
 * rebuilding it) is skipped with the reason, instead of failing the run. Pass
 * --strict to exit non-zero when anything is skipped.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './demo-images.mjs';
import { DEVICES, pixelSize } from './devices.mjs';
import {
  DEFAULT_BUILD_DIR,
  MOBILE_ROOT,
  WORK_DIR,
  buildPreviewWeb,
  launchBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
} from './harness.mjs';

export const OUTPUT_DIR = path.join(MOBILE_ROOT, 'store-screenshots');

/**
 * The screens, in store order. `ready` is visible text that proves the screen
 * rendered with demo data. `prepare` runs after it appears (taps, selections).
 * `fallback` is used when the primary screen cannot render.
 */
export const SCREENS = [
  {
    id: 'buyer-feed',
    title: 'Buyer feed',
    role: 'buyer',
    path: '/(buyer)',
    ready: 'Drop 04 is live',
    note: 'The feed screens are being rebuilt on another branch; if the new feed changes its layout this screen may be skipped until it lands.',
  },
  {
    id: 'product-sheet',
    title: 'Shoppable product sheet',
    role: 'buyer',
    path: '/(buyer)',
    ready: 'Drop 04 is live',
    async prepare(page) {
      await page.getByLabel(/^Shop Field Shell Jacket/).first().click({ timeout: 8_000 });
      await page.getByText(/shop the post/i).first().waitFor({ timeout: 10_000 });
    },
    fallback: { path: '/buyer-product-detail?productId=prod_nl_jacket_rust', ready: 'Field Shell Jacket — Rust', label: 'product page (the sheet opens from the feed)' },
  },
  { id: 'discover', title: 'Discover', role: 'buyer', path: '/discover', ready: 'Heavyweight Hoodie — Ember' },
  { id: 'cart', title: 'Cart', role: 'buyer', path: '/cart', ready: 'Order summary' },
  { id: 'checkout', title: 'Checkout', role: 'buyer', path: '/buyer-checkout?source=cart', ready: '1120 NW Everett Street' },
  { id: 'seller-dashboard', title: 'Seller dashboard', role: 'seller', path: '/(tabs)', ready: '$1,842.50' },
  { id: 'manufacturer-hub', title: 'Manufacturer hub', role: 'seller', path: '/manufacturer-hub', ready: 'Porto Knit Collective' },
  {
    id: 'theme-picker',
    title: 'Theme picker',
    role: 'seller',
    path: '/app-theme',
    ready: 'Choose your Brandthread finish',
    async prepare(page) {
      await page.getByLabel(/^Black & Gold theme/).first().click({ timeout: 5_000 });
      await page.getByText('Using Black & Gold').first().waitFor({ timeout: 5_000 });
    },
  },
];

function parseArgs(argv) {
  const options = { skipBuild: false, strict: false, only: null, devices: null, buildDir: DEFAULT_BUILD_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    else if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--only') options.only = argv[++i].split(',');
    else if (arg === '--devices') options.devices = argv[++i].split(',');
    else if (arg === '--build-dir') options.buildDir = path.resolve(argv[++i]);
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

async function captureOne(browser, { device, screen, origin, images, file }) {
  const unseeded = new Set();
  const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images, onUnseeded: (r) => unseeded.add(r) });
  const attempt = async (target, ready, prepare) => {
    await openScreen(page, activity, origin, screen.role, target);
    await page.getByText(ready, { exact: false }).first().waitFor({ timeout: 20_000 });
    if (prepare) await prepare(page);
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  };
  try {
    try {
      await attempt(screen.path, screen.ready, screen.prepare);
      return { status: 'captured' };
    } catch (error) {
      if (!screen.fallback) throw error;
      await attempt(screen.fallback.path, screen.fallback.ready);
      return { status: 'fallback', reason: `used the ${screen.fallback.label}: ${firstLine(error)}` };
    }
  } catch (error) {
    return { status: 'skipped', reason: firstLine(error), unseeded: [...unseeded] };
  } finally {
    await context.close();
  }
}

function firstLine(error) {
  return String(error?.message ?? error).split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '');
}

function writeReadme(results) {
  const lines = [
    '# Store screenshots',
    '',
    'Generated by `pnpm run screenshots` (see `scripts/store-screenshots/`). Do not edit by hand;',
    're-run the command after UI changes. Demo data only: no real accounts, orders or payments.',
    '',
    '| Folder | Store | Upload to | Size (px) |',
    '| --- | --- | --- | --- |',
    ...DEVICES.filter((d) => results.some((r) => r.device === d.id)).map((d) => {
      const { width, height } = pixelSize(d);
      return `| \`${d.id}/\` | ${d.store} | ${d.field} | ${width} × ${height} |`;
    }),
    '',
    '## Screens',
    '',
    '| # | Screen | Notes |',
    '| --- | --- | --- |',
    ...SCREENS.map((s, i) => `| ${String(i + 1).padStart(2, '0')} | ${s.title} | ${s.note ?? ''} |`),
  ];
  const problems = results.filter((r) => r.status !== 'captured');
  if (problems.length) {
    lines.push('', '## Skipped or substituted in the last run', '', '| Device | Screen | What happened |', '| --- | --- | --- |');
    for (const r of problems) lines.push(`| ${r.device} | ${r.screen} | ${r.status}: ${r.reason} |`);
  }
  lines.push('', `Last generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '');
  writeFileSync(path.join(OUTPUT_DIR, 'README.md'), lines.join('\n'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const devices = DEVICES.filter((d) => !options.devices || options.devices.includes(d.id));
  const screens = SCREENS.filter((s) => !options.only || options.only.includes(s.id));
  if (!devices.length || !screens.length) throw new Error('Nothing to capture: check --only / --devices.');

  if (!options.skipBuild || !existsSync(path.join(options.buildDir, 'index.html'))) {
    console.log('Building the web app in preview mode (a few minutes)…');
    buildPreviewWeb(options.buildDir);
  }

  const server = await serveBuild(options.buildDir);
  const browser = await launchBrowser();
  const results = [];
  try {
    const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
    for (const device of devices) {
      const dir = path.join(OUTPUT_DIR, device.id);
      mkdirSync(dir, { recursive: true });
      for (const screen of screens) {
        const index = SCREENS.indexOf(screen) + 1;
        const file = path.join(dir, `${String(index).padStart(2, '0')}-${screen.id}.png`);
        rmSync(file, { force: true });
        const result = await captureOne(browser, { device, screen, origin: server.origin, images, file });
        results.push({ device: device.id, screen: screen.id, ...result });
        const mark = result.status === 'captured' ? '✓' : result.status === 'fallback' ? '~' : '✗';
        console.log(`${mark} ${device.id.padEnd(20)} ${screen.id}${result.reason ? `  (${result.reason})` : ''}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  // Remove files from screens that no longer exist.
  const expected = new Set(SCREENS.map((s, i) => `${String(i + 1).padStart(2, '0')}-${s.id}.png`));
  for (const device of DEVICES) {
    const dir = path.join(OUTPUT_DIR, device.id);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (name.endsWith('.png') && !expected.has(name)) rmSync(path.join(dir, name));
  }
  writeReadme(results);

  const skipped = results.filter((r) => r.status === 'skipped');
  console.log(`\n${results.length - skipped.length}/${results.length} screenshots saved to ${path.relative(process.cwd(), OUTPUT_DIR) || '.'}/`);
  if (skipped.length) console.log(`${skipped.length} skipped; see store-screenshots/README.md.`);
  if (options.strict && skipped.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    console.error(`\n✖ ${error.message}`);
    process.exit(1);
  });
}
