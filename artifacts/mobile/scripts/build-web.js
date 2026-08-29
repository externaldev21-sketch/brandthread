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
const CANONICAL_ORIGIN = 'https://brandthread.app';
const ROUTE_METADATA = {
  '/privacy': {
    title: 'Privacy Policy | Brandthread',
    description: 'How Brandthread collects, uses, shares, and protects information across its buyer, seller, social commerce, design, payment, and verification features.',
  },
  '/terms': {
    title: 'Terms of Service | Brandthread',
    description: 'Terms governing Brandthread accounts, social commerce, marketplace orders, seller subscriptions, content, AI tools, and platform conduct.',
  },
};

function domainFromEnvironment() {
  const isPublishedBuild =
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.REPLIT_DEPLOYMENT_DOMAIN || process.env.REPLIT_INTERNAL_APP_DOMAIN);
  if (isPublishedBuild) return 'brandthread.app';

  const candidates = [
    process.env.REPLIT_DEV_DOMAIN,
    process.env.EXPO_PUBLIC_DOMAIN,
  ];
  const value = candidates.find(Boolean);
  if (!value) return 'localhost:18115';
  return value.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function htmlFilesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? htmlFilesIn(fullPath) : entry.name.endsWith('.html') ? [fullPath] : [];
  });
}

function routePathForHtml(filePath) {
  const relativePath = path.relative(outputDir, filePath).split(path.sep).join('/');
  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html')) {
    return `/${relativePath.slice(0, -'index.html'.length)}`;
  }
  return `/${relativePath.replace(/\.html$/, '')}`;
}

function addCanonicalMetadata() {
  for (const filePath of htmlFilesIn(outputDir)) {
    const routePath = routePathForHtml(filePath);
    const canonicalUrl = `${CANONICAL_ORIGIN}${routePath}`;
    const html = fs.readFileSync(filePath, 'utf8');
    const routeMetadata = ROUTE_METADATA[routePath];
    const metadata = [
      `<link rel="canonical" href="${canonicalUrl}" />`,
      `<meta property="og:url" content="${canonicalUrl}" />`,
      routeMetadata ? `<title>${routeMetadata.title}</title>` : '',
      routeMetadata ? `<meta name="description" content="${routeMetadata.description}" />` : '',
      routeMetadata ? `<meta property="og:title" content="${routeMetadata.title}" />` : '',
      routeMetadata ? `<meta property="og:description" content="${routeMetadata.description}" />` : '',
    ].join('');
    const withoutGenericTitle = routeMetadata
      ? html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
      : html;
    const updated = withoutGenericTitle.replace('</head>', `${metadata}</head>`);
    if (updated !== html) fs.writeFileSync(filePath, updated);
  }
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

addCanonicalMetadata();
console.log('Web export complete.');