/**
 * Sold-out state for the feed's product tag chip (less-AI pass, V10).
 *
 * The feed's tagged products carry no stock data, so the chip asks the same
 * public, no-auth endpoint the product page's StockCounter already uses
 * (`GET /api/catalog-public/products/:id/stock-info` → `{ soldOut, … }`).
 * One request per product per session; failures (404 for unpublished or
 * preview products, offline) resolve to `null` = unknown, and the chip keeps
 * showing the price.
 */
import { formatCents } from '@/lib/money';

/** What the chip shows in the price slot. */
export function tagPriceLabel(priceCents: number, soldOut: boolean): string {
  return soldOut ? 'Sold out' : formatCents(priceCents);
}

export type StockInfoFetcher = (productId: string) => Promise<unknown>;

/** Cached, de-duplicated `productId → soldOut | null` lookup. */
export function createSoldOutLookup(fetchStockInfo: StockInfoFetcher) {
  const cache = new Map<string, Promise<boolean | null>>();
  return {
    peek(productId: string): Promise<boolean | null> | undefined {
      return cache.get(productId);
    },
    get(productId: string): Promise<boolean | null> {
      let pending = cache.get(productId);
      if (!pending) {
        pending = fetchStockInfo(productId)
          .then((data) => (
            data && typeof (data as { soldOut?: unknown }).soldOut === 'boolean'
              ? (data as { soldOut: boolean }).soldOut
              : null
          ))
          .catch(() => null);
        cache.set(productId, pending);
      }
      return pending;
    },
  };
}
