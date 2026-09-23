/**
 * Shared helpers for the release scripts (eas-update.js, build-testflight.js,
 * build-preview.js). Everything here runs the same on Windows, macOS and Linux.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

// cmd.exe needs .cmd shims (eas, pnpm) run through a shell, and a shell needs
// every argument quoted so messages with spaces survive intact.
function quoteForCmd(arg) {
  if (/^[\w@%+=:,./\\-]+$/.test(arg)) return arg;
  return `"${String(arg).replace(/"/g, '""')}"`;
}

/** Runs a command with inherited output. Returns the exit status. */
function run(command, args, options = {}) {
  const spawnOptions = { cwd: projectRoot, stdio: 'inherit', env: process.env, ...options };
  const result = isWindows
    ? spawnSync([command, ...args].map(quoteForCmd).join(' '), { ...spawnOptions, shell: true })
    : spawnSync(command, args, spawnOptions);
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** Runs a command and returns its stdout (stderr passes through). */
function capture(command, args, options = {}) {
  const spawnOptions = {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  };
  const result = isWindows
    ? spawnSync([command, ...args].map(quoteForCmd).join(' '), { ...spawnOptions, shell: true })
    : spawnSync(command, args, spawnOptions);
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

function hasEasCli() {
  try {
    return capture('eas', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }).status === 0;
  } catch {
    return false;
  }
}

function fail(lines) {
  const [first, ...rest] = [].concat(lines);
  console.error(['', `✖ ${first}`, ...rest.map((line) => `  ${line}`), ''].join('\n'));
  process.exit(1);
}

function requireEasCli() {
  if (!hasEasCli()) {
    fail([
      'The EAS command line tool is not installed.',
      'Install it once with:  npm install -g eas-cli   then sign in with:  eas login',
    ]);
  }
}

/** The EAS project ID written by `eas init`, or null before the project is linked. */
function easProjectId(appJson = readJson('app.json')) {
  return appJson?.expo?.extra?.eas?.projectId ?? null;
}

function requireLinkedProject() {
  if (!easProjectId()) {
    fail([
      'This app is not linked to an Expo (EAS) project yet.',
      'Run  eas init  once in artifacts/mobile and commit the app.json change it makes.',
    ]);
  }
}

/** True when all three Sentry upload credentials are present. */
function sentryUploadConfigured(env = process.env) {
  return ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'].every((name) => Boolean(env[name]?.trim()));
}

module.exports = {
  capture,
  easProjectId,
  fail,
  hasEasCli,
  isWindows,
  projectRoot,
  quoteForCmd,
  readJson,
  requireEasCli,
  requireLinkedProject,
  run,
  sentryUploadConfigured,
};
