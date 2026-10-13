/**
 * Low-res → sharp image loading (Dev's less-AI pass, item 51): a remote
 * photo first paints a tiny, fast copy of itself, then fades to the full
 * image — never a spinner, never a blank box while it loads.
 *
 * The tiny copy only exists where the image host can resize on the fly:
 *  - Shopify CDN (imported products): `width=` query parameter.
 *  - Our own media CDN (EXPO_PUBLIC_CDN_BASE_URL) when Cloudflare Image
 *    Resizing is turned on for it (EXPO_PUBLIC_CDN_IMAGE_RESIZING=1):
 *    `/cdn-cgi/image/width=…/…`. Off by default; see docs in the PR.
 * Anything else returns null and the image loads as before.
 */
import { resolveCdnBase, rewriteAssetUrl } from './cdnUrl';

export const LOW_RES_WIDTH = 32;

const CDN_BASE = resolveCdnBase(process.env.EXPO_PUBLIC_CDN_BASE_URL);
const CDN_RESIZING = process.env.EXPO_PUBLIC_CDN_IMAGE_RESIZING === '1';

export function lowResVariantUri(
  uri: string,
  { cdnBase = CDN_BASE, cdnResizing = CDN_RESIZING, width = LOW_RES_WIDTH }: { cdnBase?: string | null; cdnResizing?: boolean; width?: number } = {},
): string | null {
  if (typeof uri !== 'string' || !/^https?:\/\//i.test(uri)) return null;
  let url: URL;
  try {
    url = new URL(rewriteAssetUrl(uri, cdnBase));
  } catch {
    return null;
  }
  if (url.hostname === 'cdn.shopify.com') {
    url.searchParams.set('width', String(width));
    return url.toString();
  }
  if (cdnBase && cdnResizing) {
    const base = new URL(cdnBase);
    if (url.origin === base.origin && !url.pathname.startsWith('/cdn-cgi/')) {
      return `${url.origin}/cdn-cgi/image/width=${width},quality=40,format=auto${url.pathname}${url.search}`;
    }
  }
  return null;
}

/** An expo-image `placeholder` for a `source`, or undefined when no tiny copy exists. */
export function lowResPlaceholder(source: unknown, options?: Parameters<typeof lowResVariantUri>[1]): { uri: string } | undefined {
  const uri = typeof source === 'string'
    ? source
    : source && typeof source === 'object' && !Array.isArray(source) && typeof (source as { uri?: unknown }).uri === 'string'
      ? (source as { uri: string }).uri
      : null;
  if (!uri) return undefined;
  const low = lowResVariantUri(uri, options);
  return low ? { uri: low } : undefined;
}
