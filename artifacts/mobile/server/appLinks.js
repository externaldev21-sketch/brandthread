/**
 * Universal links (iOS) and App Links (Android) verification files, served by
 * the web app itself — the host people actually share (brandthread.app) —
 * at the exact paths each OS fetches:
 *
 *   /.well-known/apple-app-site-association   (and the legacy root path)
 *   /.well-known/assetlinks.json
 *
 * Both must be plain JSON, unauthenticated and never redirected. Values come
 * from the owner's Apple / Google developer accounts:
 *
 *   APPLE_TEAM_ID                     10-character Team ID (developer.apple.com → Membership)
 *   IOS_BUNDLE_IDENTIFIER             defaults to com.brandthread.mobile (app.json)
 *   ANDROID_PACKAGE_NAME              defaults to com.brandthread.mobile (app.json)
 *   ANDROID_SHA256_CERT_FINGERPRINTS  comma-separated; Play Console → App integrity → App signing
 *
 * Until those are set the files are valid but empty, so nothing breaks and
 * links keep opening in the browser.
 */

/** Paths the app claims. Keep in sync with lib/shareLinks.ts parseShareLink. */
const APP_LINK_PATHS = [
  '/p/*',
  '/post/*',
  '/s/*',
  '/u/*',
  '/store/*',
  '/c/*',
  '/drops/*',
  '/tag/*',
  '/place/*',
  '/onboarding*',
  '/team-invite*',
];

const DEFAULT_APP_ID = 'com.brandthread.mobile';

function appleAppId(env) {
  const teamId = (env.APPLE_TEAM_ID || '').trim();
  if (!/^[A-Z0-9]{10}$/.test(teamId)) return null;
  const bundleId = (env.IOS_BUNDLE_IDENTIFIER || '').trim() || DEFAULT_APP_ID;
  return `${teamId}.${bundleId}`;
}

function androidFingerprints(env) {
  return String(env.ANDROID_SHA256_CERT_FINGERPRINTS || '')
    .split(',')
    .map((fp) => fp.trim().toUpperCase())
    .filter((fp) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fp));
}

/**
 * apple-app-site-association: the current `components` format (iOS 13+) plus
 * the legacy `paths` list older iOS versions read.
 */
function appleAppSiteAssociation(env = process.env) {
  const appId = appleAppId(env);
  return {
    applinks: {
      apps: [],
      details: appId
        ? [{
            appID: appId,
            appIDs: [appId],
            paths: APP_LINK_PATHS,
            components: APP_LINK_PATHS.map((p) => ({ '/': p })),
          }]
        : [],
    },
  };
}

function assetLinks(env = process.env) {
  const fingerprints = androidFingerprints(env);
  if (!fingerprints.length) return [];
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: (env.ANDROID_PACKAGE_NAME || '').trim() || DEFAULT_APP_ID,
      sha256_cert_fingerprints: fingerprints,
    },
  }];
}

/**
 * Returns `{ body, contentType }` for a verification-file path, or null for
 * anything else.
 */
function appLinkFile(pathname, env = process.env) {
  if (pathname === '/.well-known/apple-app-site-association' || pathname === '/apple-app-site-association') {
    return { body: JSON.stringify(appleAppSiteAssociation(env)), contentType: 'application/json' };
  }
  if (pathname === '/.well-known/assetlinks.json') {
    return { body: JSON.stringify(assetLinks(env)), contentType: 'application/json' };
  }
  return null;
}

module.exports = { APP_LINK_PATHS, appLinkFile, appleAppSiteAssociation, assetLinks };
