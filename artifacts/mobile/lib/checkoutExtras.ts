/**
 * Seller Checkout settings → "Post-purchase features" and "Additional
 * scripts", and the buyer's post-purchase offer. Types for the API
 * (api-server routes/checkout-extras.ts) and the pure helpers the screens
 * use; everything is enforced again on the server.
 */

// ─── Post-purchase offer (seller) ────────────────────────────────────────────

export const MAX_OFFER_DISCOUNT_PERCENT = 50;
export const OFFER_DISCOUNT_STEPS = [0, 5, 10, 15, 20, 25, 30, 40, 50] as const;

export interface PostPurchaseOfferSettings {
  enabled: boolean;
  productId: string | null;
  discountPercent: number;
}

export interface PostPurchaseOfferResponse {
  offer: PostPurchaseOfferSettings;
  product: {
    id: string;
    name: string;
    image: string | null;
    inStock: boolean;
    priceCents: number;
    offerPriceCents: number;
  } | null;
}

export const DEFAULT_POST_PURCHASE_OFFER: PostPurchaseOfferSettings = { enabled: false, productId: null, discountPercent: 0 };

/** The next discount step (the screen's discount row cycles 0% → 5% → … → 50% → 0%). */
export function nextDiscountStep(current: number): number {
  const index = OFFER_DISCOUNT_STEPS.findIndex(step => step === current);
  return OFFER_DISCOUNT_STEPS[(index + 1) % OFFER_DISCOUNT_STEPS.length];
}

/** Same rounding as the server (half-up to the cent). */
export function offerPriceCents(priceCents: number, discountPercent: number): number {
  const pct = Math.min(MAX_OFFER_DISCOUNT_PERCENT, Math.max(0, Math.round(discountPercent)));
  return Math.max(0, priceCents - Math.floor((priceCents * pct + 50) / 100));
}

export type OfferProductOption = { id: string; name: string; image: string | null; priceCents: number; inStock: boolean };

/**
 * The seller's products that can be offered: active and in stock. Reads the
 * API's products (GET /api/products: images, variants[].priceCents/stock)
 * and the app's local product store (services/productService.ts: media,
 * pricing, inventory — the signed-out seller preview, which never calls the API).
 */
export function offerableProducts(raw: unknown): OfferProductOption[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { products?: unknown })?.products) ? (raw as { products: unknown[] }).products : [];
  const result: OfferProductOption[] = [];
  for (const item of list as Array<Record<string, any>>) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    if (item.deletedAt || (item.status && item.status !== 'active')) continue;
    const variants: Array<Record<string, any>> = Array.isArray(item.variants) ? item.variants : [];
    const basePrice = Number(item.pricing?.priceCents ?? item.priceCents);
    const prices = variants.map(v => Number(v.priceCents ?? basePrice)).filter(Number.isFinite);
    const variantStock = variants.reduce((sum, v) => {
      const n = Number(v.stock ?? v.inventoryQuantity);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    const stock = item.inventory && Number.isFinite(Number(item.inventory.availableStock))
      ? Number(item.inventory.availableStock)
      : variants.length > 0 ? variantStock : Number(item.stock ?? 0);
    const image = Array.isArray(item.images) && typeof item.images[0] === 'string'
      ? item.images[0]
      : Array.isArray(item.media) && typeof item.media[0]?.uri === 'string' ? item.media[0].uri : null;
    result.push({
      id: item.id,
      name: item.name,
      image,
      priceCents: prices.length ? Math.min(...prices) : Number.isFinite(basePrice) ? basePrice : 0,
      inStock: stock > 0,
    });
  }
  return result.filter(product => product.inStock);
}

// ─── Post-purchase offer (buyer) ─────────────────────────────────────────────

export type BuyerOffer =
  | { available: false; reason: string; acceptedOrderId?: string | null }
  | {
      available: true;
      orderId: string;
      sellerId: string;
      sellerName: string;
      product: { id: string; name: string; image: string | null };
      discountPercent: number;
      variants: Array<{ variantId: string; label: string; priceCents: number; offerPriceCents: number; inStock: boolean }>;
      card: { brand: string | null; last4: string | null };
      expiresAt: string;
    };

export type AcceptOfferResult = {
  paymentIntentId: string;
  status: string;
  clientSecret: string | null;
  paymentMethodId: string;
  amountCents: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
};

/** Which order on the confirmation gets the offer: the first verified one (single-seller checkout). */
export function offerOrderId(orders: Array<{ id: string }>, sellerCount: number): string | null {
  if (sellerCount !== 1) return null;
  return orders[0]?.id ?? null;
}

// ─── Conversion tracking ("Additional scripts") ─────────────────────────────

