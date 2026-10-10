import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

// Migration 511: one row per (seller, kind, period) claimed before a
// lifecycle message (activation nudge, weekly summary, checkout-blocked
// alert) is sent, so it goes out once across API instances.
export const sellerLifecycleMessages = pgTable('seller_lifecycle_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: text('seller_id').notNull(),
  kind: text('kind').notNull(),
  periodKey: text('period_key').notNull(),
  pushSent: boolean('push_sent').notNull().default(false),
  emailSent: boolean('email_sent').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  once: uniqueIndex('seller_lifecycle_messages_once').on(table.sellerId, table.kind, table.periodKey),
  createdIdx: index('seller_lifecycle_messages_created_idx').on(table.createdAt),
}));
