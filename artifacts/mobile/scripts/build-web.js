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
const OG_IMAGE_URL = `${CANONICAL_ORIGIN}/brandthread-logo.png`;
const DEFAULT_METADATA = {
  title: 'Brandthread | Discover what’s next',
  description: 'Brandthread connects independent brands, buyers, and makers through social discovery, storefronts, and tools to build what’s next.',
};
const ROUTE_METADATA = {
  '/': DEFAULT_METADATA,
  '/privacy': {
    title: 'Privacy Policy | Brandthread',
    description: 'How Brandthread collects, uses, shares, and protects information across its buyer, seller, social commerce, design, payment, and verification features.',
  },
  '/terms': {
    title: 'Terms of Service | Brandthread',
    description: 'Terms governing Brandthread accounts, social commerce, marketplace orders, seller subscriptions, content, AI tools, and platform conduct.',
  },
};
const PUBLIC_ROUTES = ['/', '/privacy', '/terms'];

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

function normalizeRoutePath(routePath) {
  if (routePath === '/') return routePath;
  return routePath.replace(/\/+$/, '');
}

function structuredDataForRoute(routePath) {
  if (routePath === '/') {
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Brandthread',
        url: CANONICAL_ORIGIN,
        logo: OG_IMAGE_URL,
        description: DEFAULT_METADATA.description,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Brandthread',
        url: CANONICAL_ORIGIN,
        description: DEFAULT_METADATA.description,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Brandthread',
        url: CANONICAL_ORIGIN,
        applicationCategory: 'SocialNetworkingApplication',
        operatingSystem: 'Web, iOS, Android',
        description: DEFAULT_METADATA.description,
      },
    ];
  }
  const routeMetadata = ROUTE_METADATA[routePath];
  if (!routeMetadata) return [];
  return [{
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: routeMetadata.title,
    description: routeMetadata.description,
    url: `${CANONICAL_ORIGIN}${routePath}`,
    isPartOf: { '@type': 'WebSite', name: 'Brandthread', url: CANONICAL_ORIGIN },
  }];
}

function addCanonicalMetadata() {
  for (const filePath of htmlFilesIn(outputDir)) {
    const routePath = normalizeRoutePath(routePathForHtml(filePath));
    const canonicalUrl = `${CANONICAL_ORIGIN}${routePath}`;
    const html = fs.readFileSync(filePath, 'utf8');
    const routeMetadata = ROUTE_METADATA[routePath] || DEFAULT_METADATA;
    const isPublic = PUBLIC_ROUTES.includes(routePath);
    const structuredData = structuredDataForRoute(routePath);
    const publicMetadata = [
      `<link rel="canonical" href="${canonicalUrl}" />`,
      `<meta property="og:url" content="${canonicalUrl}" />`,
      `<title>${routeMetadata.title}</title>`,
      `<meta name="description" content="${routeMetadata.description}" />`,
      `<meta name="robots" content="${isPublic ? 'index,follow' : 'noindex,nofollow'}" />`,
      `<meta property="og:title" content="${routeMetadata.title}" />`,
      `<meta property="og:description" content="${routeMetadata.description}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:image" content="${OG_IMAGE_URL}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${routeMetadata.title}" />`,
      `<meta name="twitter:description" content="${routeMetadata.description}" />`,
      `<meta name="twitter:image" content="${OG_IMAGE_URL}" />`,
      structuredData.length
        ? `<script type="application/ld+json">${JSON.stringify(structuredData.length === 1 ? structuredData[0] : { '@context': 'https://schema.org', '@graph': structuredData })}</script>`
        : '',
    ].join('');
    const metadata = isPublic
      ? publicMetadata
      : '<meta name="robots" content="noindex,nofollow" />';
    const withoutGenericTitle = html
      .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
      .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, '')
      .replace(/<meta\b[^>]*name=["']description["'][^>]*>/gi, '');
    const updated = withoutGenericTitle.replace('</head>', `${metadata}</head>`);
    if (updated !== html) fs.writeFileSync(filePath, updated);
  }
}

function writePublicCrawlFiles() {
  const logoSource = path.join(projectRoot, 'assets/images/brandthread-logo.png');
  if (fs.existsSync(logoSource)) fs.copyFileSync(logoSource, path.join(outputDir, 'brandthread-logo.png'));

  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...PUBLIC_ROUTES.map((route) => [
      '  <url>',
      `    <loc>${CANONICAL_ORIGIN}${route}</loc>`,
      `    <changefreq>${route === '/' ? 'weekly' : 'yearly'}</changefreq>`,
      `    <priority>${route === '/' ? '1.0' : '0.5'}</priority>`,
      '  </url>',
    ].join('\n')),
    '</urlset>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemap);
  fs.writeFileSync(path.join(outputDir, 'robots.txt'), [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /sign-in',
    'Disallow: /onboarding',
    'Disallow: /settings',
    'Disallow: /orders',
    'Disallow: /buyer/',
    'Disallow: /tabs/',
    'Disallow: /chat/',
    'Disallow: /team',
    'Disallow: /manufacturer-hub',
    `Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n'));
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

// With Sentry credentials, emit source maps so web crash reports show real
// file names and lines. They are uploaded to Sentry and then deleted, so they
// are never served publicly.
const uploadSourceMaps = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'].every((name) => process.env[name]?.trim());

console.log(`Exporting Brandthread web build for ${env.EXPO_PUBLIC_DOMAIN}…`);
const result = spawnSync(
  'pnpm',
  [
    'exec', 'expo', 'export', '--platform', 'web', '--output-dir', 'static-build',
    ...(uploadSourceMaps ? ['--source-maps', 'external'] : []),
  ],
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

function sourceMapFilesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceMapFilesIn(fullPath) : entry.name.endsWith('.map') ? [fullPath] : [];
  });
}

function uploadAndRemoveSourceMaps() {
  if (!uploadSourceMaps) {
    console.log('Sentry source maps: skipped (SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are not all set).');
    return;
  }
  const upload = spawnSync(
    process.execPath,
    [require.resolve('@sentry/cli/bin/sentry-cli'), 'sourcemaps', 'upload', outputDir],
    { cwd: projectRoot, env: process.env, stdio: 'inherit' },
  );
  // A failed upload only makes web stack traces harder to read; the site still deploys.
  console.log(upload.status === 0 ? 'Sentry source maps: uploaded.' : 'Sentry source maps: upload failed (continuing).');
  for (const file of sourceMapFilesIn(outputDir)) fs.rmSync(file);
}

uploadAndRemoveSourceMaps();
addCanonicalMetadata();
writePublicCrawlFiles();
console.log('Web export complete.');