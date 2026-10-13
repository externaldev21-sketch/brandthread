/**
 * Digital Closet (buyer profile → Closet tab).
 *
 * Pieces are derived from delivered order items at read time, so nothing is
 * copied here; `closet_outfits` only stores the buyer's saved boards as an
 * ordered list of `order_items.id`.
 */
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const closetOutfits = pgTable('closet_outfits', {
  id:        uuid('id').primaryKey().defaultRandom(),
  buyerId:   text('buyer_id').notNull(),
  pieceIds:  jsonb('piece_ids').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  buyerIdx: index('closet_outfits_buyer_idx').on(t.buyerId, t.createdAt),
}));
