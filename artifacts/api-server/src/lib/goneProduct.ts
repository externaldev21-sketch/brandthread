/**
 * "This drop is gone" (S5 #118). A product link that no longer resolves
 * (archived, deleted, sold through and unpublished) still 404s, but when we
 * know whose drop it was, the 404 names that brand so the app can send the
 * buyer to the brand instead of a dead end.
 *
 * Only public facts go out: the seller's id and display/brand name, which
 * their profile already shows. Nothing about the product itself.
 */
export interface GoneProductBrand {
  sellerId: string;
  sellerName: string;
}

export interface GoneProductOwner {
  clerkId: string;
  brandName: string | null;
  displayName: string | null;
  deletedAt: Date | null;
}

export function goneProductBody(owner: GoneProductOwner | null | undefined): {
  error: string;
  gone?: GoneProductBrand;
} {
  // The legacy string `error` stays as-is for every existing reader.
  const body: { error: string; gone?: GoneProductBrand } = { error: "Product not found" };
  if (!owner || owner.deletedAt) return body;
  const sellerName = owner.brandName?.trim() || owner.displayName?.trim();
  if (!sellerName) return body;
  body.gone = { sellerId: owner.clerkId, sellerName };
  return body;
}
