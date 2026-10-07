import { pgTable, uuid, text, integer, bigint, bigserial, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { orders } from './index';

// ─── Money ledger (double-entry, append-only) ─────────────────────────────────
// Created by migration 084, which also installs the database triggers that
// (a) reject any transaction whose postings do not sum to zero and
// (b) reject UPDATE/DELETE on both tables. Corrections are new transactions.

export const ledgerTransactions = pgTable('ledger_transactions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  // Deterministic key per business event (e.g. "order-paid/<orderId>"), so a
  // replayed webhook or retried request can never post twice.
  idempotencyKey: text('idempotency_key').notNull().unique(),
  kind:           text('kind').notNull(),
  sellerId:       text('seller_id'),
  orderId:        uuid('order_id'),
  dropId:         uuid('drop_id'),
  sampleOrderId:  uuid('sample_order_id'),
  stripeObjectId: text('stripe_object_id'),
  memo:           text('memo'),
  occurredAt:     timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sellerIdx: index('ledger_transactions_seller_idx').on(t.sellerId, t.occurredAt),
  orderIdx:  index('ledger_transactions_order_idx').on(t.orderId),
  dropIdx:   index('ledger_transactions_drop_idx').on(t.dropId),
}));

export const ledgerPostings = pgTable('ledger_postings', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  transactionId: uuid('transaction_id').notNull().references(() => ledgerTransactions.id),
  // See LEDGER_ACCOUNTS in api-server lib/money/ledger.ts.
  account:       text('account').notNull(),
  // Seller Clerk ID or manufacturer ID the account belongs to, when scoped.
  partyId:       text('party_id'),
  dropId:        uuid('drop_id'),
  orderId:       uuid('order_id'),
  amountCents:   bigint('amount_cents', { mode: 'number' }).notNull(),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  transactionIdx:  index('ledger_postings_transaction_idx').on(t.transactionId),
  accountPartyIdx: index('ledger_postings_account_party_idx').on(t.account, t.partyId),
  dropIdx:         index('ledger_postings_drop_idx').on(t.dropId),
  orderIdx:        index('ledger_postings_order_idx').on(t.orderId),
}));

// ─── Per-order release of held preorder funds ─────────────────────────────────
// Exactly one row per held order (unique order_id). State machine:
// pending → transferring → paid (→ reversed); transferring → failed → transferring.
export const orderReleases = pgTable('order_releases', {
  id:                uuid('id').primaryKey().defaultRandom(),
  orderId:           uuid('order_id').notNull().unique().references(() => orders.id),
  dropId:            uuid('drop_id'),
  sellerId:          text('seller_id').notNull(),
  state:             text('state').notNull().default('pending'),
  // 'tracking' | 'label' | 'manual' | 'sweeper' | 'legacy'
  trigger:           text('trigger').notNull(),
  amountCents:       integer('amount_cents').notNull().default(0),
  labelCents:        integer('label_cents').notNull().default(0),
  bulkShareCents:    integer('bulk_share_cents').notNull().default(0),
  reversedCents:     integer('reversed_cents').notNull().default(0),
  // Kept back from this release to pay a seller recovery (lost chargeback);
  // decided once before the transfer (migration 306). NULL = not decided yet.
  recoveryNettedCents: integer('recovery_netted_cents'),
  // Increments only after Stripe definitively rejects a transfer, so an
  // ambiguous failure is always retried with the same idempotency key.
  attempt:           integer('attempt').notNull().default(1),
  stripeTransferId:  text('stripe_transfer_id'),
  stripeDestination: text('stripe_destination'),
  lastErrorCode:     text('last_error_code'),
  lastErrorMessage:  text('last_error_message'),
  paidAt:            timestamp('paid_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sellerIdx: index('order_releases_seller_idx').on(t.sellerId),
  dropIdx:   index('order_releases_drop_idx').on(t.dropId),
}));

// ─── Refunds ──────────────────────────────────────────────────────────────────
// One row per refund request. State machine: processing → succeeded | failed;
// failed → processing (retry). The ledger is posted only on success.
export const orderRefunds = pgTable('order_refunds', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  orderId:                  uuid('order_id').notNull().references(() => orders.id),
  sellerId:                 text('seller_id').notNull(),
  idempotencyKey:           text('idempotency_key').notNull().unique(),
  amountCents:              integer('amount_cents').notNull(),
  // buyer_cancelled | seller_cancelled | return_approved | drop_failed | oversold | stripe_dashboard
  reason:                   text('reason').notNull(),
  initiatedBy:              text('initiated_by').notNull(),
  state:                    text('state').notNull().default('processing'),
  attempt:                  integer('attempt').notNull().default(1),
  // Set when a full cancellation parks the order in refund_pending; restored
  // if Stripe rejects the refund.
  previousOrderStatus:      text('previous_order_status'),
  stripeRefundId:           text('stripe_refund_id').unique(),
  platformFeeRefundCents:   integer('platform_fee_refund_cents').notNull().default(0),
  transferReversalCents:    integer('transfer_reversal_cents').notNull().default(0),
  stripeTransferReversalId: text('stripe_transfer_reversal_id'),
  failureCode:              text('failure_code'),
  failureMessage:           text('failure_message'),
  succeededAt:              timestamp('succeeded_at', { withTimezone: true }),
  createdAt:                timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:                timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  orderIdx: index('order_refunds_order_idx').on(t.orderId),
}));

// ─── Seller recoveries (lost chargebacks after payout) ────────────────────────
// Migration 306. One row per (Stripe dispute, order): the seller's share of a
// lost chargeback that had already been paid out, plus their share of Stripe's
// dispute fee. Outstanding = amount + fee − recovered − forgiven. While any
// row is open the seller's payouts are paused and order releases net the debt
// first (api-server lib/money/sellerRecovery.ts).
export const sellerRecoveries = pgTable('seller_recoveries', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  sellerId:           text('seller_id').notNull(),
  disputeId:          uuid('dispute_id'),
  stripeDisputeId:    text('stripe_dispute_id').notNull(),
  orderId:            uuid('order_id'),
  paymentIntentId:    text('payment_intent_id'),
  amountCents:        integer('amount_cents').notNull().default(0),
  feeCents:           integer('fee_cents').notNull().default(0),
  heldCancelledCents: integer('held_cancelled_cents').notNull().default(0),
  recoveredCents:     integer('recovered_cents').notNull().default(0),
  forgivenCents:      integer('forgiven_cents').notNull().default(0),
  // open | recovered | written_off | reinstated
  status:             text('status').notNull().default('open'),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  recoveredAt:        timestamp('recovered_at', { withTimezone: true }),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  disputeOrderUnique: uniqueIndex('seller_recoveries_dispute_order_unique').on(t.stripeDisputeId, t.orderId),
  sellerIdx:          index('seller_recoveries_seller_idx').on(t.sellerId, t.createdAt),
}));

export const sellerRecoveryApplications = pgTable('seller_recovery_applications', {
  id:          uuid('id').primaryKey().defaultRandom(),
  recoveryId:  uuid('recovery_id').notNull().references(() => sellerRecoveries.id, { onDelete: 'cascade' }),
  // transfer_reversal | release_netting | payout_netting | manual | write_off | reinstated
  source:      text('source').notNull(),
  amountCents: integer('amount_cents').notNull(),
  stripeRef:   text('stripe_ref'),
  orderId:     uuid('order_id'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  recoveryIdx: index('seller_recovery_applications_recovery_idx').on(t.recoveryId, t.createdAt),
}));
