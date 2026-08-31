#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { verifyAppIdentity } = require('./verify-app-identity');
const { verifyAppleAuth } = require('./verify-apple-auth');
const { verifyIosBuild } = require('./verify-ios-build');

const projectRoot = path.resolve(__dirname, '..');
const prebuildArgs = process.argv.slice(2);
if (prebuildArgs[0] === '--') {
  prebuildArgs.shift();
}

if (!verifyAppIdentity() || !verifyAppleAuth() || !verifyIosBuild()) {
  process.exit(1);
}

const result = spawnSync(
  'pnpm',
  ['exec', 'expo', 'prebuild', ...prebuildArgs],
  { cwd: projectRoot, stdio: 'inherit' },
);

process.exit(result.status ?? 1);