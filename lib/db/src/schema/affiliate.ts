import { pgTable, uuid, text, integer, bigint, bigserial, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Affiliate / creator program ─────────────────────────────────────────────
// Created by migration 124. A seller (brand) turns on a program; creators are
// existing Brandthread users who promote the brand with a personal code. No
// foreign keys: every id is a Clerk id / uuid business key, matching the other
// money tables, so test-data purges and account deletion never trip over them.
// Money is integer cents; rates are integer basis points (1000 = 10.00%).

export const affiliatePrograms = pgTable('affiliate_programs', {
  sellerId:          text('seller_id').primaryKey(),
  enabled:           boolean('enabled').notNull().default(false),
  defaultCommissionBps: integer('default_commission_bps').notNull().default(1000),
  // Optional buyer discount granted by a creator's code (0 = code only tracks).
  // Implemented by minting a normal discount_codes row, never a second engine.
  buyerDiscountBps:  integer('buyer_discount_bps').notNull().default(0),
  windowDays:        integer('window_days').notNull().default(30),
  // Days after delivery (the return window) before commission becomes payable.
  holdDays:          integer('hold_days').notNull().default(30),
  minPayoutCents:    integer('min_payout_cents').notNull().default(2500),
  // true: anyone who applies from the program link is approved immediately.
  autoApprove:       boolean('auto_approve').notNull().default(false),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const affiliateCreators = pgTable('affiliate_creators', {
  id:            uuid('id').primaryKey().defaultRandom(),
  sellerId:      text('seller_id').notNull(),
  creatorId:     text('creator_id').notNull(),
  // invited | pending | active | paused | removed | declined
  status:        text('status').notNull(),
  // invite (seller invited) | apply (creator applied)
  origin:        text('origin').notNull(),
  // Globally unique so ?aff=CODE resolves without knowing the brand.
  code:          text('code').notNull(),
  commissionBpsOverride: integer('commission_bps_override'),
  discountCodeId: text('discount_code_id'),
  approvedAt:    timestamp('approved_at', { withTimezone: true }),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pairUnique: uniqueIndex('affiliate_creators_seller_creator_unique').on(t.sellerId, t.creatorId),
  codeUnique: uniqueIndex('affiliate_creators_code_unique').on(t.code),
  creatorIdx: index('affiliate_creators_creator_idx').on(t.creatorId),
}));

export const affiliateClicks = pgTable('affiliate_clicks', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  affiliateId: uuid('affiliate_id').notNull(),
  sellerId:    text('seller_id').notNull(),
  creatorId:   text('creator_id').notNull(),
  // sha256 of a client-generated random visitor id; dedupes a visitor per day.
  visitorHash: text('visitor_hash'),
  day:         text('day').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  affiliateIdx: index('affiliate_clicks_affiliate_idx').on(t.affiliateId, t.createdAt),
  dedupe: uniqueIndex('affiliate_clicks_visitor_day_unique').on(t.affiliateId, t.visitorHash, t.day)
    .where(sql`${t.visitorHash} IS NOT NULL`),
}));

// Last-click attribution for a signed-in buyer: one row per (buyer, seller).
export const affiliateAttributions = pgTable('affiliate_attributions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  affiliateId: uuid('affiliate_id').notNull(),
  sellerId:    text('seller_id').notNull(),
  creatorId:   text('creator_id').notNull(),
  buyerId:     text('buyer_id').notNull(),
  clickedAt:   timestamp('clicked_at', { withTimezone: true }).notNull(),
  expiresAt:   timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => ({
  buyerSeller: uniqueIndex('affiliate_attributions_buyer_seller_unique').on(t.buyerId, t.sellerId),
}));

// One commission per attributed order. amount = accrued, reversed = clawed back
// by refunds/cancellation, paid = already transferred. Net owed to the creator
// is amount - reversed - paid (negative = owed back, netted off the next payout).
// status: pending | payable | paid | reversed
export const affiliateCommissions = pgTable('affiliate_commissions', {
  id:            uuid('id').primaryKey().defaultRandom(),
  affiliateId:   uuid('affiliate_id').notNull(),
  sellerId:      text('seller_id').notNull(),
  creatorId:     text('creator_id').notNull(),
  orderId:       uuid('order_id').notNull(),
  // code (checkout code) | link (?aff= link)
  source:        text('source').notNull(),
  baseCents:     integer('base_cents').notNull(),
  commissionBps: integer('commission_bps').notNull(),
  amountCents:   integer('amount_cents').notNull(),
  reversedCents: integer('reversed_cents').notNull().default(0),
  paidCents:     integer('paid_cents').notNull().default(0),
  status:        text('status').notNull().default('pending'),
  eligibleAt:    timestamp('eligible_at', { withTimezone: true }),
  // The open payout currently covering this commission, if any.
  payoutId:      uuid('payout_id'),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  orderUnique: uniqueIndex('affiliate_commissions_order_unique').on(t.orderId),
  creatorIdx:  index('affiliate_commissions_creator_idx').on(t.creatorId, t.status),
  sellerIdx:   index('affiliate_commissions_seller_idx').on(t.sellerId, t.status),
}));

// Append-only audit trail: accrued | reversed | marked_payable | paid | clawback_settled
export const affiliateCommissionEvents = pgTable('affiliate_commission_events', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  commissionId: uuid('commission_id').notNull(),
  sellerId:     text('seller_id').notNull(),
  creatorId:    text('creator_id').notNull(),
  kind:         text('kind').notNull(),
  amountCents:  bigint('amount_cents', { mode: 'number' }).notNull().default(0),
  meta:         jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  commissionIdx: index('affiliate_commission_events_commission_idx').on(t.commissionId),
}));

// One row per Stripe transfer to a creator. state: processing | paid | failed | cancelled.
// At most one open (processing/failed) payout per seller+creator.
export const affiliatePayouts = pgTable('affiliate_payouts', {
  id:               uuid('id').primaryKey().defaultRandom(),
  sellerId:         text('seller_id').notNull(),
  creatorId:        text('creator_id').notNull(),
  amountCents:      integer('amount_cents').notNull(),
  state:            text('state').notNull().default('processing'),
  // Stripe idempotency key is `affiliate-payout/<id>/<attempt>`.
  attempt:          integer('attempt').notNull().default(1),
  stripeTransferId: text('stripe_transfer_id'),
  failureCode:      text('failure_code'),
  failureMessage:   text('failure_message'),
  nextAttemptAt:    timestamp('next_attempt_at', { withTimezone: true }),
  paidAt:           timestamp('paid_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  openUnique: uniqueIndex('affiliate_payouts_open_unique').on(t.sellerId, t.creatorId)
    .where(sql`${t.state} IN ('processing', 'failed')`),
  creatorIdx: index('affiliate_payouts_creator_idx').on(t.creatorId, t.createdAt),
}));

export const affiliatePayoutItems = pgTable('affiliate_payout_items', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  payoutId:     uuid('payout_id').notNull(),
  commissionId: uuid('commission_id').notNull(),
  sellerId:     text('seller_id').notNull(),
  // Negative = a clawback netted against this payout.
  amountCents:  integer('amount_cents').notNull(),
}, (t) => ({
  payoutIdx: index('affiliate_payout_items_payout_idx').on(t.payoutId),
}));
