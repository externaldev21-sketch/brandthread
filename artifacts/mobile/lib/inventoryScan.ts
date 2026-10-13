/**
 * Types + pure helpers for the inventory scanner (app/inventory-scan.tsx) and
 * the low stock alerts screen (app/low-stock-alerts.tsx). Server side:
 * api-server routes/inventory.ts (GET /lookup, GET/PUT /settings).
 */

export type StockStatus = 'out_of_stock' | 'low_stock' | 'in_stock';

export interface InventoryMatch {
  variantId: string;
  productId: string;
  productName: string;
  productStatus: string;
  variantLabel: string;
  size: string | null;
  color: string | null;
  sku: string;
  barcode: string | null;
  stock: number;
  lowStockThreshold: number;
  priceCents: number;
  imageUrl: string | null;
  status: StockStatus;
  matchedOn: 'barcode' | 'sku';
}

export interface InventoryLookupResult {
  code: string;
  matches: InventoryMatch[];
}

export interface LowStockItem {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  variantLabel: string;
  stock: number;
  lowStockThreshold: number;
  imageUrl: string | null;
  status: StockStatus;
}

export interface InventorySettings {
  lowStockThresholdDefault: number;
  isCustom: boolean;
  platformDefault: number;
  lowStock: LowStockItem[];
  hasMore: boolean;
}

/** One scanned variant waiting to be applied: the stock it had and how much the seller changed it. */
export interface PendingScan {
  match: InventoryMatch;
  delta: number;
}

/**
 * Adds a scan to the pending list. Scanning an item again counts one more
 * unit (Shopify's inventory scanner: each scan is +1); the item moves to the
 * top as the last scanned item.
 */
export function addScan(list: PendingScan[], match: InventoryMatch): PendingScan[] {
  const existing = list.find((p) => p.match.variantId === match.variantId);
  const rest = list.filter((p) => p.match.variantId !== match.variantId);
  return [{ match: existing?.match ?? match, delta: (existing?.delta ?? 0) + 1 }, ...rest];
}

/** Sets the new on-hand quantity for a pending item (never below 0). */
export function setScanQuantity(list: PendingScan[], variantId: string, quantity: number): PendingScan[] {
  return list.map((p) => (p.match.variantId === variantId
    ? { ...p, delta: Math.max(0, Math.floor(quantity)) - p.match.stock }
    : p));
}

export function removeScan(list: PendingScan[], variantId: string): PendingScan[] {
  return list.filter((p) => p.match.variantId !== variantId);
}

/** Scans that actually change stock, ready for PATCH /api/inventory/:id/adjust. */
export function changesToApply(list: PendingScan[]): Array<{ variantId: string; delta: number }> {
  return list.filter((p) => p.delta !== 0).map((p) => ({ variantId: p.match.variantId, delta: p.delta }));
}

/** "Original: 100 (+1)" — the Shopify scanner's change line. */
export function originalLine(p: PendingScan): string {
  const sign = p.delta > 0 ? '+' : p.delta < 0 ? '−' : '±';
  return `Original: ${p.match.stock} (${sign}${Math.abs(p.delta)})`;
}

/** Second line under the product name: the option values, or the SKU when there are none. */
export function matchSubtitle(m: { variantLabel: string; sku: string }): string {
  return m.variantLabel || m.sku;
}

/**
 * Codes the camera reports for the same item more than once per second are
 * the same scan; only a new code (or the same code after a pause) counts.
 */
export function isRepeatScan(last: { code: string; at: number } | null, code: string, now: number, windowMs = 1500): boolean {
  return !!last && last.code === code && now - last.at < windowMs;
}
