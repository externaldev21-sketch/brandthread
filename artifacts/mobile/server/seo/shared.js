/**
 * Shared helpers for the crawlable pages served by serve.js (product SEO,
 * /new, sitemaps, robots.txt). Plain CommonJS, no dependencies.
 */
const { apiBase } = require('../sharePreview');

const CANONICAL_ORIGIN = (() => {
  const raw = (process.env.SHARE_ORIGIN || process.env.EXPO_PUBLIC_SHARE_ORIGIN || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/i.test(raw) ? raw : 'https://brandthread.app';
})();
const OG_IMAGE_FALLBACK = `${CANONICAL_ORIGIN}/brandthread-logo.png`;
const FETCH_TIMEOUT_MS = 2500;

/**
 * `{ status, data, error }`; status 0 = unreachable / timeout / bad JSON.
 * `error` is the JSON body of a non-2xx answer (or null).
 */
async function fetchApi(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase()}${path}`, { signal: controller.signal });
    if (!res.ok) {
      const error = await Promise.resolve().then(() => res.json()).catch(() => null);
      return { status: res.status, data: null, error };
    }
    return { status: res.status, data: await res.json() };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Tiny TTL cache so crawler bursts don't fan out to the API. */
function createTtlCache(ttlMs, maxEntries = 200) {
  const entries = new Map();
  return {
    async get(key, load) {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && hit.expires > now) return hit.value;
      const value = await load();
      if (value !== null && value !== undefined) {
        if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
        entries.set(key, { value, expires: now + ttlMs });
      }
      return value;
    },
    clear() { entries.clear(); },
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * JSON for an inline <script type="application/ld+json">. `<` is escaped so
 * no value can close the script (`</script>`) or open a comment; U+2028/9
 * are escaped for older parsers.
 */
function jsonLdScript(data) {
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
  return `<script type="application/ld+json">${json}</script>`;
}

/** Integer cents → "$1,234" or "$45.50", no floating-point math. */
function formatUsd(cents) {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents < 0) return null;
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = cents % 100;
  return rest === 0 ? `$${whole}` : `$${whole}.${rest < 10 ? `0${rest}` : rest}`;
}

/** Integer cents → schema.org decimal "45.00". */
function centsToDecimal(cents) {
  const safe = Math.max(0, Math.trunc(cents));
  const rest = safe % 100;
  return `${Math.floor(safe / 100)}.${rest < 10 ? `0${rest}` : rest}`;
}

function httpUrlOrNull(value) {
  return typeof value === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(value.trim()) ? value.trim() : null;
}

/**
 * Removes the shell's generic head metadata (title, description, canonical,
 * robots, OG/Twitter, JSON-LD) so a page can inject its own exactly once.
 */
function stripGenericHead(html) {
  return html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, '')
    .replace(/<meta\b[^>]*name=["'](?:description|robots)["'][^>]*>/gi, '')
    .replace(/<meta\b[^>]*property=["'](?:og|product):[^"']+["'][^>]*>/gi, '')
    .replace(/<meta\b[^>]*name=["']twitter:[^"']+["'][^>]*>/gi, '')
    .replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '');
}

function socialMetaTags({ canonicalUrl, title, description, image, type = 'website', robots = 'index,follow' }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const i = escapeHtml(image);
  const u = escapeHtml(canonicalUrl);
  return [
    `<title>${t}</title>`,
    `<link rel="canonical" href="${u}" />`,
    `<meta name="description" content="${d}" />`,
    `<meta name="robots" content="${escapeHtml(robots)}" />`,
    `<meta property="og:url" content="${u}" />`,
    '<meta property="og:site_name" content="Brandthread" />',
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:type" content="${escapeHtml(type)}" />`,
    `<meta property="og:image" content="${i}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${i}" />`,
  ].join('');
}

module.exports = {
  CANONICAL_ORIGIN,
  OG_IMAGE_FALLBACK,
  centsToDecimal,
  createTtlCache,
  escapeHtml,
  escapeXml,
  fetchApi,
  formatUsd,
  httpUrlOrNull,
  jsonLdScript,
  socialMetaTags,
  stripGenericHead,
};
