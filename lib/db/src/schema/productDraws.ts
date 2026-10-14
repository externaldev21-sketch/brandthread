import { pgTable, uuid, text, boolean, integer, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { products } from './index';

/**
 * Draw mode for a product with a scheduled launch (migration 275). Entries
 * open at product_launches.launch_at and close at entryClosesAt; the server
 * then picks winners (api-server lib/productDraws.ts).
 */
export const productDraws = pgTable('product_draws', {
  productId: uuid('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  entryClosesAt: timestamp('entry_closes_at', { withTimezone: true }).notNull(),
  // open | drawing | drawn | cancelled
  status: text('status').notNull().default('open'),
  seed: text('seed').notNull(),
  seedHash: text('seed_hash').notNull(),
  drawnAt: timestamp('drawn_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  dueIdx: index('product_draws_due_idx').on(t.status, t.entryClosesAt),
}));

export type DrawPricedSnapshot = {
  sellerId: string;
  items: Array<{ variantId: string; productId: string; productName: string; variantLabel: string; quantity: number; priceCents: number }>;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  platformFeeCents: number;
  platformFeeBps: number;
  processingFeeEstimateCents: number;
  stripeTaxCalculationId: string | null;
  shippingAddress: { name: string; street: string; line2: string | null; city: string; state: string; zip: string; country: string };
};

export const productDrawEntries = pgTable('product_draw_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  buyerId: text('buyer_id').notNull(),
  variantId: uuid('variant_id').notNull(),
  addressId: uuid('address_id'),
  // pending | entered | won | lost | charge_failed | withdrawn | released
  status: text('status').notNull().default('pending'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  amountCents: integer('amount_cents').notNull().default(0),
  priced: jsonb('priced').$type<DrawPricedSnapshot>().notNull(),
  notifyResult: boolean('notify_result').notNull().default(false),
  drawRank: integer('draw_rank'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniq: unique('product_draw_entries_product_buyer_unique').on(t.productId, t.buyerId),
  productStatusIdx: index('product_draw_entries_product_status_idx').on(t.productId, t.status),
  buyerIdx: index('product_draw_entries_buyer_idx').on(t.buyerId, t.createdAt),
}));

export const productDrawEvents = pgTable('product_draw_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  entryId: uuid('entry_id'),
  actor: text('actor'),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  productIdx: index('product_draw_events_product_idx').on(t.productId, t.createdAt),
}));
