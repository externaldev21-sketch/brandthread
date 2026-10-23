/** Shared by every production HTML service. No browser/session bypass. */
function isProductionDeployment(env = process.env, headers = {}) {
  const hosts = [headers.host, headers['x-forwarded-host']]
    .flatMap(value => String(value || '').toLowerCase().split(','))
    .map(value => value.trim().replace(/:\d+$/, ''));
  // REPLIT_ENVIRONMENT can say "production" in this workspace too; it is
  // not a reliable published-service signal. Production services set NODE_ENV.
  return env.NODE_ENV === 'production' || env.REPLIT_DEPLOYMENT === '1'
    || hosts.some(host => host === 'brandthread.app' || host.endsWith('.brandthread.app')
      || host.endsWith('.replit.app'));
}

function isPublicAppSealed(env = process.env, headers = {}) {
  return isProductionDeployment(env, headers) && env.PUBLIC_APP_ENABLED !== 'true';
}

function prelaunchAction(pathname, env = process.env, headers = {}) {
  if (!isPublicAppSealed(env, headers)) return null;
  if (/^\/(?:api|ws)(?:\/|$)/.test(pathname)) return null;
  if (pathname === '/status'
    || pathname === '/.well-known/apple-app-site-association'
    || pathname === '/.well-known/assetlinks.json') return null;
  if (pathname === '/') return 'cover';
  if (/^\/(?:privacy|terms)\/?$/.test(pathname)) return 'legal';
  if (pathname === '/brandthread-logo.png' || pathname === '/favicon.ico'
    || /^\/landing-assets\/[^/]+\.(?:ttf|woff2?|mp4|webm|jpe?g|png)$/i.test(pathname)) return null;
  return 'redirect';
}

module.exports = { isProductionDeployment, isPublicAppSealed, prelaunchAction };
