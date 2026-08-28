/**
 * Export the existing Expo Router app as a browser-hosted static site.
 *
 * The mobile artifact is one product with native and web targets. This script
 * deliberately uses Expo's web exporter rather than the old Expo Go manifest
 * builder, so browser routes receive real HTML/JS and can be served by the
 * artifact's production service.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'static-build');

function domainFromEnvironment() {
  const candidates = [
    process.env.REPLIT_DEPLOYMENT_DOMAIN,
    process.env.REPLIT_INTERNAL_APP_DOMAIN,
    process.env.REPLIT_DEV_DOMAIN,
    process.env.EXPO_PUBLIC_DOMAIN,
  ];
  const value = candidates.find(Boolean);
  if (!value) return 'localhost:18115';
  return value.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

const env = {
  ...process.env,
  EXPO_PUBLIC_DOMAIN: domainFromEnvironment(),
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY ||
    '',
  // Production browser traffic must stay on the selected deployment domain.
  // Never inherit EXPO_PUBLIC_* URLs from .replit/dev workflow configuration,
  // or the deployed bundle can accidentally target the development backend.
  EXPO_PUBLIC_CLERK_PROXY_URL:
    `https://${domainFromEnvironment()}/api/__clerk`,
  EXPO_PUBLIC_API_BASE_URL:
    `https://${domainFromEnvironment()}`,
};

if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true, force: true });
}

console.log(`Exporting Brandthread web build for ${env.EXPO_PUBLIC_DOMAIN}…`);
const result = spawnSync(
  'pnpm',
  ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', 'static-build'],
  {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(`Web export failed to start: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
if (!fs.existsSync(path.join(outputDir, 'index.html'))) {
  console.error('Web export completed without static-build/index.html');
  process.exit(1);
}

console.log('Web export complete.');