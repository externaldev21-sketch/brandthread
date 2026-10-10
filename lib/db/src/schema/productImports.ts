import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { products } from './index';

// ─── Product imports (CSV + Etsy) ────────────────────────────────────────────
// Side tables only; migration 125. Idempotency for re-imports lives in
// product_import_mappings keyed (owner, source, external_key).

export const productImportMappings = pgTable('product_import_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull(),
  source: text('source').notNull(), // shopify_csv | etsy_csv | generic_csv | etsy_api
  externalKey: text('external_key').notNull(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  contentHash: text('content_hash').notNull().default(''),
  lastRunId: uuid('last_run_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastImportedAt: timestamp('last_imported_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerSourceKeyUq: uniqueIndex('product_import_mappings_owner_source_key_uq').on(table.ownerId, table.source, table.externalKey),
  productIdx: index('product_import_mappings_product_idx').on(table.productId),
}));

export const productImportRuns = pgTable('product_import_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull(),
  source: text('source').notNull(),
  filename: text('filename'),
  createdCount: integer('created_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  unchangedCount: integer('unchanged_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index('product_import_runs_owner_idx').on(table.ownerId, table.createdAt),
}));

export const etsyConnections = pgTable('etsy_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().unique(),
  etsyUserId: text('etsy_user_id').notNull(),
  shopId: text('shop_id'),
  shopName: text('shop_name'),
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  scopes: text('scopes').notNull().default(''),
  status: text('status').notNull().default('connected'),
  lastError: text('last_error'),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const etsyOauthStates = pgTable('etsy_oauth_states', {
  state: text('state').primaryKey(),
  ownerId: text('owner_id').notNull(),
  codeVerifierEncrypted: text('code_verifier_encrypted').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
