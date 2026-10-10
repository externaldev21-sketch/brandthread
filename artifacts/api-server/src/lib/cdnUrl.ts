/**
 * Optional CDN in front of object storage.
 *
 * Off unless CDN_BASE_URL (or ASSET_CDN_URL) is set. When set, signed object
 * URLs that point at Google Cloud Storage are rewritten to the CDN origin,
 * keeping path and query (the signature) intact, so the CDN must be
 * configured with the storage host as its origin and must forward the query
 * string. Anything else (other hosts, relative paths, malformed URLs) is
 * returned unchanged, as is everything when no CDN is configured.
 */
const STORAGE_ORIGINS = new Set(["https://storage.googleapis.com"]);

/** The configured CDN origin without a trailing slash, or null when off or invalid. */
export function resolveCdnBase(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.CDN_BASE_URL ?? env.ASSET_CDN_URL ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function rewriteToCdn(url: string, base: string | null = resolveCdnBase()): string {
  if (!base || typeof url !== "string") return url;
  try {
    const parsed = new URL(url);
    if (!STORAGE_ORIGINS.has(parsed.origin)) return url;
    return `${base}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
