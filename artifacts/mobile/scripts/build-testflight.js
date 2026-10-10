#!/usr/bin/env node
/**
 * One command from code to TestFlight:
 *
 *   pnpm run build:testflight
 *
 * Checks everything that would make the cloud build or the upload fail, then
 * builds the iOS app on Expo's servers, waits for it, and sends it to App
 * Store Connect (scripts/eas-submit.js). Apple emails you when it is ready in
 * TestFlight (usually 5–30 minutes after the upload).
 *
 * Needs, once: an Apple Developer account, the three Apple values as
 * environment variables EXPO_APPLE_ID, EAS_ASC_APP_ID and EXPO_APPLE_TEAM_ID
 * (see docs/app-store/release-flow.md), EXPO_PUBLIC_SENTRY_DSN in the EAS
 * "production" environment, and `eas init` / `eas login`. The first run asks
 * you to sign in to Apple so EAS can create the signing certificate; later
 * runs don't.
 *
 * The build is submitted in a second step (not --auto-submit) because the
 * Apple values only reach eas.json for the length of the submit call, and
 * eas.json is part of the runtime fingerprint: the build must see the
 * committed file so OTA updates match it.
 */
const { getSubmitConfigErrors, resolveIosSubmitValues } = require('./verify-submit-config');
const { submitWithValues } = require('./eas-submit');
const { getLaunchConfigProblems } = require('./verify-launch-config');
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
      'The App Store submit values are not ready yet:',
      ...submitErrors.map((error) => `- ${error}`),
      'Set EXPO_APPLE_ID, EAS_ASC_APP_ID and EXPO_APPLE_TEAM_ID in your shell once your Apple Developer',
      'account exists (step "App Store Connect (once)" in docs/app-store/release-flow.md).',
    ]);
  }

  // The Sentry DSN lives in the EAS "production" environment and is checked
  // again on the build server; here only the update URL can be checked.
  const updateUrlProblems = getLaunchConfigProblems({ profile: 'production' }).errors.filter((e) => e.startsWith('No EAS Update URL'));
  if (updateUrlProblems.length) fail(updateUrlProblems);

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
  console.log('\nStarting the iOS production build. When it finishes it is uploaded to TestFlight.\n');

  const status = run('eas', [
    'build',
    '--platform', 'ios',
    '--profile', 'production',
    ...passthrough,
  ]);
  if (status !== 0) fail('The build did not start or failed. The log link above shows why.');
  if (passthrough.includes('--no-wait')) {
    console.log('\nBuild queued without waiting. When it finishes, upload it with:  pnpm run submit:ios\n');
    return;
  }

  console.log('\nBuild finished. Uploading it to App Store Connect.\n');
  const { values } = resolveIosSubmitValues(readJson('eas.json'));
  if (submitWithValues(values, ['--latest']) !== 0) {
    fail('The upload failed. Fix the problem above, then run:  pnpm run submit:ios');
  }
}

if (require.main === module) main();
