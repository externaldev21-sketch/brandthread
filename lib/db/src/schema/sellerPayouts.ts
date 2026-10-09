import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

// ─── Seller payouts (Stripe Connect → seller bank) ───────────────────────────
// Created by migration 330. Fed by the Connect webhook events
// payout.created/updated/paid/failed/canceled (routes/webhooks.ts →
// lib/money/sellerPayouts.ts) and, before webhooks have covered an account,
// by a one-time backfill from stripe.payouts.list. The finance routes read
// payout status from here instead of calling Stripe on every request.

export const sellerPayouts = pgTable('seller_payouts', {
  id:                uuid('id').primaryKey().defaultRandom(),
  stripePayoutId:    text('stripe_payout_id').notNull(),
  stripeAccountId:   text('stripe_account_id').notNull(),
  // users.clerk_id of the seller who owned stripeAccountId when last seen.
  sellerId:          text('seller_id'),
  amountCents:       integer('amount_cents').notNull(),
  currency:          text('currency').notNull(),
  // pending | in_transit | paid | failed | canceled (Stripe payout.status)
  status:            text('status').notNull(),
  method:            text('method'),
  automatic:         boolean('automatic'),
  description:       text('description'),
  arrivalDate:       timestamp('arrival_date', { withTimezone: true }),
  failureCode:       text('failure_code'),
  failureMessage:    text('failure_message'),
  destinationLast4:  text('destination_last4'),
  destinationBrand:  text('destination_brand'),
  // Stripe's payout.created.
  payoutCreatedAt:   timestamp('payout_created_at', { withTimezone: true }),
  // event.created of the newest event (or the API read time) applied to this
  // row. Older events delivered late are ignored.
  lastEventCreated:  timestamp('last_event_created', { withTimezone: true }).notNull(),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  stripePayoutUnique: uniqueIndex('seller_payouts_stripe_payout_id_unique').on(table.stripePayoutId),
  accountCreatedIdx:  index('seller_payouts_account_created_idx').on(table.stripeAccountId, table.payoutCreatedAt),
  sellerStatusIdx:    index('seller_payouts_seller_status_idx').on(table.sellerId, table.status),
}));

// One row per connected account whose payout history has been copied from
// the Stripe API into seller_payouts. Until then the finance routes read
// Stripe directly (and backfill), so history from before webhooks is kept.
export const sellerPayoutSyncs = pgTable('seller_payout_syncs', {
  id:              uuid('id').primaryKey().defaultRandom(),
  stripeAccountId: text('stripe_account_id').notNull(),
  sellerId:        text('seller_id'),
  backfilledAt:    timestamp('backfilled_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  accountUnique: uniqueIndex('seller_payout_syncs_account_unique').on(table.stripeAccountId),
}));
