/**
 * Deployment-only packaging and HTTP smoke check. The runtime is beside the
 * exported HTML, never inside the public web root. Preview builds do not use it.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'server');
const runtime = path.join(root, 'static-build-runtime');
const output = path.join(root, 'static-build');
const manifestName = 'production-build.json';

function digest(directory) {
  const hash = crypto.createHash('sha256');
  function walk(relative = '') {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      if (name === manifestName) continue;
      if (entry.isDirectory()) walk(name);
      else hash.update(name).update('\0').update(fs.readFileSync(path.join(directory, name)));
    }
  }
  walk();
  return hash.digest('hex');
}

function fileDigest(name) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex');
}

async function freePort() {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

async function main() {
  assert(fs.existsSync(path.join(output, 'app-shell.html')), 'Production export is missing app-shell.html');
  assert.match(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), /Notify me at launch/,
    'Production index.html is not the Notify-me cover');

  if (process.argv.includes('--package')) {
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.cpSync(source, runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, manifestName), JSON.stringify({
      builtAt: new Date().toISOString(),
      runtimeSha256: digest(source),
      indexSha256: fileDigest('index.html'),
      appShellSha256: fileDigest('app-shell.html'),
      entrypoint: 'static-build-runtime/serve.js',
      output: 'static-build',
    }, null, 2) + '\n');
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, manifestName), 'utf8'));
  assert.equal(digest(runtime), manifest.runtimeSha256, 'Packaged server does not match its build manifest');
  assert.equal(digest(source), manifest.runtimeSha256, 'Packaged server is stale relative to the current source');
  assert.equal(fileDigest('index.html'), manifest.indexSha256, 'Cover changed after packaging');
  assert.equal(fileDigest('app-shell.html'), manifest.appShellSha256, 'App shell changed after packaging');

  const port = await freePort();
  const child = spawn(process.execPath, [path.join(runtime, 'serve.js')], {
    cwd: root,
    env: {
      ...process.env, NODE_ENV: 'production', PUBLIC_APP_ENABLED: 'false',
      PORT: String(port), BASE_PATH: '/', EXPO_WEB_BUILD_DIR: 'static-build',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let startupError;
  child.on('error', error => { startupError = error; });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { logs = (logs + chunk).slice(-4000); });
  }
  const request = route => fetch(`http://127.0.0.1:${port}${route}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(3000),
    headers: { accept: 'text/html', host: 'brandthread.app', cookie: '__session=seal-smoke-check' },
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error(`Packaged server exited: ${logs}`);
      try {
        const response = await request('/status');
        await response.text();
        if (response.status === 200) { ready = true; break; }
      } catch { /* Wait only for the temporary production server to bind. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(ready, `Packaged server did not become ready: ${logs}`);

    for (const route of ['/', '/?bt_preview=buyer&app=1']) {
      const response = await request(route);
      const html = await response.text();
      assert.equal(response.status, 200, route);
      assert.match(html, /Notify me at launch/, route);
      assert.doesNotMatch(html, /\/_expo\/static\/js/, route);
      console.log(`Production seal: ${route} -> 200 Notify-me cover`);
    }
    for (const route of ['/feed', '/login', '/signup', '/onboarding', '/inbox', '/activity',
      '/profile', '/welcome', '/pricing', '/fast-preview/', '/feed?bt_preview=seller',
      '/index.html', '/app-shell.html', '/_expo/static/js/web/app.js']) {
      const response = await request(route);
      await response.text();
      assert.equal(response.status, 302, `${route} must not serve the app shell`);
      assert.equal(response.headers.get('location'), '/', route);
      assert.equal(response.headers.get('cache-control'), 'no-store', route);
      console.log(`Production seal: ${route} -> 302 /`);
    }
    for (const route of ['/privacy', '/terms']) {
      const response = await request(route);
      const html = await response.text();
      assert.equal(response.status, 200, route);
      assert.match(html, route === '/privacy' ? /Privacy Policy/ : /Terms of Service/, route);
      assert.doesNotMatch(html, /<script|\/_expo\//, route);
      console.log(`Production seal: ${route} -> 200 standalone legal page`);
    }
    console.log(`Production seal verified: 18 HTTP checks; runtime SHA-256 ${manifest.runtimeSha256}`);
  } finally {
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    killTimer.unref();
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    clearTimeout(killTimer);
  }
}

main().catch(error => {
  console.error(`Production web verification failed: ${error.message}`);
  process.exitCode = 1;
});