export type ConversionProvider = 'meta' | 'tiktok' | 'ga4';

export interface ConversionTrackingView {
  metaPixelId: string | null;
  metaAccessTokenMasked: string | null;
  tiktokPixelId: string | null;
  tiktokAccessTokenMasked: string | null;
  ga4MeasurementId: string | null;
  ga4ApiSecretMasked: string | null;
  activeProviders: ConversionProvider[];
}

export const EMPTY_TRACKING: ConversionTrackingView = {
  metaPixelId: null, metaAccessTokenMasked: null,
  tiktokPixelId: null, tiktokAccessTokenMasked: null,
  ga4MeasurementId: null, ga4ApiSecretMasked: null,
  activeProviders: [],
};

export type TrackingField = 'metaPixelId' | 'metaAccessToken' | 'tiktokPixelId' | 'tiktokAccessToken' | 'ga4MeasurementId' | 'ga4ApiSecret';

/** The same formats the server enforces (api-server lib/conversionTracking.ts). */
const FORMATS: Record<TrackingField, { re: RegExp; normalize: (v: string) => string; message: string }> = {
  metaPixelId: { re: /^\d{10,20}$/, normalize: v => v.replace(/\s+/g, ''), message: 'A Meta Pixel ID is 10–20 digits' },
  metaAccessToken: { re: /^EA[A-Za-z0-9]{30,500}$/, normalize: v => v.trim(), message: 'A Conversions API token starts with EA' },
  tiktokPixelId: { re: /^[A-Z0-9]{16,24}$/, normalize: v => v.trim().toUpperCase(), message: 'A TikTok Pixel ID is 16–24 letters and digits' },
  tiktokAccessToken: { re: /^[A-Za-z0-9]{32,128}$/, normalize: v => v.trim(), message: 'Paste the Events API access token from TikTok Events Manager' },
  ga4MeasurementId: { re: /^G-[A-Z0-9]{4,16}$/, normalize: v => v.trim().toUpperCase(), message: 'A Measurement ID looks like G-XXXXXXX' },
  ga4ApiSecret: { re: /^[A-Za-z0-9_-]{16,64}$/, normalize: v => v.trim(), message: 'Paste the Measurement Protocol API secret' },
};

export function normalizeTrackingValue(field: TrackingField, value: string): string {
  return FORMATS[field].normalize(value);
}

/** Error text for a typed value ('' is fine: it means "leave as is" for a secret / "clear" for an ID). */
export function trackingFieldError(field: TrackingField, value: string): string | null {
  const normalized = FORMATS[field].normalize(value);
  if (!normalized) return null;
  return FORMATS[field].re.test(normalized) ? null : FORMATS[field].message;
}

/**
 * The PUT body for one provider's form. IDs are always sent (empty = clear);
 * a secret is sent only when the seller typed a new one, or cleared with the
 * whole provider (`clear`), so a masked secret is never overwritten.
 */
export function trackingPatchFor(
  provider: ConversionProvider,
  draft: { id: string; secret: string },
  clear = false,
): Partial<Record<TrackingField, string | null>> {
  const idField: TrackingField = provider === 'meta' ? 'metaPixelId' : provider === 'tiktok' ? 'tiktokPixelId' : 'ga4MeasurementId';
  const secretField: TrackingField = provider === 'meta' ? 'metaAccessToken' : provider === 'tiktok' ? 'tiktokAccessToken' : 'ga4ApiSecret';
  if (clear) return { [idField]: null, [secretField]: null };
  const id = normalizeTrackingValue(idField, draft.id);
  const secret = normalizeTrackingValue(secretField, draft.secret);
  return { [idField]: id || null, ...(secret ? { [secretField]: secret } : {}) };
}

export const PROVIDER_LABELS: Record<ConversionProvider, { name: string; idLabel: string; secretLabel: string; idPlaceholder: string }> = {
  meta: { name: 'Meta Pixel', idLabel: 'Pixel ID', secretLabel: 'Conversions API access token', idPlaceholder: '123456789012345' },
  tiktok: { name: 'TikTok Pixel', idLabel: 'Pixel ID', secretLabel: 'Events API access token', idPlaceholder: 'C1A2B3C4D5E6F7G8H9I0' },
  ga4: { name: 'Google Analytics 4', idLabel: 'Measurement ID', secretLabel: 'Measurement Protocol API secret', idPlaceholder: 'G-XXXXXXXXXX' },
};

/** "Meta Pixel, Google Analytics 4" — the row summary on the settings screen. */
export function trackingSummary(view: ConversionTrackingView): string {
  if (view.activeProviders.length === 0) return 'Not connected';
  return view.activeProviders.map(provider => PROVIDER_LABELS[provider].name).join(', ');
}
