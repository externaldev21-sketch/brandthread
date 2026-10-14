/**
 * Store page layout (users.store_layout): 'grid' is the regular store page,
 * 'lookbook' a full-screen editorial swipe through the seller's products.
 * Pure so the switch is unit-testable.
 */
export type StoreLayout = 'grid' | 'lookbook';

export function parseStoreLayout(value: unknown): StoreLayout {
  return value === 'lookbook' ? 'lookbook' : 'grid';
}

/**
 * Which layout this viewer sees.
 *  - Owners always get the regular page (it carries edit, dashboard, etc.).
 *  - The owner's "Preview lookbook" (`asVisitor=1&lookbook=1`) forces it on.
 *  - Visitors get the seller's saved layout, unless they switched to the
 *    full store page from inside the lookbook.
 */
export function resolveStoreLayout(input: {
  saved: unknown;
  isOwner: boolean;
  previewLookbook?: boolean;
  visitorChoseGrid?: boolean;
}): StoreLayout {
  if (input.isOwner) return 'grid';
  if (input.visitorChoseGrid) return 'grid';
  if (input.previewLookbook) return 'lookbook';
  return parseStoreLayout(input.saved);
}

/** The owner's preview route: their own store page as a visitor, in lookbook. */
export function lookbookPreviewHref(ownerId: string): string {
  return `/seller-profile?id=${encodeURIComponent(ownerId)}&asVisitor=1&lookbook=1`;
}
