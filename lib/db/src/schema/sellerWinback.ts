import { pgTable, uuid, text, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

// Migration 512: one win-back message per ended seller subscription.
export const sellerWinbackMessages = pgTable('seller_winback_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: text('seller_id').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  pushSent: boolean('push_sent').notNull().default(false),
  emailSent: boolean('email_sent').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  once: uniqueIndex('seller_winback_messages_once').on(table.sellerId, table.periodEnd),
}));
