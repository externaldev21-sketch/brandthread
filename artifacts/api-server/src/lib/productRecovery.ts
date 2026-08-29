/** Deliberately short server-controlled interval for undoing a deletion. */
export const PRODUCT_DELETE_RECOVERY_WINDOW_MS = 5 * 60 * 1000;

export type RecoverableProduct = {
  deletedAt: Date | null;
  recoverableUntil: Date | null;
  removalKind?: string | null;
};

/** A missing deadline is never recoverable: this also makes IP removals final. */
export function canRestoreProduct(product: RecoverableProduct, now = new Date()): boolean {
  return product.removalKind === "seller_deleted"
    && !!product.deletedAt
    && !!product.recoverableUntil
    && product.recoverableUntil.getTime() > now.getTime();
}