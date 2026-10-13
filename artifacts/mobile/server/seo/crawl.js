/**
 * robots.txt, sitemap.xml (index) and the per-kind sitemaps, plus the
 * /.well-known proxy, for brandthread.app.
 *
 * brandthread.app only routes /api/* to the API server, so everything here
 * is answered by serve.js. The build's static robots.txt / sitemap.xml
 * (scripts/build-web.js) remain the fallback for static hosting and supply
 * the legal pages list (served as /sitemap-pages.xml).
 */
const fs = require('fs');
const path = require('path');
const { CANONICAL_ORIGIN, createTtlCache, escapeXml, fetchApi } = require('./shared');

const SITEMAP_KINDS = ['products', 'stores', 'drops'];
const cache = createTtlCache(10 * 60 * 1000, 10);

// Signed-in / account areas of the app that have no public content.
const DISALLOW = [
  '/api/',
  '/sign-in',
  '/forgot-password',
  '/onboarding',
  '/splash',
  '/settings',
  '/orders',
  '/order-detail',
  '/checkout',
  '/buyer-checkout',
  '/thread-checkout',
  '/buyer/',
  '/tabs/',
  '/chat/',
  '/team',
  '/team-invite',
  '/manufacturer-hub',
  '/seller-',
  '/store-builder',
  '/store-editor',
  '/payout',
  '/finance',
  '/billing',
  '/account-type',
  '/access-code',
  '/*?bt_preview=',
];

function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    ...DISALLOW.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
}

function urlset(entries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((e) => [
      '<url>',
      `<loc>${escapeXml(e.loc)}</loc>`,
      e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : '',
      e.changefreq ? `<changefreq>${escapeXml(e.changefreq)}</changefreq>` : '',
      '</url>',
    ].join('')),
    '</urlset>',
    '',
  ].join('\n');
}

function sitemapIndexXml(now = new Date()) {
  const lastmod = now.toISOString();
  const names = ['pages', ...SITEMAP_KINDS];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...names.map((n) => `<sitemap><loc>${CANONICAL_ORIGIN}/sitemap-${n}.xml</loc><lastmod>${lastmod}</lastmod></sitemap>`),
    '</sitemapindex>',
    '',
  ].join('\n');
}

/** Public static routes from the build's sitemap, plus /new. */
function pagesSitemapXml(staticRoot) {
  const locs = new Set();
  try {
    const built = fs.readFileSync(path.join(staticRoot, 'sitemap.xml'), 'utf8');
    for (const m of built.matchAll(/<loc>([^<]+)<\/loc>/g)) locs.add(m[1].trim());
  } catch {
    locs.add(`${CANONICAL_ORIGIN}/`);
  }
  const entries = [...locs].map((loc) => ({ loc }));
  entries.push({ loc: `${CANONICAL_ORIGIN}/new`, changefreq: 'daily' });
  return urlset(entries);
}

async function kindSitemapXml(kind) {
  if (!SITEMAP_KINDS.includes(kind)) return null;
  const data = await cache.get(kind, async () => {
    const res = await fetchApi(`/public/seo/sitemap/${kind}`);
    return res.data && Array.isArray(res.data.entries) ? res.data.entries : null;
  });
  if (!data) return null;
  return urlset(
    data
      .filter((e) => typeof e.path === 'string' && e.path.startsWith('/'))
      .map((e) => ({ loc: `${CANONICAL_ORIGIN}${e.path}`, lastmod: e.lastModified })),
  );
}

/**
 * Returns `{ status, body, contentType, cacheControl }` for a crawl path, or
 * null when the path isn't one of ours.
 */
async function renderCrawlFile(pathname, staticRoot) {
  if (pathname === '/robots.txt') {
    return { status: 200, body: robotsTxt(), contentType: 'text/plain; charset=utf-8', cacheControl: 'public, max-age=3600' };
  }
  if (pathname === '/sitemap.xml') {
    return { status: 200, body: sitemapIndexXml(), contentType: 'application/xml; charset=utf-8', cacheControl: 'public, max-age=3600' };
  }
  if (pathname === '/sitemap-pages.xml') {
    return { status: 200, body: pagesSitemapXml(staticRoot), contentType: 'application/xml; charset=utf-8', cacheControl: 'public, max-age=3600' };
  }
  const m = /^\/sitemap-([a-z]+)\.xml$/.exec(pathname);
  if (m && SITEMAP_KINDS.includes(m[1])) {
    const xml = await kindSitemapXml(m[1]);
    if (!xml) return { status: 503, body: 'Sitemap temporarily unavailable', contentType: 'text/plain; charset=utf-8', cacheControl: 'no-store' };
    return { status: 200, body: xml, contentType: 'application/xml; charset=utf-8', cacheControl: 'public, max-age=900' };
  }
  return null;
}

const WELL_KNOWN = {
  '/.well-known/apple-app-site-association': 'apple-app-site-association',
  '/.well-known/assetlinks.json': 'assetlinks.json',
};
const wellKnownCache = createTtlCache(5 * 60 * 1000, 4);

/**
 * Universal-link / App Link / App Clip verification files, proxied from the
 * API's /public/well-known mirror (Apple and Google fetch them from the site
 * root). 502 when the API can't be reached so the platforms retry later
 * rather than caching an empty association.
 */
async function renderWellKnown(pathname) {
  const file = WELL_KNOWN[pathname];
  if (!file) return null;
  const data = await wellKnownCache.get(file, async () => (await fetchApi(`/public/well-known/${file}`)).data);
  if (!data) return { status: 502, body: '{}', contentType: 'application/json', cacheControl: 'no-store' };
  return { status: 200, body: JSON.stringify(data), contentType: 'application/json', cacheControl: 'public, max-age=300' };
}

module.exports = {
  DISALLOW,
  SITEMAP_KINDS,
  pagesSitemapXml,
  renderCrawlFile,
  renderWellKnown,
  robotsTxt,
  sitemapIndexXml,
  _caches: { cache, wellKnownCache },
};
