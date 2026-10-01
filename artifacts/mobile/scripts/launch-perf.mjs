#!/usr/bin/env node
/**
 * Web launch measurement: bundle bytes and time to the first real screen for
 * one or two preview web builds (see scripts/store-screenshots/harness.mjs).
 *
 *   node scripts/launch-perf.mjs --after <build-dir> [--before <build-dir>] [--runs 5] [--role buyer|seller]
 *
 * Phone viewport 393x852, CPU slowed 4x, cache disabled, demo API. The fake
 * demo clock the harness installs makes browser paint timing unreliable, so
 * time is wall clock from the Node side. Reported:
 *   - JS bytes: sum of script responses fetched by the time the first screen is visible.
 *   - First screen: wall time from navigation start until the signed-in home
 *     screen's tab bar is visible (the preview bypass lands on the feed).
 * Numbers are medians. This measures the web bundle only; it is not a device
 * measurement and says nothing about Hermes start-up on iOS/Android.
 */
import path from 'node:path';
import { DEVICES } from './store-screenshots/devices.mjs';
import { launchBrowser, openContext, serveBuild } from './store-screenshots/harness.mjs';

function parseArgs(argv) {
  const options = { before: null, after: null, runs: 5, role: 'buyer' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--before') options.before = path.resolve(argv[++i]);
    else if (argv[i] === '--after') options.after = path.resolve(argv[++i]);
    else if (argv[i] === '--runs') options.runs = Number(argv[++i]);
    else if (argv[i] === '--role') options.role = argv[++i];
  }
  if (!options.after && !options.before) throw new Error('Pass --after <build-dir> (and optionally --before).');
  return options;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function measureOnce(browser, origin, role) {
  const device = { ...DEVICES.find((d) => d.id === 'iphone-6.9in'), viewport: { width: 393, height: 852 }, scale: 1 };
  const { context, page } = await openContext(browser, { device, role, origin, images: {} });
  const scripts = { bytes: 0, count: 0 };
  page.on('response', async (response) => {
    if (response.request().resourceType() !== 'script') return;
    try {
      const length = (await response.body()).length;
      scripts.bytes += length;
      scripts.count += 1;
      if (process.env.LAUNCH_PERF_VERBOSE) console.error(`  script ${response.url().split('/').pop()} ${length}`);
    } catch {
      // aborted request
    }
  });
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const started = Date.now();
    await page.goto(`${origin}/?bt_preview=${role}`, { waitUntil: 'commit' });
    await page.getByRole('tab').first().waitFor({ state: 'visible', timeout: 120_000 }).catch(async () => {
      await page.getByText(/For You|Home|Dashboard/).first().waitFor({ timeout: 120_000 });
    });
    const firstScreenMs = Date.now() - started;
    return { firstScreenMs, jsBytes: scripts.bytes, jsFiles: scripts.count };
  } finally {
    await context.close();
  }
}

async function measureBuild(browser, dir, options) {
  const server = await serveBuild(dir);
  try {
    const runs = [];
    for (let i = 0; i < options.runs; i += 1) runs.push(await measureOnce(browser, server.origin, options.role));
    return {
      firstScreenMs: median(runs.map((r) => r.firstScreenMs)),
      jsBytes: median(runs.map((r) => r.jsBytes)),
      jsFiles: median(runs.map((r) => r.jsFiles)),
      all: runs.map((r) => r.firstScreenMs),
    };
  } finally {
    server.close();
  }
}

const options = parseArgs(process.argv.slice(2));
const browser = await launchBrowser();
try {
  const results = {};
  if (options.before) results.before = await measureBuild(browser, options.before, options);
  if (options.after) results.after = await measureBuild(browser, options.after, options);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
