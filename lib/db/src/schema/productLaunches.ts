import { pgTable, uuid, text, boolean, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { products } from './index';

// Ship-by date for a pre-order product, validated against the 60-day refund
// window (see artifacts/api-server/src/lib/preorderTerms.ts).
export const productPreorderTerms = pgTable('product_preorder_terms', {
  productId: uuid('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  shipByDate: timestamp('ship_by_date', { withTimezone: true }).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Scheduled product launch. No row = the product behaves exactly as before.
export const productLaunches = pgTable('product_launches', {
  productId: uuid('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  launchAt: timestamp('launch_at', { withTimezone: true }).notNull(),
  notifyFollowers: boolean('notify_followers').notNull().default(false),
  // Set once by the launch job; the claim that makes notifications exactly-once.
  launchedAt: timestamp('launched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  dueIdx: index('product_launches_due_idx').on(t.launchedAt, t.launchAt),
}));

export const productLaunchAlerts = pgTable('product_launch_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniq: unique().on(t.productId, t.userId),
  userIdx: index('product_launch_alerts_user_idx').on(t.userId),
}));
