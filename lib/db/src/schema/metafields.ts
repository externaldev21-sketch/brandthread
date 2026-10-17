import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

// Seller-defined custom field definitions per store resource (products,
// collections, customers, ...). Table created by migration 285; queried with
// raw SQL in routes/seller-metafields.ts.
export const metafieldDefinitions = pgTable('metafield_definitions', {
  id:            uuid('id').primaryKey().defaultRandom(),
  ownerId:       text('owner_id').notNull(),
  ownerResource: text('owner_resource').notNull(),
  namespace:     text('namespace').notNull().default('custom'),
  key:           text('key').notNull(),
  name:          text('name').notNull(),
  type:          text('type').notNull().default('single_line_text_field'),
  description:   text('description'),
  pinned:        boolean('pinned').notNull().default(false),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerKeyUq: uniqueIndex('metafield_definitions_owner_key_uq').on(table.ownerId, table.ownerResource, table.namespace, table.key),
  ownerIdx:   index('metafield_definitions_owner_idx').on(table.ownerId, table.ownerResource),
}));
