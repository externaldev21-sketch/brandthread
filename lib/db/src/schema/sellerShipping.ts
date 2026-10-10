import { pgTable, uuid, text, integer, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { shippingLabels } from './index';

// Settings → Locations (migration 510). The primary active location is the
// seller's ship-from address for shipping labels.
export const sellerLocations = pgTable('seller_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  country: text('country').notNull().default('US'),
  zip: text('zip'),
  phone: text('phone'),
  isActive: boolean('is_active').notNull().default(true),
  isPrimary: boolean('is_primary').notNull().default(false),
  fulfillsOnlineOrders: boolean('fulfills_online_orders').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index('seller_locations_owner_idx').on(table.ownerId),
}));

// A carrier re-weigh / re-size surcharge on a Brandthread-bought label,
// recovered from the seller once per external (Shippo) adjustment id.
export const shippingLabelAdjustments = pgTable('shipping_label_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').notNull(),
  labelId: uuid('label_id').notNull().references(() => shippingLabels.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').notNull(),
  ownerId: text('owner_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason'),
  /** from_held | recovered | owed */
  status: text('status').notNull().default('owed'),
  stripeReversalId: text('stripe_reversal_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  externalUnique: uniqueIndex('shipping_label_adjustments_external_unique').on(table.externalId),
  ownerIdx: index('shipping_label_adjustments_owner_idx').on(table.ownerId),
}));
