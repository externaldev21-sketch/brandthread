/**
 * Who may read a product through GET /api/public/products/:id.
 *
 * Buyers see active, non-deleted products only. The seller who owns a
 * product may also open it there while it is a draft / inactive — that is
 * the seller app's "Preview as buyer" — and the response is flagged
 * `previewOnly: true` so the buyer page shows it as a preview and does not
 * offer purchase (the product is not buyable until it is active).
 */
export type ProductReadAccess = "public" | "owner_preview" | "hidden";

export function productReadAccess(
  product: { status: string | null; ownerId: string; deletedAt?: Date | string | null } | null | undefined,
  viewerId: string | null | undefined,
): ProductReadAccess {
  if (!product || product.deletedAt) return "hidden";
  if (product.status === "active") return "public";
  if (viewerId && viewerId === product.ownerId) return "owner_preview";
  return "hidden";
}
