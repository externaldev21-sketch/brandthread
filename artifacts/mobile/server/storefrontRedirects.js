'use strict';

/**
 * Buyer-facing storefront addresses on the web domain. Only /api/* is routed
 * to the API server, so the friendly addresses (and a store's own host)
 * redirect to the API's public storefront pages:
 *
 *   https://brandthread.app/store/<username>  → /api/store/by-username/<username>
 *   https://brandthread.app/s/<slug>          → /api/store/site/<slug>
 *   https://<slug>.brandthread.app/           → /api/store/host-site
 *   https://<verified custom domain>/         → /api/store/host-site
 *
 * The API resolves the store from the Host header and only serves PUBLISHED
 * storefronts (see api-server lib/storefrontHosting.ts).
 */

const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'auth', 'clerk', 'mail', 'cdn', 'static', 'assets', 'status', 'help', 'docs']);
// Hosts that serve the Brandthread web app itself, never a store.
const PLATFORM_HOST_RE = /(^|\.)(replit\.app|replit\.dev|repl\.co|replit\.com|expo\.dev|exp\.direct)$/;

function normalizeHost(raw) {
  return String(raw || '').split(',')[0].trim().replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase();
}

function isStoreHost(rawHost) {
  const host = normalizeHost(rawHost);
  if (!host || host === 'brandthread.app' || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.endsWith('.brandthread.app')) {
    const label = host.slice(0, -'.brandthread.app'.length);
    return Boolean(label) && !label.includes('.') && !RESERVED_SUBDOMAINS.has(label);
  }
  if (PLATFORM_HOST_RE.test(host)) return false;
  return host.includes('.');
}

/** The redirect target for a storefront address, or null for everything else. */
function storefrontRedirectTarget({ host, pathname }) {
  const store = /^\/store\/([^/]+)\/?$/.exec(pathname);
  if (store) return `/api/store/by-username/${encodeURIComponent(decodeURIComponent(store[1]).replace(/^@/, ''))}`;
  const slug = /^\/s\/([^/]+)\/?$/.exec(pathname);
  if (slug) return `/api/store/site/${encodeURIComponent(decodeURIComponent(slug[1]))}`;
  if ((pathname === '/' || pathname === '') && isStoreHost(host)) return '/api/store/host-site';
  return null;
}

module.exports = { isStoreHost, storefrontRedirectTarget };
