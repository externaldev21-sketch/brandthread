#!/usr/bin/env node
/**
 * Uploads an iOS build to App Store Connect with the Apple values taken from
 * the environment (eas.json can't read environment variables):
 *
 *   pnpm run submit:ios                 submit the latest finished iOS build
 *   pnpm run submit:ios -- --id <id>    submit a specific build
 *
 * Needs EXPO_APPLE_ID, EAS_ASC_APP_ID and EXPO_APPLE_TEAM_ID (see
 * scripts/verify-submit-config.js for where each comes from). EXPO_APPLE_ID
 * and EXPO_APPLE_TEAM_ID are eas-cli's own variable names, so they also
 * pre-fill its Apple sign-in. The App Store Connect app ID has no eas-cli
 * variable, so for the length of the `eas submit` call this script writes the
 * three values into eas.json submit.production.ios and then puts eas.json back
 * exactly as it was (also on failure or Ctrl-C). Never run it during
 * `eas build`: eas.json is part of the runtime fingerprint.
 */
const fs = require('node:fs');
const path = require('node:path');
const { resolveIosSubmitValues } = require('./verify-submit-config');
const { fail, projectRoot, requireEasCli, run } = require('./release-utils');

const easJsonPath = path.join(projectRoot, 'eas.json');

/** eas.json text with submit.production.ios filled in (2-space JSON, trailing newline). */
function withIosSubmitValues(easJsonText, values) {
  const config = JSON.parse(easJsonText);
  config.submit = config.submit ?? {};
  config.submit.production = config.submit.production ?? {};
  config.submit.production.ios = { ...(config.submit.production.ios ?? {}), ...values };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function submitArgs(passthrough) {
  const args = ['submit', '--platform', 'ios', '--profile', 'production'];
  const choosesBuild = passthrough.some((arg) => ['--id', '--path', '--url', '--latest'].includes(arg.split('=')[0]));
  return [...args, ...(choosesBuild ? [] : ['--latest']), ...passthrough];
}

/** Runs `eas submit` with eas.json temporarily carrying the values. Returns the exit status. */
function submitWithValues(values, passthrough, env = process.env, runImpl = run) {
  const original = fs.readFileSync(easJsonPath, 'utf8');
  const restore = () => {
    if (fs.readFileSync(easJsonPath, 'utf8') !== original) fs.writeFileSync(easJsonPath, original);
  };
  // eas-cli gets Ctrl-C itself; this process waits for it, then restores eas.json.
  const ignore = () => {};
  process.on('SIGINT', ignore);
  process.on('SIGTERM', ignore);
  try {
    fs.writeFileSync(easJsonPath, withIosSubmitValues(original, values));
    return runImpl('eas', submitArgs(passthrough), {
      env: { ...env, EXPO_APPLE_ID: values.appleId, EXPO_APPLE_TEAM_ID: values.appleTeamId },
    });
  } finally {
    restore();
    process.off('SIGINT', ignore);
    process.off('SIGTERM', ignore);
  }
}

function main() {
  const passthrough = process.argv.slice(2).filter((arg) => arg !== '--');
  const config = JSON.parse(fs.readFileSync(easJsonPath, 'utf8'));
  const { values, errors } = resolveIosSubmitValues(config);
  if (errors.length) {
    fail([
      'The App Store submit values are missing:',
      ...errors.map((error) => `- ${error}`),
      'Set them in your shell (or CI secrets) and run this again. Details: docs/app-store/release-flow.md.',
    ]);
  }
  requireEasCli();
  const status = submitWithValues(values, passthrough);
  if (status !== 0) fail('eas submit failed. The output above shows why.');
}

module.exports = { submitArgs, submitWithValues, withIosSubmitValues };

if (require.main === module) main();
