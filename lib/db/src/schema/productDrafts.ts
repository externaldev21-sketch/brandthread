import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * In-progress Add Product wizard drafts, synced across a seller's devices.
 *
 * Deliberately a side table rather than `products.status = 'draft'`: a
 * half-filled wizard is not a product, and must never appear in product
 * lists, search, analytics or plan limits. `data` is the client's wizard
 * snapshot (opaque to the server beyond a size cap). `ownerId` is the store
 * owner (team context aware); `createdBy` is the actor that last saved it.
 * `updatedAt` is the client's own save timestamp, used for last-write-wins.
 */
export const productDrafts = pgTable('product_drafts', {
  id:            uuid('id').primaryKey().defaultRandom(),
  ownerId:       text('owner_id').notNull(),
  clientDraftId: text('client_draft_id').notNull(),
  data:          jsonb('data').$type<Record<string, unknown>>().notNull(),
  createdBy:     text('created_by'),
  updatedAt:     timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull(),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerClientUnique: uniqueIndex('product_drafts_owner_client_unique').on(table.ownerId, table.clientDraftId),
  ownerUpdatedIdx:   index('product_drafts_owner_updated_idx').on(table.ownerId, table.updatedAt),
}));
