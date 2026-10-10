/**
 * Buyer-side product share link: the canonical product URL
 * (shareLinks.buildProductUrl) with the sharer's referral code appended as
 * `?ref=CODE` when a signed-in buyer has one.
 *
 * Pure module: no react-native imports, safe to unit test.
 */
import { buildProductUrl } from './shareLinks';

/** Same normalisation as referralCopy.referralInviteePath: A–Z/0–9, max 12. */
export function normalizeReferralCode(code: string | null | undefined): string | null {
  const clean = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return clean.length >= 4 ? clean : null;
}

export function buildProductShareLink(productId: string | null | undefined, referralCode?: string | null): string | null {
  const url = buildProductUrl(productId);
  if (!url) return null;
  const ref = normalizeReferralCode(referralCode);
  return ref ? `${url}?ref=${ref}` : url;
}

export function productShareMessage(productName: string | null | undefined): string {
  const name = String(productName ?? '').trim();
  return name ? `${name} on Brandthread` : 'This on Brandthread';
}
