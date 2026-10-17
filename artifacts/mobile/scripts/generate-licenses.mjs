#!/usr/bin/env node
/**
 * Builds content/open-source-licenses.json for Settings > About >
 * Open-source licenses (app/open-source-licenses.tsx).
 *
 * Reads the mobile app's direct dependencies from package.json and, for
 * each, the installed package's own package.json (node_modules) for its
 * version and license. Expo apps list many runtime libraries (expo-router,
 * Clerk, react-native-*) under devDependencies, so both lists are read;
 * build/test-only tooling (BUILD_ONLY below) and Brandthread's own packages
 * (workspace:, link:, file:) are skipped. Output is sorted and has no
 * timestamp, so re-running on an unchanged install produces an identical file.
 *
 *   node scripts/generate-licenses.mjs           rewrite the JSON
 *   node scripts/generate-licenses.mjs --check   exit 1 if it is stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'content', 'open-source-licenses.json');

/** Dev tooling that never ships in the app bundle. */
const BUILD_ONLY = new Set([
  '@babel/core', '@expo/ngrok', '@playwright/test', '@react-native/metro-config', '@sentry/cli',
  'babel-plugin-react-compiler', 'babel-plugin-transform-remove-console', 'create-launch',
  'playwright', 'pngjs', 'react-test-renderer', 'sharp', 'typescript', 'vitest',
]);

export function isShippedDependency(name, range) {
  if (/^(workspace|link|file):/.test(String(range))) return false;
  if (name.startsWith('@types/')) return false;
  return !BUILD_ONLY.has(name);
}

/** Normalises the many historical shapes of the package.json license field. */
export function normalizeLicense(pkg) {
  const { license, licenses } = pkg ?? {};
  if (typeof license === 'string' && license.trim()) return license.trim();
  if (license && typeof license === 'object' && typeof license.type === 'string') return license.type;
  if (Array.isArray(licenses) && licenses.length > 0) {
    const types = licenses
      .map((l) => (typeof l === 'string' ? l : l?.type))
      .filter((t) => typeof t === 'string' && t.trim());
    if (types.length > 0) return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
  }
  return 'UNKNOWN';
}

function readInstalledPackageJson(name) {
  const direct = path.join(root, 'node_modules', name, 'package.json');
  if (fs.existsSync(direct)) return JSON.parse(fs.readFileSync(direct, 'utf8'));
  try {
    const require = createRequire(path.join(root, 'package.json'));
    return JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`), 'utf8'));
  } catch {
    return null;
  }
}

export function buildLicenseEntries(dependencies, readPkg = readInstalledPackageJson) {
  return Object.entries(dependencies ?? {})
    .filter(([name, range]) => isShippedDependency(name, range))
    .map(([name, range]) => {
      const pkg = readPkg(name);
      return {
        name,
        version: typeof pkg?.version === 'string' ? pkg.version : String(range),
        license: pkg ? normalizeLicense(pkg) : 'UNKNOWN',
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const entries = buildLicenseEntries({ ...pkg.devDependencies, ...pkg.dependencies });
  const json = `${JSON.stringify(entries, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    if (current !== json) {
      console.error('content/open-source-licenses.json is stale. Run: node scripts/generate-licenses.mjs');
      process.exit(1);
    }
    return;
  }
  fs.writeFileSync(outFile, json);
  const unknown = entries.filter((e) => e.license === 'UNKNOWN').map((e) => e.name);
  console.log(`Wrote ${entries.length} packages to ${path.relative(root, outFile)}`);
  if (unknown.length) console.warn(`License not declared for: ${unknown.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
