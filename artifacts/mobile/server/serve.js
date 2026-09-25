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
const { renderSharePreviewHtml } = require('./sharePreview');

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

function safeFilePath(urlPath) {
  const normalized = path.posix.normalize(`/${urlPath}`).replace(/^\/+/, '');
  const filePath = path.resolve(STATIC_ROOT, normalized);
  if (filePath !== STATIC_ROOT && !filePath.startsWith(`${STATIC_ROOT}${path.sep}`)) {
    return null;
  }
  return filePath;
}

function serveFile(filePath, res) {
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME_TYPES[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(fs.readFileSync(filePath));
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
  if (serveFile(safeFilePath(requestedPath), res)) return;

  // Only browser navigations get the SPA shell. Missing JS/image requests
  // should remain a real 404 instead of returning HTML with status 200.
  const acceptsHtml = String(req.headers.accept || '').includes('text/html');
  if (acceptsHtml) {
    const shellPath = path.join(STATIC_ROOT, 'index.html');
    if (fs.existsSync(shellPath)) {
      const shellHtml = fs.readFileSync(shellPath, 'utf8');
      const preview = await renderSharePreviewHtml(requestedPath, shellHtml).catch(() => null);
      if (preview) {
        send(res, 200, preview, 'text/html; charset=utf-8');
        return;
      }
      send(res, 200, shellHtml, 'text/html; charset=utf-8');
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