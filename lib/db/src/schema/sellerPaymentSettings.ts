import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';

// Per-seller payment settings (migration 114). bnplEnabled opts the seller in
// to Klarna / Afterpay at checkout; a cart offers BNPL only when EVERY seller
// in it has opted in.
export const sellerPaymentSettings = pgTable('seller_payment_settings', {
  sellerId:    text('seller_id').primaryKey(),
  bnplEnabled: boolean('bnpl_enabled').notNull().default(false),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
