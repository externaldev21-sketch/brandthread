import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

// ─── First-order platform discount (migration 271) ───────────────────────────
// Brandthread-funded $ off a signed-in buyer's first paid order. ONE row per
// buyer, ever (buyer_id is the primary key), so retries and concurrent
// checkouts can never grant it twice. Lifecycle:
//   reserved  held by one checkout row (checkout_session_id) while it is paid
//   released  that checkout was cancelled / failed / expired; can be reserved again
//   applied   the paid webhook made the order (order_id); seller topped up by a
//             platform-funded transfer (stripe_transfer_id)
//   reversed  the order was fully refunded / cancelled; top-up reversed, and the
//             buyer may use the discount again on a later first kept order
// Money lives in the double-entry ledger (account `first_order_discount`);
// this row is the per-buyer claim. See api-server lib/promotions/firstOrderDiscount.ts.
export const firstOrderDiscounts = pgTable('first_order_discounts', {
  buyerId:           text('buyer_id').primaryKey(),
  status:            text('status').notNull(),
  amountCents:       integer('amount_cents').notNull(),
  checkoutSessionId: uuid('checkout_session_id'),
  orderId:           uuid('order_id'),
  sellerId:          text('seller_id'),
  stripeTransferId:  text('stripe_transfer_id'),
  reservedAt:        timestamp('reserved_at', { withTimezone: true }),
  appliedAt:         timestamp('applied_at', { withTimezone: true }),
  reversedAt:        timestamp('reversed_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
