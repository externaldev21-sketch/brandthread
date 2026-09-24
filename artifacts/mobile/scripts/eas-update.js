#!/usr/bin/env node
/**
 * Publish an over-the-air (OTA) update safely.
 *
 *   pnpm run update:production -- --message "Fix checkout total rounding"
 *   pnpm run update:preview    -- --message "Try new discover layout"
 *
 * Options:
 *   --message, -m   What changed (required; shown on expo.dev and in rollbacks)
 *   --platform, -p  ios | android | all (default: all)
 *   --rollout       Percentage of users who get it first, e.g. --rollout 10
 *   --skip-build-check  Publish even if no finished store build can receive it
 *
 * Before publishing it checks, per platform, that at least one finished build
 * on this channel has the same runtime version (native fingerprint) as your
 * code. If none does, you changed something native (a package, app.json,
 * eas.json, an SDK upgrade) and the fix needs a store build instead: an OTA
 * update would reach nobody.
 *
 * After publishing it uploads the update's source maps to Sentry when
 * SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are set.
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  capture,
  fail,
  projectRoot,
  requireEasCli,
  requireLinkedProject,
  run,
  sentryUploadConfigured,
} = require('./release-utils');

const CHANNELS = ['production', 'preview', 'development'];
const PLATFORMS = ['ios', 'android'];

function parseArgs(argv) {
  const options = { channel: null, message: null, platform: 'all', rollout: null, skipBuildCheck: false };
  const errors = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined || value.startsWith('--')) errors.push(`${arg} needs a value`);
      return value;
    };
    if (arg === '--') continue;
    else if (arg === '--channel') options.channel = next();
    else if (arg === '--message' || arg === '-m') options.message = next();
    else if (arg === '--platform' || arg === '-p') options.platform = next();
    else if (arg === '--rollout') options.rollout = next();
    else if (arg === '--skip-build-check') options.skipBuildCheck = true;
    else errors.push(`Unknown option ${arg}`);
  }
  if (!CHANNELS.includes(options.channel)) errors.push(`--channel must be one of ${CHANNELS.join(', ')}`);
  if (!options.message?.trim()) errors.push('--message is required, e.g. --message "Fix checkout total rounding"');
  if (!['all', ...PLATFORMS].includes(options.platform)) errors.push('--platform must be ios, android or all');
  if (options.rollout !== null) {
    const pct = Number(options.rollout);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) errors.push('--rollout must be a whole number from 1 to 100');
  }
  return { options, errors };
}

function resolveRuntimeVersion(platform) {
  const cli = path.join(projectRoot, 'node_modules', 'expo-updates', 'bin', 'cli.js');
  const { status, stdout } = capture(process.execPath, [cli, 'runtimeversion:resolve', '--platform', platform]);
  if (status !== 0) fail(`Could not work out the ${platform} runtime version (expo-updates runtimeversion:resolve failed).`);
  return JSON.parse(stdout).runtimeVersion;
}

function findCompatibleBuild(platform, channel, runtimeVersion) {
  const { status, stdout } = capture('eas', [
    'build:list',
    '--platform', platform,
    '--channel', channel,
    '--runtime-version', runtimeVersion,
    '--status', 'finished',
    '--limit', '1',
    '--json',
    '--non-interactive',
  ]);
  if (status !== 0) fail('Could not list builds from EAS. Check you are signed in (eas whoami).');
  const builds = JSON.parse(stdout || '[]');
  return Array.isArray(builds) && builds.length > 0 ? builds[0] : null;
}

function hasSourceMaps(dir) {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir, { recursive: true }).some((file) => String(file).endsWith('.map'));
}

function main() {
  const { options, errors } = parseArgs(process.argv.slice(2));
  if (errors.length) fail(errors);

  requireEasCli();
  requireLinkedProject();

  const platforms = options.platform === 'all' ? PLATFORMS : [options.platform];
  console.log(`\nPublishing an OTA update to the "${options.channel}" channel (${platforms.join(' + ')}).\n`);

  for (const platform of platforms) {
    const runtimeVersion = resolveRuntimeVersion(platform);
    console.log(`• ${platform}: runtime version ${runtimeVersion}`);
    if (options.skipBuildCheck) continue;
    const build = findCompatibleBuild(platform, options.channel, runtimeVersion);
    if (!build) {
      fail([
        `No finished ${platform} build on the "${options.channel}" channel has runtime version ${runtimeVersion}.`,
        'That means native code or config changed since the last build (a new or upgraded package,',
        'app.json, eas.json or an Expo SDK upgrade). An OTA update would reach nobody.',
        `Make a new build instead:  eas build --platform ${platform} --profile ${options.channel}`,
        'Publishing ahead of a build on purpose? Re-run with --skip-build-check.',
      ]);
    }
    console.log(`  ✓ compatible build found (${build.appVersion ?? '?'} build ${build.appBuildVersion ?? '?'})`);
  }

  const updateArgs = [
    'update',
    '--channel', options.channel,
    '--environment', options.channel,
    '--message', options.message.trim(),
    '--platform', options.platform,
    '--non-interactive',
  ];
  if (options.rollout) updateArgs.push('--rollout-percentage', String(options.rollout));
  const status = run('eas', updateArgs);
  if (status !== 0) fail('eas update failed; nothing was published.');

  const distDir = path.join(projectRoot, 'dist');
  if (!sentryUploadConfigured()) {
    console.log('\nSentry source maps: skipped (SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are not all set).');
  } else if (!hasSourceMaps(distDir)) {
    console.log('\nSentry source maps: skipped (no .map files were found in dist/).');
  } else {
    const uploader = path.join(projectRoot, 'node_modules', '@sentry', 'react-native', 'scripts', 'expo-upload-sourcemaps.js');
    const uploaded = run(process.execPath, [uploader, 'dist']);
    // The update is already live; a failed upload only affects stack-trace readability.
    console.log(uploaded === 0 ? '\nSentry source maps: uploaded.' : '\n⚠ Sentry source map upload failed (the update is still live).');
  }

  const summary = [
    '',
    'Done. Phones on this channel download the update in the background and use it',
    'from their next launch.',
  ];
  if (options.rollout) {
    summary.push(`It is live for ${options.rollout}% of them. Raise it later with:  eas update:edit --rollout-percentage 100`);
  }
  summary.push('Something wrong? Roll back with:  pnpm run update:rollback', '');
  console.log(summary.join('\n'));
}

module.exports = { CHANNELS, parseArgs };

if (require.main === module) main();
