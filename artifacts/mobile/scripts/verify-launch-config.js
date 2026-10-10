#!/usr/bin/env node
/**
 * Store-build gate, run by `eas-build-pre-install` on every EAS build (and by
 * build-testflight.js before it starts one). For the store profiles it fails
 * the build when something that can't be fixed after release is missing:
 *
 *  - EXPO_PUBLIC_SENTRY_DSN: without it the binary never sends crash reports.
 *    Get it at sentry.io → Settings → Projects → (the app's project) →
 *    Client Keys (DSN), then add it as an EAS environment variable for the
 *    "production" environment (expo.dev → project → Environment variables).
 *  - The EAS Update URL (updates.url, from extra.eas.projectId or the
 *    EAS_PROJECT_ID fallback in app.config.js): it is baked into the binary,
 *    so a store build without it can never receive an OTA fix. Run
 *    `eas init` once in artifacts/mobile and commit app.json.
 *
 * Development, preview and staging builds only print warnings.
 * The profile comes from EAS_BUILD_PROFILE (set by EAS) or --profile <name>.
 */
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const STORE_PROFILES = ['production', 'testflight'];
const PLACEHOLDER_PATTERN = /^(REPLACE_WITH_|your[-_]|<|\$)/i;

/** Same rule as lib/monitoringConfig.ts resolveDsn: a real https DSN with a key and a project. */
function isUsableDsn(raw) {
  const dsn = typeof raw === 'string' ? raw.trim() : '';
  if (!dsn || PLACEHOLDER_PATTERN.test(dsn)) return false;
  try {
    const url = new URL(dsn);
    return /^https?:$/.test(url.protocol) && Boolean(url.username) && Boolean(url.pathname.replace(/\//g, ''));
  } catch {
    return false;
  }
}

/** The resolved Expo config, exactly as EAS sees it (app.json through app.config.js). */
function resolveExpoConfig(env = process.env) {
  const appJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'));
  const dynamicConfig = require('../app.config.js');
  const saved = process.env.EAS_PROJECT_ID;
  try {
    if (env.EAS_PROJECT_ID === undefined) delete process.env.EAS_PROJECT_ID;
    else process.env.EAS_PROJECT_ID = env.EAS_PROJECT_ID;
    return dynamicConfig({ config: appJson.expo });
  } finally {
    if (saved === undefined) delete process.env.EAS_PROJECT_ID;
    else process.env.EAS_PROJECT_ID = saved;
  }
}

function profileFromArgs(argv, env) {
  const index = argv.indexOf('--profile');
  if (index !== -1 && argv[index + 1]) return argv[index + 1];
  return env.EAS_BUILD_PROFILE || null;
}

/**
 * Returns { profile, store, errors, warnings }. `errors` only for store
 * profiles; the same problems are `warnings` for every other profile.
 */
function getLaunchConfigProblems({ profile, env = process.env, expoConfig = resolveExpoConfig(env) }) {
  const problems = [];
  if (!isUsableDsn(env.EXPO_PUBLIC_SENTRY_DSN)) {
    problems.push(
      'EXPO_PUBLIC_SENTRY_DSN is not set to a valid DSN, so this build would never report crashes. ' +
        'Copy it from sentry.io → Settings → Projects → your project → Client Keys (DSN) and add it as an ' +
        'EAS environment variable for the "production" environment.',
    );
  }
  const url = expoConfig?.updates?.url;
  if (!expoConfig?.extra?.eas?.projectId || typeof url !== 'string' || !/^https:\/\//.test(url)) {
    problems.push(
      'No EAS Update URL: extra.eas.projectId is missing, so this binary could never receive an over-the-air fix. ' +
        'Run `eas init` once in artifacts/mobile and commit app.json (or set EAS_PROJECT_ID for this build).',
    );
  }
  const store = STORE_PROFILES.includes(profile);
  return { profile, store, errors: store ? problems : [], warnings: store ? [] : problems };
}

function verifyLaunchConfig(argv = process.argv.slice(2), env = process.env) {
  const profile = profileFromArgs(argv, env);
  const { store, errors, warnings } = getLaunchConfigProblems({ profile, env });
  for (const warning of warnings) console.log(`Launch config (${profile || 'local'}, not enforced): ${warning}`);
  if (errors.length > 0) {
    console.error([`Store build "${profile}" is not ready:`, ...errors.map((e) => `- ${e}`)].join('\n'));
    process.exitCode = 1;
    return false;
  }
  if (store) console.log(`Verified Sentry DSN and EAS Update URL for the "${profile}" store build.`);
  return true;
}

module.exports = { STORE_PROFILES, getLaunchConfigProblems, isUsableDsn, profileFromArgs, resolveExpoConfig, verifyLaunchConfig };

if (require.main === module) verifyLaunchConfig();
