/**
 * Where a Meta ad sends people (BT-326): a product ad lands on that product's
 * page (https://brandthread.app/store/product/{id}, guest-browsable); store and
 * video ads land on the seller's store. Every link carries UTM tags so clicks
 * show up as paid Facebook/Instagram traffic in the seller's analytics.
 */
import { buildProductUrl } from './shareLinks';

export function adDestinationUrl(input: {
  promoteKind: string | null | undefined;
  promoteRefId: string | null | undefined;
  storeUrl: string | null | undefined;
  campaignId?: string | null;
}): string | null {
  const productUrl = input.promoteKind === 'product' ? buildProductUrl(input.promoteRefId) : null;
  const base = productUrl ?? input.storeUrl ?? null;
  if (!base) return null;
  let url: URL;
  try { url = new URL(base); } catch { return null; }
  url.searchParams.set('utm_source', 'facebook');
  url.searchParams.set('utm_medium', 'paid');
  url.searchParams.set('utm_campaign', input.campaignId || 'brandthread_ads');
  return url.toString();
}
