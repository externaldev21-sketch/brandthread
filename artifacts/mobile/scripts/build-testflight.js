#!/usr/bin/env node
/**
 * One command from code to TestFlight:
 *
 *   pnpm run build:testflight
 *
 * Checks everything that would make the cloud build or the upload fail, then
 * builds the iOS app on Expo's servers and sends it straight to App Store
 * Connect. Apple emails you when it is ready in TestFlight (usually 5–30
 * minutes after the build finishes).
 *
 * Needs, once: an Apple Developer account, the three Apple values in
 * eas.json → submit.production.ios (see docs/app-store/release-flow.md), and
 * `eas init` / `eas login`. The first run asks you to sign in to Apple so EAS
 * can create the signing certificate; later runs don't.
 */
const { getSubmitConfigErrors } = require('./verify-submit-config');
const { verifyAppIdentity } = require('./verify-app-identity');
const { verifyAppleAuth } = require('./verify-apple-auth');
const { verifyIosBuild } = require('./verify-ios-build');
const {
  fail,
  readJson,
  requireEasCli,
  requireLinkedProject,
  run,
  sentryUploadConfigured,
} = require('./release-utils');

function main() {
  const passthrough = process.argv.slice(2).filter((arg) => arg !== '--');

  const submitErrors = getSubmitConfigErrors(readJson('eas.json'));
  if (submitErrors.length) {
    fail([
      'eas.json is not ready to upload to TestFlight yet:',
      ...submitErrors.map((error) => `- ${error}`),
      'Fill in submit.production.ios in artifacts/mobile/eas.json once your Apple Developer',
      'account exists (step "App Store Connect (once)" in docs/app-store/release-flow.md).',
    ]);
  }

  if (!verifyAppIdentity() || !verifyAppleAuth() || !verifyIosBuild()) {
    fail('Fix the configuration problems above, then run this again.');
  }
  requireEasCli();
  requireLinkedProject();

  console.log(
    sentryUploadConfigured()
      ? 'Sentry: SENTRY_* found locally. Make sure they are also set as EAS environment variables (production) so the cloud build uploads source maps.'
      : 'Sentry: SENTRY_* not set locally. The cloud build uploads source maps only if they are set as EAS environment variables (production).',
  );
  console.log('\nStarting the iOS production build. It will be submitted to TestFlight automatically.\n');

  const status = run('eas', [
    'build',
    '--platform', 'ios',
    '--profile', 'production',
    '--auto-submit-with-profile', 'production',
    ...passthrough,
  ]);
  if (status !== 0) fail('The build did not start or failed. The log link above shows why.');
}

if (require.main === module) main();
