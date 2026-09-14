import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 19139;
const chromePort = 19140;
const profile = await mkdtemp(join(tmpdir(), 'brandthread-nav-'));
const env = { ...process.env, EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST: '1' };
const processes = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env, ...options });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function waitFor(url, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectCdp() {
  const targets = await (await waitFor(`http://127.0.0.1:${chromePort}/json`)).json();
  const target = targets.find((candidate) => candidate.type === 'page' && candidate.url === 'about:blank')
    ?? targets.find((candidate) => candidate.type === 'page' && !candidate.url.endsWith('/background.html'));
  if (!target) throw new Error(`No Chromium app page target found: ${JSON.stringify(targets)}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(cdp, expression, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(cdp, expression)) return;
    await sleep(200);
  }
  const diagnostic = await evaluate(cdp, `({ path: location.pathname, text: document.body.innerText.slice(0, 500) })`);
  throw new Error(`Timed out waiting for browser condition: ${JSON.stringify(diagnostic)}`);
}

try {
  await run('pnpm', ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', 'static-build-navigation'], { cwd: process.cwd() });
  const server = spawn('node', ['server/serve.js'], {
    cwd: process.cwd(),
    env: { ...env, PORT: String(port), EXPO_WEB_BUILD_DIR: 'static-build-navigation' },
    stdio: 'inherit',
  });
  processes.push(server);
  await waitFor(`http://127.0.0.1:${port}/status`);

  const chrome = spawn('/repl/tools/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });
  processes.push(chrome);
  const cdp = await connectCdp();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 400, height: 720, deviceScaleFactor: 1, mobile: true });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/navigation-isolation-probe?bt_preview=seller` });
  await waitForExpression(cdp, `document.querySelector('[aria-label="Buyer card"]') !== null`);

  for (const label of ['Buyer card', 'Seller card', 'Editor card', 'Live modal', 'Comments modal', 'Report modal']) {
    const clicked = await evaluate(cdp, `(() => {
      const node = [...document.querySelectorAll('[role="button"]')].find((el) => el.getAttribute('aria-label') === ${JSON.stringify(label)});
      if (!node) return false;
      node.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Could not tap ${label}`);
    await sleep(700);

    const state = await evaluate(cdp, `(() => {
      const origin = document.querySelector('[data-testid="navigation-isolation-origin"]');
      if (!origin) return { originPresent: false };
      const rect = origin.getBoundingClientRect();
      const style = getComputedStyle(origin);
      const exposed = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && origin.getAttribute('aria-hidden') !== 'true';
      const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      const backgrounds = [];
      for (let node = center; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') backgrounds.push(color);
      }
      return { originPresent: true, exposed, backgrounds, path: location.pathname };
    })()`);
    if (!state.originPresent) throw new Error(`${label}: origin scene was unexpectedly unmounted; retained-scene isolation was not exercised`);
    if (state.exposed) throw new Error(`${label}: previous screen remains visibly exposed at ${state.path}`);
    if (!state.backgrounds.length) throw new Error(`${label}: destination has no opaque surface at viewport center`);

    await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await evaluate(cdp, 'history.back()');
    await waitForExpression(cdp, `document.querySelector('[aria-label=${JSON.stringify(label)}]') !== null`);
  }
  console.log('Expo web navigation scene isolation passed for 6 representative flows.');
} finally {
  await Promise.all(processes.reverse().map((child) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  })));
  // Chromium may leave a short-lived crashpad writer after the browser exits.
  // The OS owns this temporary directory, so a cleanup race must not fail tests.
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(join(process.cwd(), 'static-build-navigation'), { recursive: true, force: true });
}