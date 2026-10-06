/**
 * A storefront's public address. `settings.storeUrl` arrives either as a bare
 * slug ("northline") or already as a host ("northline.brandthread.app" —
 * services/storeService.ts sets that from the server slug). The publish
 * screen used to append ".brandthread.app" again, showing and opening
 * "northline.brandthread.app.brandthread.app".
 */
const SUFFIX = '.brandthread.app';

export function storeSlugFrom(storeUrl: string | null | undefined): string {
  const host = String(storeUrl ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return host.endsWith(SUFFIX) ? host.slice(0, -SUFFIX.length) : host;
}

/** "northline.brandthread.app" — what the seller sees as their address. */
export function storeHostFrom(storeUrl: string | null | undefined, fallback = 'yourstore'): string {
  return `${storeSlugFrom(storeUrl) || fallback}${SUFFIX}`;
}

/** A link that opens the published store with no DNS setup needed
 *  (brandthread.app/s/<slug> → the API's public storefront page). */
export function storeViewUrl(storeUrl: string | null | undefined): string | null {
  const slug = storeSlugFrom(storeUrl);
  return slug ? `https://brandthread.app/s/${encodeURIComponent(slug)}` : null;
}
