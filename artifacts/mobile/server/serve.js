/**
 * Production server for the Expo Router web export.
 *
 * Browser routes need SPA fallback because Expo Router can navigate to paths
 * that do not have a pre-rendered HTML file. API requests are handled by the
 * project routing layer, not this static server, so this server only serves
 * the exported browser app and its assets.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { renderSharePreview } = require('./sharePreview');
const { landingPathFor, shouldServeLanding } = require('./landing');

const STATIC_ROOT = path.resolve(
  __dirname,
  '..',
  process.env.EXPO_WEB_BUILD_DIR || 'static-build',
);
const GENERATED_HOST = 'brandthread.replit.app';
const CANONICAL_ORIGIN = 'https://brandthread.app';
const basePath = (process.env.BASE_PATH || '/').replace(/\/+$/, '');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
};

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

function sendHtml(res, status, html, acceptEncoding = '') {
  if (/\bgzip\b/.test(acceptEncoding)) {
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'vary': 'Accept-Encoding',
    });
    res.end(zlib.gzipSync(html));
    return;
  }
  send(res, status, html, 'text/html; charset=utf-8');
}

function safeFilePath(urlPath) {
  const normalized = path.posix.normalize(`/${urlPath}`).replace(/^\/+/, '');
  const filePath = path.resolve(STATIC_ROOT, normalized);
  if (filePath !== STATIC_ROOT && !filePath.startsWith(`${STATIC_ROOT}${path.sep}`)) {
    return null;
  }
  return filePath;
}

const COMPRESSIBLE_EXTS = new Set(['.html', '.js', '.css', '.json', '.svg', '.map']);

function serveFile(filePath, res, acceptEncoding = '') {
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'content-type': MIME_TYPES[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  const body = fs.readFileSync(filePath);
  // Text assets compress well and dominate initial page weight (JS bundles,
  // the HTML shell); images/fonts are already compressed formats.
  if (COMPRESSIBLE_EXTS.has(ext) && /\bgzip\b/.test(acceptEncoding)) {
    headers['content-encoding'] = 'gzip';
    headers['vary'] = 'Accept-Encoding';
    res.writeHead(200, headers);
    res.end(zlib.gzipSync(body));
    return true;
  }
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

function canonicalRedirectLocation(req, requestUrl) {
  const forwardedHost = req.headers?.['x-forwarded-host'];
  const hostHeader = String(forwardedHost || req.headers?.host || '')
    .split(',')[0]
    .trim()
    .replace(/:\d+$/, '')
    .toLowerCase();
  if (hostHeader !== GENERATED_HOST) return null;
  return `${CANONICAL_ORIGIN}${requestUrl.pathname}${requestUrl.search}`;
}

const server = http.createServer(async (req, res) => {
  let pathname;
  let requestUrl;
  try {
    requestUrl = new URL(req.url || '/', 'http://localhost');
    pathname = requestUrl.pathname;
  } catch {
    send(res, 400, 'Bad Request');
    return;
  }

  const redirectLocation = canonicalRedirectLocation(req, requestUrl);
  if (redirectLocation) {
    res.writeHead(301, {
      location: redirectLocation,
      'cache-control': 'public, max-age=31536000, immutable',
    });
    res.end();
    return;
  }

  if (pathname === '/status' || pathname === `${basePath}/status`) {
    send(res, 200, JSON.stringify({ ok: true, service: 'brandthread-web' }), 'application/json; charset=utf-8');
    return;
  }

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || '/';
  }

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(pathname);
  } catch {
    send(res, 400, 'Bad Request');
    return;
  }
  const acceptEncoding = String(req.headers['accept-encoding'] || '');

  // Public account-deletion page (Google Play requires a URL that works
  // without the app). Plain HTML, not part of the SPA, so it never depends on
  // a signed-in session; it calls /api/public/account-deletion/*.
  if (/^\/account-deletion\/?$/.test(requestedPath)) {
    const page = fs.readFileSync(path.join(__dirname, 'templates', 'account-deletion.html'), 'utf8');
    sendHtml(res, 200, page, acceptEncoding);
    return;
  }

  // Signed-out visits to "/" (and "/welcome") get the static marketing page.
  // Everything else, including any session cookie or query string, falls
  // through to the unchanged app handling below.
  if (shouldServeLanding({
    method: req.method,
    pathname: requestedPath,
    searchParams: requestUrl.searchParams,
    headers: req.headers,
    staticRoot: STATIC_ROOT,
  })) {
    const landingHtml = fs.readFileSync(landingPathFor(STATIC_ROOT), 'utf8');
    const gzip = /\bgzip\b/.test(acceptEncoding);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      // "/" differs by session cookie, so shared caches must not mix them up.
      'vary': 'Cookie, Accept-Encoding',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    });
    res.end(gzip ? zlib.gzipSync(landingHtml) : landingHtml);
    return;
  }
  if (serveFile(safeFilePath(requestedPath), res, acceptEncoding)) return;

  // This server only ever serves the exported browser app — real /api/*
  // traffic is handled by api-server, a separate process/origin (see this
  // file's own top doc comment). But if anything shaped like an API path
  // ever reaches HERE (a proxy misconfiguration, a typo'd path like
  // /api-server/* that a reverse proxy didn't route to the real API, or a
  // client hitting this origin directly), it must never fall through to the
  // "browser navigation → SPA shell, 200" branch below just because the
  // request happened to send `Accept: text/html` — that would silently
  // return an HTML page with a 200 status for a broken/unmatched API call
  // instead of a real 404, which client error handling that checks
  // `res.ok`/status code would misread as success.
  if (/^\/api(\/|-|$)/i.test(requestedPath)) {
    send(res, 404, JSON.stringify({ code: 'NOT_FOUND', message: `No route exists for ${requestedPath}.` }), 'application/json; charset=utf-8');
    return;
  }

  // Only browser navigations get the SPA shell. Missing JS/image requests
  // should remain a real 404 instead of returning HTML with status 200.
  const acceptsHtml = String(req.headers.accept || '').includes('text/html');
  if (acceptsHtml) {
    const shellPath = path.join(STATIC_ROOT, 'index.html');
    if (fs.existsSync(shellPath)) {
      const shellHtml = fs.readFileSync(shellPath, 'utf8');
      const preview = await renderSharePreview(requestedPath, shellHtml).catch(() => null);
      sendHtml(res, preview ? preview.status : 200, preview ? preview.html : shellHtml, acceptEncoding);
      return;
    }
  }

  send(res, 404, 'Not Found');
});

const port = parseInt(process.env.PORT || '3000', 10);
if (require.main === module) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`Serving Brandthread web export on port ${port}`);
  });
}

module.exports = { CANONICAL_ORIGIN, GENERATED_HOST, canonicalRedirectLocation, server };