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
 */
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  let next = config;
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
