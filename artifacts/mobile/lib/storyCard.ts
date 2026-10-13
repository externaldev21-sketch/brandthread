/**
 * Pure helpers for the "Add to story" profile card (components/share-cards).
 * Dev rule for the card: plain type on black plus ONE real photo — the
 * person's avatar, or for a seller their first real product photo (falling
 * back to the store logo). No photo means plain type only. No glow, no
 * gradients, no stats.
 */
import type { CardThumbnail } from '@/lib/shareCard';

/** A real, loadable image URI, or null for empty/placeholder values. */
export function realPhotoUri(uri: string | null | undefined): string | null {
  if (!uri || typeof uri !== 'string') return null;
  const trimmed = uri.trim();
  return /^(https?:|file:|data:image\/|content:|ph:|assets-library:|blob:)/i.test(trimmed) ? trimmed : null;
}

/** Buyer card photo: their avatar when it's a real image. */
export function buyerStoryPhoto(avatarUri: string | null | undefined): string | null {
  return realPhotoUri(avatarUri);
}

/** Seller card photo: the first real product photo, else the store logo. */
export function sellerStoryPhoto(products: CardThumbnail[] | null | undefined, logoUri: string | null | undefined): string | null {
  for (const product of products ?? []) {
    const uri = realPhotoUri(product?.uri);
    if (uri) return uri;
  }
  return realPhotoUri(logoUri);
}

/** "@handle" from a raw username, or '' when there is none. */
export function storyHandle(username: string | null | undefined): string {
  const clean = (username ?? '').trim().replace(/^@+/, '');
  return clean ? `@${clean}` : '';
}

/** File name for the saved/shared PNG. */
export function storyCardFileName(username: string | null | undefined): string {
  const clean = (username ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  return `${clean || 'brandthread'}-story.png`;
}
