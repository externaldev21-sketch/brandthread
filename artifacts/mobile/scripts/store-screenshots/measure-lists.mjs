#!/usr/bin/env node
/**
 * Measures the long lists (products, seller orders, seller messages) and the
 * discover screen in two web builds and prints a before/after table.
 *
 *   node scripts/store-screenshots/measure-lists.mjs --before <build-dir> --after <build-dir>
 *
 * Build each side with `buildPreviewWeb()` from harness.mjs (the screenshot
 * build). Both sides get identical demo data: 400 products, 400 orders and
 * 400 conversations. The browser runs a phone viewport with the CPU slowed 4×
 * to approximate a mid-range phone. Numbers are medians of --runs (default 3).
 *
 * Metrics:
 *   - Render: from navigation to the first row on screen.
 *   - DOM nodes: elements on the page once rendered (a proxy for mounted rows).
 *   - DOM nodes after scroll: elements still mounted after scrolling 20,000 px.
 *   - Scroll JS: main-thread script time while scrolling those 20,000 px.
 *   - Frames > 100 ms: scroll steps that took longer than 100 ms (visible jank).
 *   - Heap: JS heap in use after scrolling.
 */
import path from 'node:path';
import { DEVICES } from './devices.mjs';
import { launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';

const COUNT = 400;
const SCROLL_DISTANCE = 20_000;
const SCENARIOS = [
  { id: 'products', label: 'Seller products (400)', role: 'seller', path: '/products', ready: `${COUNT} products`, seedOptions: { productCount: COUNT } },
  { id: 'orders', label: 'Seller orders (400)', role: 'seller', path: '/(tabs)/orders', ready: `${COUNT} orders`, apiOptions: { orderCount: COUNT } },
  { id: 'messages', label: 'Seller messages (400)', role: 'seller', path: '/seller-inbox', ready: 'Jordan Reyes', apiOptions: { conversationCount: COUNT } },
  { id: 'discover', label: 'Discover', role: 'buyer', path: '/discover', ready: 'Heavyweight Hoodie — Ember' },
];

function parseArgs(argv) {
  const options = { before: null, after: null, runs: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--before') options.before = path.resolve(argv[++i]);
    else if (argv[i] === '--after') options.after = path.resolve(argv[++i]);
    else if (argv[i] === '--runs') options.runs = Number(argv[++i]);
  }
  if (!options.before || !options.after) throw new Error('Pass --before <build-dir> and --after <build-dir>.');
  return options;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function measureOnce(browser, origin, scenario) {
  const device = { ...DEVICES.find((d) => d.id === 'iphone-6.9in'), scale: 1 };
  const { context, page, activity } = await openContext(browser, {
    device, role: scenario.role, origin, images: {},
    seedOptions: scenario.seedOptions, apiOptions: scenario.apiOptions,
  });
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    let started = 0;
    await openScreen(page, activity, origin, scenario.role, scenario.path, {
      beforeNavigate: async () => {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        started = Date.now();
      },
    });
    await page.getByText(scenario.ready, { exact: false }).first().waitFor({ timeout: 180_000 });
    const renderMs = Date.now() - started;
    await waitForQuietNetwork(activity, 800, 20_000);
    const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);

    const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    // Scroll the same distance in both builds. FlatList renders rows in
    // batches as you approach the end, so when the list is momentarily
    // exhausted, wait for the next batch instead of stopping early.
    const scroll = await page.evaluate(async (distance) => {
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const scroller = [...document.querySelectorAll('div')]
        .filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 200)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!scroller) return { longFrames: 0, scrolled: 0 };
      let longFrames = 0;
      let scrolled = 0;
      let last = performance.now();
      while (scrolled < distance) {
        const room = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
        if (room < 50) {
          const height = scroller.scrollHeight;
          const deadline = performance.now() + 1500;
          while (scroller.scrollHeight === height && performance.now() < deadline) await frame();
          if (scroller.scrollHeight === height) break;
          last = performance.now();
          continue;
        }
        const step = Math.min(700, room, distance - scrolled);
        scroller.scrollTop += step;
        scrolled += step;
        await frame();
        await frame();
        const now = performance.now();
        if (now - last > 100) longFrames += 1;
        last = now;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { longFrames, scrolled: Math.round(scrolled) };
    }, SCROLL_DISTANCE);
    const domAfterScroll = await page.evaluate(() => document.getElementsByTagName('*').length);
    const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    return {
      renderMs,
      domNodes,
      domAfterScroll,
      scrolledPx: scroll.scrolled,
      scrollScriptMs: Math.round((after.ScriptDuration - before.ScriptDuration) * 1000),
      longFrames: scroll.longFrames,
      heapMb: Math.round((after.JSHeapUsedSize / 1024 / 1024) * 10) / 10,
    };
  } finally {
    await context.close();
  }
}

async function measureBuild(buildDir, runs) {
  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const results = {};
  try {
    for (const scenario of SCENARIOS) {
      const samples = [];
      for (let i = 0; i < runs; i += 1) samples.push(await measureOnce(browser, server.origin, scenario));
      results[scenario.id] = Object.fromEntries(Object.keys(samples[0]).map((key) => [key, median(samples.map((s) => s[key]))]));
      console.error(`  ${path.basename(buildDir)} ${scenario.id}: ${JSON.stringify(results[scenario.id])}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  return results;
}

function change(before, after) {
  if (!before) return '';
  const pct = Math.round(((after - before) / before) * 100);
  return pct === 0 ? '±0%' : `${pct > 0 ? '+' : ''}${pct}%`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.error('Measuring the before build…');
  const before = await measureBuild(options.before, options.runs);
  console.error('Measuring the after build…');
  const after = await measureBuild(options.after, options.runs);

  const metrics = [
    ['renderMs', 'Render (ms)'],
    ['domNodes', 'DOM nodes'],
    ['domAfterScroll', 'DOM nodes after scroll'],
    ['scrolledPx', 'Scrolled (px)'],
    ['scrollScriptMs', 'Scroll JS (ms)'],
    ['longFrames', 'Frames > 100 ms'],
    ['heapMb', 'Heap (MB)'],
  ];
  const lines = ['| Screen | Metric | Before | After | Change |', '| --- | --- | ---: | ---: | ---: |'];
  for (const scenario of SCENARIOS) {
    for (const [key, label] of metrics) {
      const b = before[scenario.id][key];
      const a = after[scenario.id][key];
      lines.push(`| ${scenario.label} | ${label} | ${b} | ${a} | ${change(b, a)} |`);
    }
  }
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
