/**
 * Optional CDN for object-storage images (client half of the API's
 * `CDN_BASE_URL`; see docs/performance/launch-and-media.md).
 *
 * Off unless EXPO_PUBLIC_CDN_BASE_URL is set at build time. When on, URLs on
 * Google Cloud Storage are served through the CDN origin with path and query
 * kept. Every other URL, and every URL when the variable is unset, is returned
 * exactly as given.
 */
const STORAGE_ORIGINS = new Set(['https://storage.googleapis.com']);

export function resolveCdnBase(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

const CONFIGURED_BASE = resolveCdnBase(process.env.EXPO_PUBLIC_CDN_BASE_URL);

export function rewriteAssetUrl(uri: string, base: string | null = CONFIGURED_BASE): string {
  if (!base || typeof uri !== 'string') return uri;
  try {
    const parsed = new URL(uri);
    if (!STORAGE_ORIGINS.has(parsed.origin)) return uri;
    return `${base}${parsed.pathname}${parsed.search}`;
  } catch {
    return uri;
  }
}

/** Rewrites an expo-image style source; returns the same reference when nothing changes. */
export function rewriteImageSource<T>(source: T, base: string | null = CONFIGURED_BASE): T {
  if (!base || !source) return source;
  if (typeof source === 'string') return rewriteAssetUrl(source, base) as unknown as T;
  if (Array.isArray(source)) {
    let changed = false;
    const next = source.map((entry) => {
      const rewritten = rewriteImageSource(entry, base);
      if (rewritten !== entry) changed = true;
      return rewritten;
    });
    return (changed ? next : source) as unknown as T;
  }
  const uri = (source as { uri?: unknown }).uri;
  if (typeof uri !== 'string') return source;
  const rewritten = rewriteAssetUrl(uri, base);
  return rewritten === uri ? source : ({ ...(source as object), uri: rewritten } as T);
}
