/**
 * Canonical https share links for everything a person can share out of the
 * app (posts, stores, products, profiles, hashtags, places), and the inverse:
 * mapping an incoming https / brandthread:// link to an in-app route.
 *
 * Origin: EXPO_PUBLIC_SHARE_ORIGIN (e.g. a staging domain), defaulting to the
 * production origin https://brandthread.app. The same paths are claimed by
 * the apple-app-site-association / assetlinks files served by the API, and
 * rendered with Open Graph tags by server/sharePreview.js.
 *
 * Pure module: no react-native imports, safe to unit test.
 */
import { BRANDTHREAD_ORIGIN, buildCanonicalProfileUrl } from './shareProfile';

function resolveOrigin(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_SHARE_ORIGIN ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/i.test(fromEnv) ? fromEnv : BRANDTHREAD_ORIGIN;
}

export const SHARE_ORIGIN = resolveOrigin();

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

/** Hashtag body without the leading #: lowercase letters/digits/underscore (unicode letters allowed). */
export function normalizeHashtag(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const tag = raw.trim().replace(/^#+/, '').toLowerCase();
  return /^[\p{L}\p{N}_]{1,60}$/u.test(tag) ? tag : null;
}

export function buildPostUrl(postId: string | null | undefined): string | null {
  return postId && ID_RE.test(postId) ? `${SHARE_ORIGIN}/p/${postId}` : null;
}

export function buildStoreUrl(handle: string | null | undefined): string | null {
  const h = (handle ?? '').trim().replace(/^@/, '');
  return HANDLE_RE.test(h) ? `${SHARE_ORIGIN}/store/${encodeURIComponent(h.toLowerCase())}` : null;
}

export function buildProductUrl(productId: string | null | undefined): string | null {
  return productId && ID_RE.test(productId) ? `${SHARE_ORIGIN}/store/product/${productId}` : null;
}

export function buildProfileUrl(username: string | null | undefined): string | null {
  const url = buildCanonicalProfileUrl(username);
  return url ? url.replace(BRANDTHREAD_ORIGIN, SHARE_ORIGIN) : null;
}

export function buildHashtagUrl(tag: string | null | undefined): string | null {
  const t = normalizeHashtag(tag);
  return t ? `${SHARE_ORIGIN}/tag/${encodeURIComponent(t)}` : null;
}

export function buildPlaceUrl(placeId: string | null | undefined): string | null {
  return placeId && ID_RE.test(placeId) ? `${SHARE_ORIGIN}/place/${placeId}` : null;
}

export type ShareLinkTarget =
  | { kind: 'post'; id: string; href: string }
  | { kind: 'store'; handle: string; href: string }
  | { kind: 'product'; id: string; href: string }
  | { kind: 'profile'; username: string; href: string }
  | { kind: 'hashtag'; tag: string; href: string }
  | { kind: 'place'; id: string; href: string }
  | { kind: 'collection'; id: string; href: string }
  | { kind: 'drop'; id: string; href: string };

const HOSTS = /^(?:https?:\/\/(?:www\.)?brandthread\.app|brandthread:\/\/\/?)/i;

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Maps an incoming https / custom-scheme link (or a bare path) to the in-app
 * route that should open it. Returns null for anything that isn't a known
 * Brandthread share link, so callers never navigate on foreign URLs.
 */
export function parseShareLink(raw: string | null | undefined): ShareLinkTarget | null {
  if (!raw || typeof raw !== 'string') return null;
  let input = raw.trim();
  if (input.toLowerCase().startsWith(SHARE_ORIGIN.toLowerCase())) input = input.slice(SHARE_ORIGIN.length);
  else if (HOSTS.test(input)) input = input.replace(HOSTS, '/');
  else if (!input.startsWith('/')) return null;
  input = input.replace(/[?#].*$/, '');
  const decoded = input.split('/').filter(Boolean).map(safeDecode);
  if (decoded.length === 0 || decoded.some((p) => p === null)) return null;
  const parts = decoded as string[];
  const [head, a, b] = parts;
  const q = encodeURIComponent;

  if (head === 'p' && parts.length === 2 && ID_RE.test(a)) {
    return { kind: 'post', id: a, href: `/buyer-post-viewer?postId=${q(a)}` };
  }
  if (head === 'tag' && parts.length === 2) {
    const tag = normalizeHashtag(a);
    return tag ? { kind: 'hashtag', tag, href: `/hashtag/${q(tag)}` } : null;
  }
  if (head === 'place' && parts.length === 2 && ID_RE.test(a)) {
    return { kind: 'place', id: a, href: `/location/${q(a)}` };
  }
  if (head === 'u' && parts.length === 2) {
    const username = a.trim().toLowerCase();
    return /^[a-z0-9_]{3,30}$/.test(username) ? { kind: 'profile', username, href: `/u/${q(username)}` } : null;
  }
  if (head === 'store' && a === 'product' && parts.length === 3 && ID_RE.test(b)) {
    return { kind: 'product', id: b, href: `/product-detail?id=${q(b)}` };
  }
  if (head === 'store' && a && a !== 'product' && parts.length === 2 && HANDLE_RE.test(a)) {
    const handle = a.toLowerCase();
    return { kind: 'store', handle, href: `/u/${q(handle)}` };
  }
  if (head === 'c' && parts.length === 2) return { kind: 'collection', id: a, href: `/c/${q(a)}` };
  if (head === 'drops' && parts.length === 2) return { kind: 'drop', id: a, href: `/drops/${q(a)}` };
  return null;
}
