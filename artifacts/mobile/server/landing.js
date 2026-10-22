/**
 * Decides when the static marketing landing page replaces the app shell.
 *
 * The landing page is served at "/" only for a plain, signed-out browser
 * visit. Unknown/tracking query strings cannot bypass the pre-launch page.
 * Explicit development previews and signed-in sessions still reach the app;
 * "/welcome" always shows the landing page.
 */
const fs = require('fs');
const path = require('path');

const LANDING_FILE = 'landing.html';
// Public seller pricing (scripts/pricing-page.js), the same for everyone.
const PRICING_FILE = 'pricing.html';

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

/**
 * Clerk keeps `__session` (short-lived JWT) and `__client_uat` (last updated
 * timestamp, "0" when signed out) on the app domain, optionally suffixed per
 * instance. Either one signalling a session means "let the app handle it".
 */
function hasClerkSession(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  return Object.entries(cookies).some(([name, value]) => {
    if (/^__session(_.+)?$/.test(name)) return value !== '';
    if (/^__client_uat(_.+)?$/.test(name)) return value !== '' && value !== '0';
    return false;
  });
}

function landingPathFor(staticRoot) {
  return path.join(staticRoot, LANDING_FILE);
}

function shouldServeLanding({ method = 'GET', pathname, searchParams, headers = {}, staticRoot, appPreview = false }) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!fs.existsSync(landingPathFor(staticRoot))) return false;
  if (pathname === '/welcome') return true;
  if (pathname !== '/') return false;
  if (appPreview) return false;
  if (!String(headers.accept || '').includes('text/html')) return false;
  const host = String(headers.host || '').split(':')[0].toLowerCase();
  const developmentHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.replit.dev');
  if (developmentHost && ['buyer', 'seller', 'guest'].includes(searchParams.get('bt_preview'))) return false;
  return !hasClerkSession(headers.cookie);
}

function pricingPathFor(staticRoot) {
  return path.join(staticRoot, PRICING_FILE);
}

/** GET/HEAD /pricing serves the static pricing page whenever it was built. */
function shouldServePricing({ method = 'GET', pathname, staticRoot }) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!/^\/pricing\/?$/.test(pathname)) return false;
  return fs.existsSync(pricingPathFor(staticRoot));
}

module.exports = {
  LANDING_FILE,
  PRICING_FILE,
  hasClerkSession,
  landingPathFor,
  parseCookies,
  pricingPathFor,
  shouldServeLanding,
  shouldServePricing,
};
