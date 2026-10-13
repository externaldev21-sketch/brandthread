/**
 * Wholesale price list: shared types and the small pure helpers the screens
 * use. The server (api-server lib/pricing/wholesale.ts) owns every pricing
 * rule; nothing here decides what a buyer is charged.
 */
import { formatCents } from '@/lib/money';

export type WholesaleSettings = { enabled: boolean; minOrderCents: number; defaultPercentOff: number };

export type WholesalePrice = {
  id: string;
  productId: string;
  /** null = every variant of the product. */
  variantId: string | null;
  /** null = default % off. */
  priceCents: number | null;
  minQuantity: number;
};

export type WholesaleProduct = {
  id: string;
  name: string;
  image: string | null;
  variants: Array<{ id: string; label: string; priceCents: number }>;
};

export type WholesaleBuyerStatus = 'pending' | 'approved' | 'declined';

export type WholesaleBuyerRequest = {
  id: string;
  buyerId: string;
  status: WholesaleBuyerStatus;
  businessName: string;
  createdAt: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export type WholesaleSellerOverview = {
  settings: WholesaleSettings;
  prices: WholesalePrice[];
  products: WholesaleProduct[];
  buyers: WholesaleBuyerRequest[];
};

export type WholesaleStoreInfo = { enabled: boolean; minOrderCents: number };

export type WholesalePriceListItem = Omit<WholesaleProduct, 'variants'> & {
  variants: Array<WholesaleProduct['variants'][number] & { wholesaleCents: number | null; minQuantity: number }>;
};

export type WholesaleMyStatus = {
  enabled: boolean;
  status: 'none' | WholesaleBuyerStatus;
  businessName: string | null;
  minOrderCents: number;
  priceList: WholesalePriceListItem[];
};

export const MAX_PERCENT_OFF = 90;
export const PERCENT_STEP = 5;

/** "120", "120.50", "$1,200" -> cents. Zero is allowed (no minimum). Null when not a price. */
export function priceTextToCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

/** Cents -> the text a price field starts with ("" for null, "12.50", "120"). */
export function centsToPriceText(cents: number | null | undefined): string {
  if (cents == null) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_PERCENT_OFF, Math.round(value)));
}

/** Product rule (variantId null) for a product, if any. */
export function productRule(prices: readonly WholesalePrice[], productId: string): WholesalePrice | undefined {
  return prices.find(p => p.productId === productId && p.variantId === null);
}

/** The price a product's first variant gets at wholesale, mirroring the server rule. Null = no wholesale price. */
export function previewWholesaleCents(
  settings: Pick<WholesaleSettings, 'defaultPercentOff'>,
  rule: Pick<WholesalePrice, 'priceCents'> | undefined,
  retailCents: number,
): number | null {
  if (rule?.priceCents != null) return rule.priceCents;
  const pct = clampPercent(settings.defaultPercentOff);
  return pct > 0 ? Math.round((retailCents * (100 - pct)) / 100) : null;
}

/** Second line of a product row on the seller's price list ("$30.00 · Min. 6 · Fixed price"). */
export function productRowDetail(settings: WholesaleSettings, prices: readonly WholesalePrice[], product: WholesaleProduct): string {
  const retail = product.variants[0]?.priceCents ?? 0;
  const rule = productRule(prices, product.id);
  const wholesale = previewWholesaleCents(settings, rule, retail);
  const parts = [wholesale == null ? 'Retail price' : formatCents(wholesale)];
  if ((rule?.minQuantity ?? 1) > 1) parts.push(`Min. ${rule!.minQuantity}`);
  parts.push(rule?.priceCents != null ? 'Fixed price' : wholesale == null ? 'No discount' : `${clampPercent(settings.defaultPercentOff)}% off`);
  return parts.join(' · ');
}

/** "3 products · 1 fixed price" for the Products row. */
export function productsSummary(products: readonly WholesaleProduct[], prices: readonly WholesalePrice[]): string {
  const fixed = new Set(prices.filter(p => p.priceCents != null).map(p => p.productId)).size;
  const count = `${products.length} ${products.length === 1 ? 'product' : 'products'}`;
  if (fixed === 0) return `${count} · No fixed prices`;
  return `${count} · ${fixed} fixed ${fixed === 1 ? 'price' : 'prices'}`;
}

export function pendingRequests(buyers: readonly WholesaleBuyerRequest[]): WholesaleBuyerRequest[] {
  return buyers.filter(b => b.status === 'pending');
}
