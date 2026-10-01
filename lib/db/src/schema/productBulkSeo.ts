/**
 * Per-product search listing (SEO) and variant compare-at prices.
 *
 * Side tables keyed by product / variant so the `products` and
 * `product_variants` definitions stay untouched.
 */
import { pgTable, uuid, text, integer, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { products, productVariants } from './index';

export const productSeo = pgTable('product_seo', {
  productId: uuid('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  // Denormalised so the URL handle can be unique per seller.
  ownerId: text('owner_id').notNull(),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  urlHandle: text('url_handle'),
  noIndex: boolean('no_index').notNull().default(false),
  socialImageUrl: text('social_image_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  handleUnique: uniqueIndex('product_seo_owner_handle_unique')
    .on(table.ownerId, table.urlHandle)
    .where(sql`${table.urlHandle} is not null`),
  ownerIdx: index('product_seo_owner_idx').on(table.ownerId),
}));

/** "Was" price per variant, written by the bulk price editor. */
export const productVariantCompareAt = pgTable('product_variant_compare_at', {
  variantId: uuid('variant_id').primaryKey().references(() => productVariants.id, { onDelete: 'cascade' }),
  compareAtCents: integer('compare_at_cents').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
