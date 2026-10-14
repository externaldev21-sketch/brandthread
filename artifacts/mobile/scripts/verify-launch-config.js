#!/usr/bin/env node
/**
 * Validate static Launch configuration without requiring optional monitoring
 * or an Expo project before the App Store wizard has linked one.
 * OTA remains explicitly disabled for the first build. Enabling it later
 * requires a real, matching project ID and URL; production fails closed on
 * incomplete OTA configuration. Missing Sentry always produces a warning.
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

/** Launch owns project linking in the one static app.json; no workspace/env fallback. */
function resolveExpoConfig() {
  const appJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'));
  return appJson.expo;
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
  const warnings = [];
  if (!isUsableDsn(env.EXPO_PUBLIC_SENTRY_DSN)) {
    warnings.push(
      'EXPO_PUBLIC_SENTRY_DSN is not configured; crash reporting is unavailable in this build. ' +
        'Configure monitoring in the native build environment before a public release.',
    );
  }
  const projectId = expoConfig?.extra?.eas?.projectId;
  const url = expoConfig?.updates?.url;
  if (expoConfig?.updates?.enabled === false) {
    warnings.push('OTA updates are explicitly disabled for this build. Link the project through Launch before enabling them.');
  } else if (
    typeof projectId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId) ||
    url !== `https://u.expo.dev/${projectId}`
  ) {
    problems.push(
      'OTA updates are enabled but extra.eas.projectId and updates.url are missing or mismatched. ' +
        'Link the project through the Replit App Store wizard, or explicitly disable updates for the first build.',
    );
  }
  const store = STORE_PROFILES.includes(profile);
  return { profile, store, errors: store ? problems : [], warnings: [...warnings, ...(store ? [] : problems)] };
}

function verifyLaunchConfig(argv = process.argv.slice(2), env = process.env) {
  const profile = profileFromArgs(argv, env);
  const { store, errors, warnings } = getLaunchConfigProblems({ profile, env });
  for (const warning of warnings) console.warn(`Launch config (${profile || 'local'}): ${warning}`);
  if (errors.length > 0) {
    console.error([`Store build "${profile}" is not ready:`, ...errors.map((e) => `- ${e}`)].join('\n'));
    process.exitCode = 1;
    return false;
  }
  if (store) console.log(`Verified static Launch configuration for the "${profile}" store build.`);
  return true;
}

module.exports = { STORE_PROFILES, getLaunchConfigProblems, isUsableDsn, profileFromArgs, resolveExpoConfig, verifyLaunchConfig };

if (require.main === module) verifyLaunchConfig();
