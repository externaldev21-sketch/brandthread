import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Seller Checkout settings → "Post-purchase features" (migration 121): one
 * offer shown on the buyer's order confirmation right after checkout.
 * Enforced and priced server-side: api-server lib/postPurchaseOffer.ts.
 */
export const sellerPostPurchaseOffers = pgTable("seller_post_purchase_offers", {
  sellerId: text("seller_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  productId: uuid("product_id"),
  /** 0–50; applied to the variant's price on the server. */
  discountPercent: integer("discount_percent").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Seller Checkout settings → "Additional scripts": the store's conversion
 * tracking (migration 121). Secrets are AES-256-GCM encrypted
 * (api-server lib/metaCrypto.ts) and never returned to a client in full.
 */
export const sellerConversionTracking = pgTable("seller_conversion_tracking", {
  sellerId: text("seller_id").primaryKey(),
  metaPixelId: text("meta_pixel_id"),
  metaAccessTokenEnc: text("meta_access_token_enc"),
  tiktokPixelId: text("tiktok_pixel_id"),
  tiktokAccessTokenEnc: text("tiktok_access_token_enc"),
  ga4MeasurementId: text("ga4_measurement_id"),
  ga4ApiSecretEnc: text("ga4_api_secret_enc"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** One Purchase event per order and provider (api-server lib/conversionTracking.ts). */
export const conversionEventDeliveries = pgTable("conversion_event_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  sellerId: text("seller_id").notNull(),
  /** 'meta' | 'tiktok' | 'ga4' */
  provider: text("provider").notNull(),
  /** 'pending' | 'sent' | 'failed' */
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  orderProviderUq: uniqueIndex("conversion_event_deliveries_order_provider_uq").on(t.orderId, t.provider),
  sellerIdx: index("conversion_event_deliveries_seller_idx").on(t.sellerId, t.createdAt),
}));
