import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

// ─── Promoted threads + Featured brand slots (migration 114) ─────────────────
// The review / refund / delivered-spend columns for boosts live on `boosts`
// itself (schema/index.ts). These are the additional tables. `boost_id` has a
// foreign key to boosts in the SQL migration; it is not repeated here so this
// file does not import back into index.ts.

/** One row per sponsored item served to a viewer. `viewedAt` is what bills. */
export const sponsoredDeliveries = pgTable('sponsored_deliveries', {
  id:         uuid('id').primaryKey().defaultRandom(),
  boostId:    uuid('boost_id').notNull(),
  viewerId:   text('viewer_id').notNull(),
  sessionId:  text('session_id').notNull(),
  costCents:  integer('cost_cents').notNull().default(0),
  servedAt:   timestamp('served_at', { withTimezone: true }).defaultNow().notNull(),
  viewedAt:   timestamp('viewed_at', { withTimezone: true }),
}, (t) => ({
  viewerIdx: index('sponsored_deliveries_viewer_idx').on(t.viewerId, t.boostId, t.servedAt),
  sessionUq: uniqueIndex('sponsored_deliveries_session_uq').on(t.boostId, t.viewerId, t.sessionId),
}));

export const featuredSlots = pgTable('featured_slots', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  sellerId:                text('seller_id').notNull(),
  placement:               text('placement').notNull().default('discover_brands'),
  durationDays:            integer('duration_days').notNull(),
  priceCents:              integer('price_cents').notNull(),
  startsAt:                timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt:                  timestamp('ends_at', { withTimezone: true }).notNull(),
  /** 'pending_payment' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'failed' */
  status:                  text('status').notNull().default('pending_payment'),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
  checkoutSessionVersion:  integer('checkout_session_version').notNull().default(0),
  paidAt:                  timestamp('paid_at', { withTimezone: true }),
  reviewedBy:              text('reviewed_by'),
  reviewedAt:              timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason:         text('rejection_reason'),
  refundId:                text('refund_id'),
  /** 'none' | 'refunded' | 'failed' */
  refundStatus:            text('refund_status').notNull().default('none'),
  refundedAt:              timestamp('refunded_at', { withTimezone: true }),
  createdAt:               timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  windowIdx: index('featured_slots_window_idx').on(t.placement, t.status, t.startsAt, t.endsAt),
  sellerIdx: index('featured_slots_seller_idx').on(t.sellerId, t.createdAt),
}));

export const promotionReviews = pgTable('promotion_reviews', {
  id:         uuid('id').primaryKey().defaultRandom(),
  /** 'boost' | 'featured_slot' */
  kind:       text('kind').notNull(),
  targetId:   uuid('target_id').notNull(),
  reviewerId: text('reviewer_id').notNull(),
  /** 'approved' | 'rejected' */
  decision:   text('decision').notNull(),
  reason:     text('reason'),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  targetIdx: index('promotion_reviews_target_idx').on(t.kind, t.targetId, t.createdAt),
}));
