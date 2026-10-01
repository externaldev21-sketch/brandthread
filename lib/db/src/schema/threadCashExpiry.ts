import { pgTable, text, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';

// Migration 116. One row per buyer per upcoming-expiry day, inserted before
// the "your Thread Cash expires soon" notification is sent, so a re-run of
// the expiry job can never warn twice for the same lapse.
export const threadCashExpiryWarnings = pgTable('thread_cash_expiry_warnings', {
  buyerId:     text('buyer_id').notNull(),
  expiresOn:   text('expires_on').notNull(), // UTC YYYY-MM-DD
  amountCents: integer('amount_cents').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.buyerId, t.expiresOn] }),
}));
