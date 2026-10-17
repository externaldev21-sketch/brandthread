/**
 * Where a shared product link (https://brandthread.app/store/product/{id})
 * opens. Everyone gets the public buyer page (guest-allowed, backed by the
 * no-auth GET /api/public/products/:id); only the product's own seller gets
 * the management screen.
 *
 * Pure module: no react-native / expo-router imports, safe to unit test.
 */
import { productDetailHref } from '@/lib/profileNavigation';

export interface SharedProductLookups {
  /** Signed-in viewer's Clerk user id, or null for a signed-out visitor. */
  viewerId: string | null | undefined;
  /** Public product lookup (no auth). Resolves the row (with ownerId) or rejects. */
  getPublicProduct: (id: string) => Promise<{ ownerId?: string | null } | null | undefined>;
  /** Owner-scoped lookup (GET /api/products/:id); resolves only for the owner's own product. */
  getOwnProduct?: (id: string) => Promise<unknown>;
}

export async function resolveSharedProductHref(productId: string, lookups: SharedProductLookups): Promise<string> {
  const buyerHref = productDetailHref(productId, {});
  const viewerId = lookups.viewerId;
  if (!viewerId) return buyerHref;

  try {
    const row = await lookups.getPublicProduct(productId);
    if (row && row.ownerId) {
      return row.ownerId === viewerId ? productDetailHref(productId, { isOwner: true }) : buyerHref;
    }
  } catch {
    // Not publicly visible (e.g. the seller's own draft) or unreachable — fall
    // through to the owner check below.
  }

  if (lookups.getOwnProduct) {
    try {
      const own = await lookups.getOwnProduct(productId);
      if (own) return productDetailHref(productId, { isOwner: true });
    } catch {
      // Not the viewer's product.
    }
  }
  return buyerHref;
}
