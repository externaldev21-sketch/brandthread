/**
 * Dynamic layer over app.json. Everything static lives in app.json; this file
 * only derives values from it, never from environment variables, so the
 * runtime fingerprint (which decides which builds an OTA update reaches) is
 * the same on every machine.
 *
 * - updates.url: EAS Update endpoint, derived from the project ID that
 *   `eas init` writes to app.json (extra.eas.projectId).
 * - android.googleServicesFile: set only when ./google-services.json is
 *   present (Firebase Android app config — FCM device tokens for native call
 *   ringing, lib/calls/native/). Without it the Android build is unchanged.
 * - extra.router.asyncRoutes (web export only): while scripts/build-web.js is
 *   exporting the static web build it creates `.web-async-routes` next to this
 *   file and removes it afterwards. With that marker present every route
 *   becomes its own web chunk, so the first load ships the shell and the
 *   landing route instead of every screen. EAS and native builds never see the
 *   marker, so the native config, fingerprint and OTA compatibility are
 *   unchanged. The marker is a file rather than an environment variable on
 *   purpose: it cannot differ between machines building the same binary.
 */
const fs = require('fs');
const path = require('path');

const WEB_ASYNC_ROUTES_MARKER = path.join(__dirname, '.web-async-routes');

module.exports = ({ config }) => {
  let next = fs.existsSync(WEB_ASYNC_ROUTES_MARKER)
    ? {
        ...config,
        extra: { ...config.extra, router: { ...config.extra?.router, asyncRoutes: { web: true, default: false } } },
      }
    : config;
  const googleServices = path.join(__dirname, 'google-services.json');
  if (!next.android?.googleServicesFile && fs.existsSync(googleServices)) {
    next = { ...next, android: { ...next.android, googleServicesFile: './google-services.json' } };
  }
  const projectId = next.extra?.eas?.projectId;
  if (!projectId || next.updates?.url) return next;
  return {
    ...next,
    updates: { ...next.updates, url: `https://u.expo.dev/${projectId}` },
  };
};
