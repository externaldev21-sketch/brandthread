import { pgTable, uuid, text, integer, boolean, timestamp, json, unique, uniqueIndex, index } from 'drizzle-orm/pg-core';

// ─── Shopify connection bridge ──────────────────────────────────────────────
//
// One row per seller (ownerId). A connection starts with read-only catalog
// scopes (granted from the Products > "Import from Shopify" flow) and can
// later be upgraded, in place, to also carry order-write scopes (granted
// from Seller Settings > "Fulfill orders through my Shopify store"). The
// access token is Shopify's own credential — we never see the fulfillment
// app's (Tapstitch/Printful/Printify) credentials at all, since those apps
// only ever talk to the seller's Shopify store, not to Brandthread.

export const shopifyConnections = pgTable('shopify_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().unique(), // Clerk user ID of the brand owner
  shopDomain: text('shop_domain').notNull(), // "example.myshopify.com"
  // AES-256-GCM ciphertext of the Admin API access token, formatted as
  // "<iv-base64>.<authTag-base64>.<ciphertext-base64>" (see lib/shopifyCrypto.ts).
  // Never selected into an API response.
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  // How the token was obtained: 'oauth' (Brandthread Shopify app) or
  // 'custom_app' (merchant-generated Admin API access token, for testing
  // against the owner's own store before the public app is approved).
  connectionType: text('connection_type').notNull().default('oauth'),
  // Space-separated Shopify scope string actually granted by the shop, e.g.
  // "read_products,read_inventory" or the full fulfillment scope set.
  scopes: text('scopes').notNull().default(''),
  // Read-only product-transfer connections never forward orders. Only once a
  // seller explicitly opts in (and the connection carries the order-write
  // scopes) do paid orders get forwarded and fulfillment webhooks processed.
  fulfillmentEnabled: boolean('fulfillment_enabled').notNull().default(false),
  status: text('status').notNull().default('connected'), // 'connected' | 'disconnected' | 'error'
  lastError: text('last_error'),
  lastImportAt: timestamp('last_import_at', { withTimezone: true }),
  lastOrderSyncAt: timestamp('last_order_sync_at', { withTimezone: true }),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Short-lived signed state for the OAuth redirect round trip (CSRF + which seller/purpose initiated it). */
export const shopifyOauthStates = pgTable('shopify_oauth_states', {
  state: text('state').primaryKey(),
  ownerId: text('owner_id').notNull(),
  shopDomain: text('shop_domain').notNull(),
  purpose: text('purpose').notNull(), // 'import' | 'fulfillment'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// ─── Product transfer (A): links a Brandthread product/variant back to the
// Shopify product/variant it was imported from, so a re-import updates
// instead of duplicating. ───────────────────────────────────────────────────

export const shopifyProductLinks = pgTable('shopify_product_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull(),
  shopifyProductId: text('shopify_product_id').notNull(),
  brandthreadProductId: uuid('brandthread_product_id').notNull(),
  // variantId -> shopifyVariantId, e.g. {"<bt-variant-uuid>": "<shopify-variant-id>"}
  variantMap: json('variant_map').$type<Record<string, string>>().notNull().default({}),
  lastImportedAt: timestamp('last_imported_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerShopifyProductUnique: uniqueIndex('shopify_product_links_owner_product_unique').on(table.ownerId, table.shopifyProductId),
  brandthreadProductIdx: index('shopify_product_links_bt_product_idx').on(table.brandthreadProductId),
}));

// ─── Order forwarding (B): one Brandthread order maps to at most one
// Shopify order, safe on webhook/checkout retries. ──────────────────────────

export const shopifyOrderLinks = pgTable('shopify_order_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandthreadOrderId: uuid('brandthread_order_id').notNull().unique(),
  ownerId: text('owner_id').notNull(),
  shopifyOrderId: text('shopify_order_id'),
  shopifyOrderName: text('shopify_order_name'),
  // 'pending' (claimed, not yet sent) | 'sent' | 'failed'
  status: text('status').notNull().default('pending'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  shopifyOrderIdx: index('shopify_order_links_shopify_order_idx').on(table.shopifyOrderId),
}));

/** Idempotency ledger for inbound Shopify webhook deliveries (HMAC-verified). */
export const shopifyWebhookEvents = pgTable('shopify_webhook_events', {
  // "<shop-domain>:<X-Shopify-Webhook-Id>" — Shopify's own delivery id.
  id: text('id').primaryKey(),
  shopDomain: text('shop_domain').notNull(),
  topic: text('topic').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
