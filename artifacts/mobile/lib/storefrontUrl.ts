/**
 * The one place that turns a storefront slug into a URL that actually
 * resolves.
 *
 * A published storefront is served (no auth) by the API at
 * GET /api/store/site/:slug — the same `pageUrl` the API itself embeds in the
 * rendered page (artifacts/api-server/src/routes/store.ts). Nothing serves
 * `{slug}.brandthread.app` subdomains, and the slug the server knows is the
 * storefront row's `slug` from GET /api/store (e.g. `store-1a2b3c4d`).
 *
 * Older builds cached the slug as `"{slug}.brandthread.app"` and then
 * appended `.brandthread.app` again when displaying it, which produced
 * `yourbrand.brandthread.app.brandthread.app`. `normalizeStoreSlug` strips any
 * protocol, `www.`, path, query and (repeated) `.brandthread.app` suffix.
 *
 * Pure module: no react-native imports, safe to unit test.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9_.-]{0,80}$/;
const BRANDTHREAD_SUFFIX_RE = /(?:\.brandthread\.app)+$/i;

export function normalizeStoreSlug(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // protocol
  s = s.replace(/[?#].*$/, '');
  // "brandthread.app/store/x" or ".../api/store/site/x" → last path segment
  const [host, ...path] = s.split('/').filter(Boolean);
  if (!host) return null;
  if (/^(?:www\.)?brandthread\.app$/.test(host) || path.length > 0) {
    s = path.length > 0 ? path[path.length - 1] : '';
  } else {
    s = host;
  }
  s = s.replace(/^www\./, '').replace(BRANDTHREAD_SUFFIX_RE, '').replace(/^@/, '');
  if (s === 'brandthread.app') return null;
  return SLUG_RE.test(s) ? s : null;
}

/** Live storefront URL for a published store, or null when there's no valid slug. */
export function buildStorefrontSiteUrl(slug: string | null | undefined, apiBaseUrl: string): string | null {
  const clean = normalizeStoreSlug(slug);
  const base = (apiBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!clean || !/^https?:\/\/[^\s/]+/i.test(base)) return null;
  return `${base}/api/store/site/${encodeURIComponent(clean)}`;
}

/** URL without the protocol, for display. */
export function displayUrl(url: string | null | undefined): string {
  return (url ?? '').replace(/^https?:\/\//i, '');
}

export type ShareStoreLink =
  | { url: string; label: string; kind: 'username' | 'storefront' }
  | { url: null; reason: string };

/**
 * The link "Share store" hands out. Never guesses: a seller's username
 * (https://brandthread.app/store/{username}, which opens their profile) or,
 * without one, their own published storefront's live URL from its server
 * slug. Anything else (no username and an unpublished/unknown storefront)
 * yields no link — a brand-name or default fallback could open someone
 * else's profile.
 */
export function resolveShareStoreLink(opts: {
  username: string | null | undefined;
  storefront: { slug?: string | null; status?: string | null } | null | undefined;
  apiBaseUrl: string;
  shareOrigin: string;
}): ShareStoreLink {
  const username = (opts.username ?? '').trim().replace(/^@/, '').toLowerCase();
  if (/^[a-z0-9_]{3,30}$/.test(username)) {
    const origin = opts.shareOrigin.replace(/\/+$/, '');
    return { url: `${origin}/store/${encodeURIComponent(username)}`, label: `@${username}`, kind: 'username' };
  }
  const sf = opts.storefront;
  if (sf && sf.status === 'published') {
    const url = buildStorefrontSiteUrl(sf.slug, opts.apiBaseUrl);
    if (url) return { url, label: displayUrl(url), kind: 'storefront' };
  }
  return {
    url: null,
    reason: sf?.status === 'published'
      ? 'Add a username in Edit Profile to get your store link.'
      : 'Add a username in Edit Profile, or publish your store, to get a link you can share.',
  };
}
