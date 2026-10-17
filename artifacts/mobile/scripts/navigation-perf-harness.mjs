#!/usr/bin/env node
// Production-web comparison. This deliberately does not claim to measure
// Hermes, native compositor frames, or physical iPhone input latency.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const dir = path.resolve(option('--dir', '.local/performance/baseline'));
const out = path.resolve(option('--out', '.local/performance/before.json'));
const runs = Number(option('--runs', '3'));
const cpu = Number(option('--cpu', '1'));
const mime = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = path.resolve(dir, `.${pathname}`);
    if (!file.startsWith(`${dir}/`) && file !== dir) { res.writeHead(403).end(); return; }
    try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html'); }
    catch { file = `${file}.html`; }
    try { await stat(file); } catch { file = path.join(dir, 'index.html'); }
    res.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const screens = [
  ['buyer', 'Home', '/(buyer)', 'Home'], ['buyer', 'Discover', '/(buyer)/discover', 'Discover'],
  ['buyer', 'Inbox', '/(buyer)/inbox', 'Inbox'], ['buyer', 'Activity', '/(buyer)/activity', 'Activity'],
  ['buyer', 'Profile', '/(buyer)/profile', 'Profile tab'],
  ['seller', 'Dashboard', '/(tabs)', 'Dashboard'], ['seller', 'Products', '/(tabs)/products', 'Products'],
  ['seller', 'Orders', '/(tabs)/orders', 'Orders'],
  ['seller', 'Profile', '/(tabs)/profile', 'Profile'],
  ['buyer', 'Search', '/buyer-search'], ['buyer', 'Bag', '/cart'],
  ['buyer', 'Settings', '/buyer-settings'], ['buyer', 'Addresses', '/buyer-addresses'],
  ['buyer', 'Edit profile', '/edit-profile'], ['buyer', 'Privacy settings', '/buyer-privacy-settings'],
  ['buyer', 'Notification settings', '/notification-settings-page'],
  ['buyer', 'Search history', '/buyer-search-history'], ['buyer', 'Help', '/help'], ['buyer', 'Thread Cash', '/thread-cash'],
  ['seller', 'Add product', '/add-product'], ['seller', 'Finance', '/finance'],
  ['seller', 'Customers', '/customers'], ['seller', 'Store builder', '/store-builder'],
  ['seller', 'Store settings', '/store-settings'], ['seller', 'Settings', '/seller-settings'],
  ['seller', 'Product launches', '/product-launches'], ['seller', 'Store collections', '/store-collections'],
  ['seller', 'Analytics reports', '/analytics-reports'], ['seller', 'Notification settings', '/notifications-settings'],
];
function instrument() {
  let define;
  Object.defineProperty(globalThis, '__d', {
    configurable: true, get: () => define,
    set(real) {
      define = (factory, ...rest) => real(function (...args) {
        const result = factory.apply(this, args);
        if (!globalThis.__perfRouter) {
          const exports = args[4]?.exports ?? args[5];
          queueMicrotask(() => {
            try {
              if (exports?.router?.push && exports?.router?.replace) globalThis.__perfRouter = exports.router;
            } catch { /* An incomplete circular export is not a router. */ }
          });
        }
        return result;
      }, ...rest);
    },
  });
  globalThis.__navProbe = { frames: [], longTasks: [], pending: false, start: 0, last: 0, pointer: null };
  const p = globalThis.__navProbe;
  const finish = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!p.pending || p.result) return;
    p.pending = false;
    p.result = {
      ms: performance.now() - (p.pointer ?? p.start),
      dispatchMs: performance.now() - p.start,
      frameGaps: p.frames.length,
      missedJsFrames: p.frames.reduce((n, dt) => n + Math.max(0, Math.round(dt / (1000 / 60)) - 1), 0),
      worstJsFrameMs: Math.max(0, ...p.frames), longTasks: [...p.longTasks],
      path: location.pathname, text: document.body.innerText.slice(0, 180),
    };
  }));
  // Timestamp inside the browser, not after Playwright's action promise:
  // automation can wait for navigation/network well past the actual frame.
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const before = location.pathname + location.search;
      const result = original.apply(this, args);
      if (p.pending && location.pathname + location.search !== before) finish();
      return result;
    };
  }
  addEventListener('popstate', () => { if (p.pending) finish(); });
  document.addEventListener('pointerdown', () => { p.pointer = performance.now(); }, true);
  const tick = at => {
    if (p.pending && p.last) p.frames.push(at - p.last);
    p.last = at;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver(entries => {
      for (const e of entries.getEntries()) if (p.pending) p.longTasks.push(e.duration);
    }).observe({ type: 'longtask' });
  } catch {}
}
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [], errors = [];
try {
  for (const screen of screens.filter((s, i) =>
    (!option('--only', '') || option('--only', '').split(',').includes(s[1])) &&
    (!args.includes('--probe') || i === 0 || i === 5))) {
    const role = screen[0];
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.addInitScript(instrument);
    const page = await context.newPage();
    page.on('pageerror', e => errors.push({ role, error: e.message }));
    // A test-only transport proxy for localhost's CORS origin. Responses are
    // fetched unchanged from the real dev API; no fixtures or auth bypass.
    const apiOrigin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    await page.route(`${apiOrigin}/api/**`, async route => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': base, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' } });
        return;
      }
      const headers = { ...route.request().headers() };
      delete headers.origin;
      try {
        const response = await route.fetch({ headers });
        await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': base } });
      } catch (error) {
        if (!page.isClosed()) {
          errors.push({ role, error: `Dev API transport: ${error.message}` });
          await route.abort().catch(() => {});
        }
      }
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto(`${base}/?bt_preview=${role}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__perfRouter, undefined, { timeout: 60000 });
    await page.waitForTimeout(3500);
    const coach = page.getByRole('button', { name: 'Keep watching', exact: true });
    if (await coach.isVisible()) await coach.tap();
    if (args.includes('--probe')) {
      console.log(JSON.stringify({ role, body: (await page.locator('body').innerText()).slice(0, 1800),
        buttons: await page.getByRole('button').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') || n.textContent).slice(-25)),
        tabs: await page.getByRole('tab').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') || n.textContent)) }));
      await context.close();
      continue;
    }
    for (const [, name, route, tab] of [screen]) {
      const samples = [];
      for (let run = 0; run < runs; run++) {
        // Always leave the target first; a re-tap of an active tab isn't navigation.
        const exit = role === 'buyer'
          ? (name === 'Home' ? '/(buyer)/discover' : '/(buyer)')
          : (name === 'Dashboard' ? '/(tabs)/products' : '/(tabs)');
        // Never replace a pushed screen with a fresh tab group: that can
        // accumulate duplicate retained groups and invalidates the benchmark.
        await page.evaluate(() => globalThis.__perfRouter.dismissAll());
        await page.waitForTimeout(100);
        await page.evaluate(href => globalThis.__perfRouter.navigate(href), exit);
        const exitPath = exit.replace(/\/\([^)]*\)/g, '') || '/';
        await page.waitForFunction(expected => location.pathname === expected, exitPath, { timeout: 15000 });
        await page.waitForTimeout(500);
        const oldPath = await page.evaluate(() => location.pathname + location.search);
        if (args.includes('--profile')) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.start');
        }
        await page.evaluate(() => {
          const p = globalThis.__navProbe;
          Object.assign(p, { frames: [], longTasks: [], pending: true, result: null, start: performance.now(), last: performance.now(), pointer: null });
        });
        let kind = 'dispatch';
        const button = tab ? page.getByRole(role === 'buyer' && tab === 'Profile tab' ? 'button' : 'tab',
          { name: tab.endsWith(' tab') ? tab : `${tab} tab`, exact: true }) : null;
        if (button && await button.count() === 1 && await button.isVisible()) {
          kind = 'actual-tab-tap';
          await button.tap();
        } else {
          await page.evaluate(href => globalThis.__perfRouter.navigate(href), route);
        }
        let sample;
        try {
          await page.waitForFunction(() => !!globalThis.__navProbe.result, undefined, { timeout: 10000 });
          sample = await page.evaluate(() => globalThis.__navProbe.result);
        } catch (error) { sample = { error: String(error), path: await page.evaluate(() => location.pathname) }; }
        if (args.includes('--profile')) {
          const { profile } = await cdp.send('Profiler.stop');
          await mkdir(path.dirname(out), { recursive: true });
          await writeFile(`${out}.${role}-${name.replaceAll(' ', '-')}-${run}.cpuprofile`, JSON.stringify(profile));
        }
        samples.push({ kind, ...sample });
        await page.waitForTimeout(400);
      }
      const valid = samples.filter(s => Number.isFinite(s.ms));
      const values = valid.map(s => s.ms).sort((a,b) => a-b);
      const row = { role, name, route, medianMs: values.length ? Math.round(values[Math.floor(values.length / 2)]) : null, samples };
      results.push(row);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify({ mode: 'minified production Expo web; not Hermes/native',
        metric: 'input/dispatch to second frame after URL commit; not native compositor paint',
        cpuThrottle: cpu, runs, results, errors }, null, 2));
      console.log(JSON.stringify({ role, name, medianMs: row.medianMs, modes: [...new Set(samples.map(s=>s.kind))], paths: [...new Set(samples.map(s=>s.path))] }));
    }
    await context.close();
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ mode: 'minified production Expo web; not Hermes/native', metric: 'input/dispatch to second frame after URL commit; not native compositor paint', cpuThrottle: cpu, runs, results, errors }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
