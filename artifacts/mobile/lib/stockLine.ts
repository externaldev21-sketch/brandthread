/**
 * Pure stock-line rules for the product page (lib/stockInfo.ts fetches).
 */
export interface StockInfo {
  soldOut: boolean;
  limited: boolean;
  editionSize: number | null;
  remaining: number | null;
  /** The seller's "Only N left" threshold when they opted into the counter. */
  counterThreshold?: number | null;
}

/** Threshold for the size line when the seller hasn't set one (the page's long-standing rule). */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** The pill text <StockCounter> shows, or null when it shows nothing. */
export function stockCounterText(info: StockInfo): string | null {
  if (info.soldOut) return info.limited ? 'Limited edition · Sold out' : 'Sold out';
  if (info.limited && info.remaining !== null && info.editionSize) {
    return `Limited edition · ${info.remaining} of ${info.editionSize} left`;
  }
  if (info.limited) return 'Limited edition';
  if (info.remaining !== null) return info.remaining === 1 ? 'Only 1 left' : `Only ${info.remaining} left`;
  return null;
}

/**
 * The selected size's stock line: 'low' ("Only N left in stock") at or under
 * the seller's threshold (else 5), 'in' / 'out' otherwise, and 'hidden' when
 * <StockCounter> already states the stock so the page doesn't say it twice.
 * An out-of-stock size still shows while the product as a whole has stock,
 * since "select another option" is a different fact.
 */
export function variantStockLine(
  variant: { isAvailable: boolean; inventoryQuantity: number },
  info: StockInfo | null,
): { kind: 'low' | 'in' | 'out' | 'hidden'; text: string } {
  const counterShown = info ? stockCounterText(info) !== null : false;
  if (counterShown && (variant.isAvailable || info?.soldOut)) return { kind: 'hidden', text: '' };
  if (!variant.isAvailable) return { kind: 'out', text: 'Out of stock — select another option' };
  const threshold = info?.counterThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  if (variant.inventoryQuantity <= threshold) return { kind: 'low', text: `Only ${variant.inventoryQuantity} left in stock` };
  return { kind: 'in', text: 'In stock' };
}
