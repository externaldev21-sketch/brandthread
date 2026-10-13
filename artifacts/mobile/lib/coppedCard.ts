/**
 * Data for the "Just copped" story card a buyer can share right after
 * checkout (components/share-cards/CoppedShareCard.tsx). Pure, so the
 * choice of which item to feature is tested without native modules.
 *
 * No price and no order details go on the card: it's a brag, not a receipt.
 */
import { buildProductUrl } from '@/lib/shareLinks';

export interface CoppedSourceItem {
  productId: string;
  productName: string;
  imageUri?: string;
  sellerName: string;
  sellerHandle: string;
}

export interface CoppedCardData {
  productId: string;
  productName: string;
  brandName: string;
  brandHandle: string;
  imageUri: string | null;
  /** Other distinct products in the same order ("+2 more"). */
  moreCount: number;
  /** Product page link for the QR code and Copy link; null when not shareable. */
  url: string | null;
}

export function coppedCardData(items: readonly CoppedSourceItem[]): CoppedCardData | null {
  const distinct = [...new Map(items.map((item) => [item.productId, item])).values()];
  if (distinct.length === 0) return null;
  const featured = distinct.find((item) => !!item.imageUri) ?? distinct[0]!;
  const handle = featured.sellerHandle.replace(/^@/, '');
  return {
    productId: featured.productId,
    productName: featured.productName,
    brandName: featured.sellerName,
    brandHandle: handle ? `@${handle}` : '',
    imageUri: featured.imageUri ?? null,
    moreCount: distinct.length - 1,
    url: buildProductUrl(featured.productId),
  };
}
