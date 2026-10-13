/**
 * Safari Smart App Banner / App Clip card for commerce pages.
 *
 * Off unless APPLE_APP_STORE_ID (numeric App Store id) is set on the web
 * server. With APP_CLIP_BUNDLE_ID also set, Safari shows the App Clip card
 * ("instant checkout without install") instead of the plain banner. Only
 * product, store and drop pages get it — never account or checkout screens.
 */
const { CANONICAL_ORIGIN, escapeHtml } = require('./shared');

const BANNER_PATHS = [
  /^\/store\/product\/[^/]+\/?$/,
  /^\/store\/(?!product(?:\/|$))[^/]+\/?$/,
  /^\/drops\/[^/]+\/?$/,
];

function appBannerConfig(env = process.env) {
  const appId = String(env.APPLE_APP_STORE_ID || '').trim();
  if (!/^\d{5,12}$/.test(appId)) return null;
  const clip = String(env.APP_CLIP_BUNDLE_ID || '').trim();
  return { appId, clipBundleId: /^[A-Za-z0-9.-]{3,155}$/.test(clip) ? clip : null };
}

function appBannerMeta(pathname, env = process.env) {
  if (!BANNER_PATHS.some((re) => re.test(pathname))) return '';
  const config = appBannerConfig(env);
  if (!config) return '';
  const parts = [`app-id=${config.appId}`];
  if (config.clipBundleId) {
    parts.push(`app-clip-bundle-id=${config.clipBundleId}`, 'app-clip-display=card');
  }
  parts.push(`app-argument=${CANONICAL_ORIGIN}${pathname}`);
  return `<meta name="apple-itunes-app" content="${escapeHtml(parts.join(', '))}" />`;
}

/** Adds the banner meta to a rendered page's <head> (no-op when off or already present). */
function withAppBanner(html, pathname, env = process.env) {
  const meta = appBannerMeta(pathname, env);
  if (!meta || /name=["']apple-itunes-app["']/i.test(html)) return html;
  return html.replace('</head>', `${meta}</head>`);
}

module.exports = { appBannerConfig, appBannerMeta, withAppBanner };
