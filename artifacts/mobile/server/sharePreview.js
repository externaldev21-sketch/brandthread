/**
 * Dynamic Open Graph / Twitter Card meta for shared links.
 *
 * The exported build (scripts/build-web.js) bakes fixed title/description/
 * image tags into each static HTML file, which works for the handful of
 * marketing routes but not for per-resource pages like a product, profile
 * or drop — those all share one exported template (dynamic Expo Router
 * segments aren't pre-rendered per id). Without this, a link pasted into
 * iMessage/Instagram/Twitter for any product or profile shows the generic
 * "Brandthread | Discover what's next" card instead of that item's name,
 * photo and price.
 *
 * This module fetches the same public, unauthenticated data the app itself
 * renders (GET /api/v1/public/...) and injects resource-specific meta tags
 * into the SPA shell's <head> before it's served. It never changes the
 * page's JS bundle or client-side behavior — once the app boots it renders
 * the real screen as usual; this only affects what a link-unfurling crawler
 * (and the initial "view source") sees.
 */
// SHARE_ORIGIN (falls back to EXPO_PUBLIC_SHARE_ORIGIN) lets staging builds
// advertise their own origin; production defaults to https://brandthread.app.
const CANONICAL_ORIGIN = (() => {
  const raw = (process.env.SHARE_ORIGIN || process.env.EXPO_PUBLIC_SHARE_ORIGIN || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/i.test(raw) ? raw : 'https://brandthread.app';
})();
const OG_IMAGE_FALLBACK = `${CANONICAL_ORIGIN}/brandthread-logo.png`;
const FETCH_TIMEOUT_MS = 2500;

// process.env.SHARE_PREVIEW_API_BASE lets this point at a different host in
// environments where the API isn't reachable at the same origin as the web
// build (see docs/launch/README.md).
function apiBase() {
  return (process.env.SHARE_PREVIEW_API_BASE || `${CANONICAL_ORIGIN}/api/v1`).replace(/\/+$/, '');
}

// A loader may return NOT_FOUND to say "the API answered 404" (as opposed to
// null = "couldn't tell": API down, timeout, bad JSON). Not-found resources
// get a real 404 status + noindex so a deleted / private post never unfurls
// or gets indexed; "couldn't tell" falls back to the generic shell (200).
const NOT_FOUND = Symbol('not-found');

const HASHTAG_RE = /^\/tag\/([\p{L}\p{N}_]{1,60})\/?$/u;

const MATCHERS = [
  {
    pattern: /^\/p\/([A-Za-z0-9_-]{6,64})\/?$/,
    async load(match) {
      const res = await fetchResource(`${apiBase()}/public/posts/${encodeURIComponent(match[1])}/share-preview`);
      if (res.status === 404) return NOT_FOUND;
      const post = res.data;
      if (!post) return null;
      const author = post.authorName || (post.authorHandle ? `@${post.authorHandle}` : 'Brandthread');
      return {
        title: `${author} on Brandthread`,
        description: post.caption || `Watch ${author}'s post on Brandthread.`,
        image: post.imageUrl || OG_IMAGE_FALLBACK,
      };
    },
  },
  {
    pattern: /^\/store\/(?!product(?:\/|$))([^/]+)\/?$/,
    async load(match) {
      const res = await fetchResource(`${apiBase()}/public/stores/${encodeURIComponent(match[1])}/share-preview`);
      if (res.status === 404) return NOT_FOUND;
      const store = res.data;
      if (!store) return null;
      return {
        title: `${store.name} on Brandthread`,
        description: store.description || `Shop ${store.name} on Brandthread.`,
        image: store.imageUrl || OG_IMAGE_FALLBACK,
      };
    },
  },
  {
    // Hashtags have no private data to look up, so no API round trip.
    pattern: HASHTAG_RE,
    async load(match) {
      const tag = match[1].toLowerCase();
      return {
        title: `#${tag} on Brandthread`,
        description: `Watch the latest posts tagged #${tag} on Brandthread.`,
        image: OG_IMAGE_FALLBACK,
      };
    },
  },
  {
    // Served by the places API (built alongside the location pages). Until
    // that endpoint exists it 404s, which degrades to the generic card.
    pattern: /^\/place\/([A-Za-z0-9_-]{6,64})\/?$/,
    async load(match) {
      const res = await fetchResource(`${apiBase()}/public/places/${encodeURIComponent(match[1])}/share-preview`);
      const place = res.data;
      if (!place || !place.name) return null;
      return {
        title: `${place.name} on Brandthread`,
        description: place.description || `See posts from ${place.name} on Brandthread.`,
        image: place.imageUrl || OG_IMAGE_FALLBACK,
      };
    },
  },
  {
    pattern: /^\/u\/([^/]+)\/?$/,
    async load(match) {
      const res = await fetchJson(`${apiBase()}/public/profiles/${encodeURIComponent(match[1])}`);
      if (!res) return null;
      const name = res.displayName || res.name || `@${res.username}`;
      return {
        title: `${name} on Brandthread`,
        description: res.bio || `See ${name}'s storefront and posts on Brandthread.`,
        image: res.avatarUrl || res.profileImageUrl || OG_IMAGE_FALLBACK,
      };
    },
  },
  {
    pattern: /^\/c\/([^/]+)\/?$/,
    async load(match) {
      const res = await fetchJson(`${apiBase()}/public/collections/${encodeURIComponent(match[1])}`);
      const collection = res?.collection;
      if (!collection) return null;
      return {
        title: `${collection.name} — a collection by ${collection.ownerName || 'Brandthread'}`,
        description: `${collection.itemCount ?? 0} saved items on Brandthread.`,
        image: collection.coverImageUrl || OG_IMAGE_FALLBACK,
      };
    },
  },
  {
    pattern: /^\/store\/product\/([^/]+)\/?$/,
    async load(match) {
      const product = await fetchJson(`${apiBase()}/public/products/${encodeURIComponent(match[1])}`);
      if (!product) return null;
      const price = lowestVariantPrice(product.variants);
      return {
        title: price ? `${product.name} — ${price}` : product.name,
        description: product.description || `Shop ${product.name} on Brandthread.`,
        image: Array.isArray(product.images) && product.images[0] ? product.images[0] : OG_IMAGE_FALLBACK,
      };
    },
  },
  {
    pattern: /^\/drops\/([^/]+)\/?$/,
    async load(match) {
      const drop = await fetchJson(`${apiBase()}/public/drops/${encodeURIComponent(match[1])}`);
      if (!drop) return null;
      const image = Array.isArray(drop.products) && drop.products[0]?.images?.[0];
      return {
        title: drop.name ? `${drop.name} — a drop on Brandthread` : 'A drop on Brandthread',
        description: drop.description || 'Limited drop on Brandthread.',
        image: image || OG_IMAGE_FALLBACK,
      };
    },
  },
];

function lowestVariantPrice(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const cents = variants
    .map((v) => v?.priceCents)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (cents.length === 0) return null;
  return `$${(Math.min(...cents) / 100).toFixed(2)}`;
}

async function fetchResource(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: await res.json() };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtmlAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function findMatcher(pathname) {
  for (const matcher of MATCHERS) {
    const match = pathname.match(matcher.pattern);
    if (match) return { matcher, match };
  }
  return null;
}

/**
 * Returns `{ html, status }` with resource-specific meta injected, or null
 * when the path isn't a known share-preview route or the API couldn't be
 * reached — callers fall back to serving the shell unchanged. `status` is 404
 * (with noindex meta) when the API says the resource doesn't exist or isn't
 * public.
 */
async function renderSharePreview(pathname, shellHtml) {
  const found = findMatcher(pathname);
  if (!found) return null;

  let meta;
  try {
    meta = await found.matcher.load(found.match);
  } catch {
    meta = null;
  }
  if (!meta) return null;

  if (meta === NOT_FOUND) {
    const html = shellHtml.replace('</head>', '<meta name="robots" content="noindex" /></head>');
    return { html, status: 404 };
  }

  const canonicalUrl = escapeHtmlAttr(`${CANONICAL_ORIGIN}${pathname}`);
  const title = escapeHtmlAttr(meta.title);
  const description = escapeHtmlAttr(meta.description);
  const image = escapeHtmlAttr(meta.image);
  const tags = [
    `<link rel="canonical" href="${canonicalUrl}" />`,
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    `<meta property="og:site_name" content="Brandthread" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join('');

  const html = shellHtml
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '')
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/i, '')
    .replace(/<meta\b[^>]*name=["']description["'][^>]*>/i, '')
    .replace(/<meta\b[^>]*property=["']og:[^"']+["'][^>]*>/gi, '')
    .replace(/<meta\b[^>]*name=["']twitter:[^"']+["'][^>]*>/gi, '')
    .replace('</head>', `${tags}</head>`);
  return { html, status: 200 };
}

/** Back-compat wrapper: HTML string for a successful preview, else null. */
async function renderSharePreviewHtml(pathname, shellHtml) {
  const result = await renderSharePreview(pathname, shellHtml);
  return result && result.status === 200 ? result.html : null;
}

module.exports = { renderSharePreviewHtml, renderSharePreview, apiBase };
