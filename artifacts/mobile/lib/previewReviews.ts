/**
 * Review numbers for the seller dev web preview with `&demo=1` ONLY
 * (`?bt_preview=seller&demo=1`). The seller preview has no API (see
 * rejectSellerPreviewApiRequest in lib/api.ts), so without these the review
 * surfaces could never be design-reviewed populated. Fresh preview and real
 * accounts never see them: they always use /api/reviews.
 */
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';

export function previewReviewsEnabled(): boolean {
  return isSellerDevPreview() && isPreviewDemoMode();
}

export const PREVIEW_PRODUCT_REVIEW_SUMMARY = { avgRating: 4.8, totalCount: 23 };

/** Seller rollup over all reviews; the list below is only the latest few. */
export const PREVIEW_SELLER_REVIEW_SUMMARY = { avgRating: 4.7, totalCount: 38 };

const DAY_MS = 86_400_000;

export function previewSellerReviews(now = Date.now()) {
  const at = (days: number) => new Date(now - days * DAY_MS).toISOString();
  const row = (id: string, rating: number, body: string, days: number, buyer: string, reply?: string) => ({
    id, buyer_id: `preview_${id}`, seller_id: 'preview_seller', rating, body, created_at: at(days),
    product_name: 'Heavyweight Hoodie — Ember', buyer_display_name: buyer,
    ...(reply ? { seller_reply: reply, seller_replied_at: at(days - 1) } : {}),
  });
  return [
    row('pr1', 5, 'Heaviest hoodie I own and it still drapes. Sized true.', 3, 'Jordan R.', 'Thank you Jordan, glad it fits!'),
    row('pr2', 5, 'The ember colour is even better in person.', 6, 'Priya K.'),
    row('pr3', 4, 'Great fit, sleeves run slightly long.', 12, 'Sam T.'),
    row('pr4', 4, 'Took a few days to ship but worth the wait.', 20, 'Morgan L.'),
  ];
}
