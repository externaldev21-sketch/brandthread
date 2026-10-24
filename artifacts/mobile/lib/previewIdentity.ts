/**
 * The ONE seller identity the dev web preview (`?bt_preview=seller`) shows.
 *
 * Preview has no real account, so every screen that prints "who am I" used to
 * invent its own fallback ("My Brand" on Profile, "Your Brandthread store" in
 * Settings, "Preview Studio" in Edit profile). They all read this instead, so
 * the name, handle and initials agree everywhere. The name matches the person
 * the screenshot harness signs in as (Maya Okafor), so the Profile header and
 * More's account card print the same name.
 */
import { isSellerDevPreview } from './devPreview';

export const PREVIEW_SELLER_IDENTITY = {
  brandName: 'Maya Okafor',
  firstName: 'Maya',
  lastName: 'Okafor',
  username: 'mayaokafor',
  handle: '@mayaokafor',
  bio: 'Handmade goods, made to order.',
} as const;

/** The preview seller's brand name, or `null` outside the seller preview (real accounts never see it). */
export function previewSellerBrandName(): string | null {
  return isSellerDevPreview() ? PREVIEW_SELLER_IDENTITY.brandName : null;
}

/** The preview seller's first/last name, or `null` outside the seller preview. */
export function previewSellerPersonName(): { firstName: string; lastName: string } | null {
  return isSellerDevPreview()
    ? { firstName: PREVIEW_SELLER_IDENTITY.firstName, lastName: PREVIEW_SELLER_IDENTITY.lastName }
    : null;
}
