import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { products } from './index';

// "Complete the fit": seller-curated related products shown on a product page.
export const productPairings = pgTable('product_pairings', {
  id:              uuid('id').primaryKey().defaultRandom(),
  productId:       uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  pairedProductId: uuid('paired_product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  position:        integer('position').notNull().default(0),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pairUnique:  uniqueIndex('product_pairings_pair_unique').on(table.productId, table.pairedProductId),
  positionIdx: index('product_pairings_product_position_idx').on(table.productId, table.position),
  noSelf:      check('product_pairings_no_self', sql`${table.productId} <> ${table.pairedProductId}`),
}));

// One video per product (PK = product id).
export const productVideos = pgTable('product_videos', {
  productId:  uuid('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  videoUrl:   text('video_url').notNull(),
  posterUrl:  text('poster_url'),
  durationMs: integer('duration_ms'),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
