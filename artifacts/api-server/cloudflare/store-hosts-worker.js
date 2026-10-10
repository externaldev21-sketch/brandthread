/**
 * Cloudflare Worker: serves Brandthread storefronts on their own hosts
 * (BT-307). Deploy steps: docs/growth/store-domains.md.
 *
 *   https://<slug>.brandthread.app/            → the published storefront
 *   https://<seller's verified domain>/        → the same, via Cloudflare for SaaS
 *
 * Every request is fetched from the main site (ORIGIN, default
 * https://brandthread.app). The store home maps to the existing public page
 * /api/store/site/<slug>; any other path (cart, checkout, assets, /api/...)
 * is passed through unchanged, so the storefront's own links keep working.
 * Custom domains are looked up with GET /api/store/host-lookup?host=...,
 * which only answers for verified domains of published stores.
 */
const RESERVED = new Set([
  'www', 'api', 'app', 'admin', 'auth', 'clerk', 'mail', 'cdn', 'static', 'assets', 'status', 'help', 'docs',
  'store', 'shop', 'brandthread', 'support', 'blog', 'm', 'dev', 'staging', 'preview', 's', 'u', 'l', 'g',
]);
const PLATFORM_SUFFIX = '.brandthread.app';

/** "northline" for northline.brandthread.app; null for the platform's own hosts. */
export function subdomainSlug(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!h.endsWith(PLATFORM_SUFFIX)) return null;
  const label = h.slice(0, -PLATFORM_SUFFIX.length);
  if (!label || label.includes('.') || RESERVED.has(label)) return null;
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(label) ? label : null;
}

/** Where on the main site a storefront-host request is served from. */
export function upstreamPath(slug, url) {
  if (url.pathname === '/' || url.pathname === '') return `/api/store/site/${encodeURIComponent(slug)}${url.search}`;
  return `${url.pathname}${url.search}`;
}

async function slugForCustomDomain(host, origin, fetchImpl) {
  const res = await fetchImpl(`${origin}/api/store/host-lookup?host=${encodeURIComponent(host)}`, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body && typeof body.slug === 'string' ? body.slug : null;
}

export async function handle(request, env = {}, fetchImpl = fetch) {
  const origin = String(env.ORIGIN || 'https://brandthread.app').replace(/\/+$/, '');
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  let slug = subdomainSlug(host);
  if (!slug && !host.endsWith(PLATFORM_SUFFIX) && host !== 'brandthread.app') {
    slug = await slugForCustomDomain(host, origin, fetchImpl);
  }
  if (!slug) return Response.redirect(origin, 302);
  const upstream = new Request(`${origin}${upstreamPath(slug, url)}`, request);
  upstream.headers.set('x-brandthread-store-host', host);
  return fetchImpl(upstream);
}

export default { fetch: (request, env) => handle(request, env) };
