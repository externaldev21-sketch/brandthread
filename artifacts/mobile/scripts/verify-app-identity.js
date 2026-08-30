#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const appConfigPath = path.join(projectRoot, 'app.json');
const EXPECTED_APP_ID = 'com.brandthread.mobile';

function formatFailure(messages) {
  return [
    'App identity verification failed before the native build:',
    ...messages.map((message) => `- ${message}`),
  ].join('\n');
}

function getIdentityErrors(expoConfig) {
  const configuredIdentifiers = [
    ['iOS bundleIdentifier', expoConfig?.ios?.bundleIdentifier],
    ['Android package', expoConfig?.android?.package],
  ];

  const errors = [];
  for (const [platform, configuredValue] of configuredIdentifiers) {
    if (typeof configuredValue !== 'string' || configuredValue.trim() === '') {
      errors.push(`${platform} is missing; it must remain "${EXPECTED_APP_ID}"`);
    } else if (configuredValue !== EXPECTED_APP_ID) {
      errors.push(
        `${platform} is "${configuredValue}", but the stable store identity is "${EXPECTED_APP_ID}"`,
      );
    }
  }
  return errors;
}

function readAppConfig() {
  try {
    return JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(formatFailure([`could not read or parse app.json (${reason})`]));
    process.exit(1);
  }
}

function verifyAppIdentity() {
  const appConfig = readAppConfig();
  const errors = getIdentityErrors(appConfig?.expo);
  if (errors.length > 0) {
    console.error(formatFailure(errors));
    process.exitCode = 1;
    return false;
  }
  console.log(`Verified stable iOS and Android app identity: ${EXPECTED_APP_ID}`);
  return true;
}

module.exports = {
  EXPECTED_APP_ID,
  formatFailure,
  getIdentityErrors,
  verifyAppIdentity,
};

if (require.main === module) {
  verifyAppIdentity();
}