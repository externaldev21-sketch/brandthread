/**
 * Decides when the static marketing landing page replaces the app shell.
 *
 * The landing page is served at "/" only for a plain, signed-out browser
 * visit. Anything that could be the app (a session cookie, any query string
 * such as ?bt_preview=, invite codes or ?app=1, a non-HTML request) keeps the
 * existing behaviour, and "/welcome" always shows the landing page.
 */
const fs = require('fs');
const path = require('path');

const LANDING_FILE = 'landing.html';
// Campaign tags that never change what the app does.
const MARKETING_PARAMS = /^(utm_[a-z_]+|fbclid|gclid|ttclid|msclkid|ref)$/i;

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

function hasOnlyMarketingParams(searchParams) {
  for (const key of searchParams.keys()) {
    if (!MARKETING_PARAMS.test(key)) return false;
  }
  return true;
}

function landingPathFor(staticRoot) {
  return path.join(staticRoot, LANDING_FILE);
}

function shouldServeLanding({ method = 'GET', pathname, searchParams, headers = {}, staticRoot }) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!fs.existsSync(landingPathFor(staticRoot))) return false;
  if (pathname === '/welcome') return true;
  if (pathname !== '/') return false;
  if (!String(headers.accept || '').includes('text/html')) return false;
  if (!hasOnlyMarketingParams(searchParams)) return false;
  return !hasClerkSession(headers.cookie);
}

module.exports = { LANDING_FILE, hasClerkSession, landingPathFor, parseCookies, shouldServeLanding };
