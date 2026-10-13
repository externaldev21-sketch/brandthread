/**
 * Product mentions in captions + post labels (migration 300_f6_mentions-bts).
 *
 * post_product_mentions: a seller links a readable label inside the caption
 * (usually the product's name) to one of their own active products. The caption
 * text keeps the label as plain text; readers resolve the label to the product.
 *
 * post_labels: short system labels shown above the caption. Today only 'bts'
 * ("Behind the scenes", sellers only).
 *
 * The migration adds FKs post_id -> posts(id) and product_id -> products(id)
 * (ON DELETE CASCADE); they are not repeated here to avoid a circular import
 * with schema/index.ts.
 */
import { index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const postProductMentions = pgTable('post_product_mentions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  postId:    uuid('post_id').notNull(),
  productId: uuid('product_id').notNull(),
  label:     text('label').notNull(),
  position:  integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  postIdx: index('ppm_post_id_idx').on(table.postId, table.position),
  productIdx: index('ppm_product_id_idx').on(table.productId),
  uniq: uniqueIndex('ppm_post_product_unique').on(table.postId, table.productId),
}));

export const POST_LABELS = ['bts'] as const;
export type PostLabel = (typeof POST_LABELS)[number];

export const postLabels = pgTable('post_labels', {
  postId:    uuid('post_id').notNull(),
  label:     text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.postId, table.label] }),
  labelIdx: index('post_labels_label_idx').on(table.label, table.createdAt),
}));
