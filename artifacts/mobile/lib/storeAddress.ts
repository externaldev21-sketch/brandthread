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
export function storeHostFrom(storeUrl: string | null | undefined, fallback = ''): string {
  const slug = storeSlugFrom(storeUrl) || fallback;
  return slug ? `${slug}${SUFFIX}` : '';
}

/** A link that opens the published store with no DNS setup needed
 *  (brandthread.app/s/<slug> → the API's public storefront page). */
export function storeViewUrl(storeUrl: string | null | undefined): string | null {
  const slug = storeSlugFrom(storeUrl);
  return slug ? `https://brandthread.app/s/${encodeURIComponent(slug)}` : null;
}

/**
 * The one public address of a seller's store, read the same way everywhere.
 * The Domains screen edits the Brandthread subdomain (domains[type=brandthread]);
 * older stores only have settings.storeUrl, which is either a bare slug or a
 * full "slug.brandthread.app" host. Returns null when nothing is set, so
 * screens never show a made-up placeholder address.
 */
import type { StoreDomain } from '@/services/storeTypes';

type StoreLike = {
  domains?: StoreDomain[];
  settings?: { storeUrl?: string | null };
};

const HOST_SUFFIX = '.brandthread.app';

function toHost(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!v) return null;
  return v.includes('.') ? v : `${v}${HOST_SUFFIX}`;
}

export function storeAddressHost(store: StoreLike | null | undefined): string | null {
  if (!store) return null;
  const primaryCustom = store.domains?.find((d) => d.type === 'custom' && d.isPrimary && d.verificationStatus === 'verified');
  if (primaryCustom?.customDomain) return toHost(primaryCustom.customDomain);
  const subdomain = store.domains?.find((d) => d.type === 'brandthread')?.subdomain;
  return toHost(subdomain) ?? toHost(store.settings?.storeUrl);
}

export function storeAddressUrl(store: StoreLike | null | undefined): string | null {
  const host = storeAddressHost(store);
  return host ? `https://${host}` : null;
}
