#!/usr/bin/env node
/**
 * Prints, near the top of every EAS build log, whether this build will upload
 * source maps and debug symbols to Sentry. It never fails the build: without
 * credentials the upload is skipped by plugins/with-sentry-upload-guard.js.
 */
const { sentryUploadConfigured } = require('./release-utils');

if (sentryUploadConfigured()) {
  console.log(`Sentry: source maps and debug symbols will be uploaded to ${process.env.SENTRY_ORG}/${process.env.SENTRY_PROJECT}.`);
} else {
  console.log('Sentry: upload skipped for this build (set SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT to enable).');
}
if (!process.env.EXPO_PUBLIC_SENTRY_DSN) {
  console.log('Sentry: EXPO_PUBLIC_SENTRY_DSN is not set, so this build will not send crash reports.');
}
