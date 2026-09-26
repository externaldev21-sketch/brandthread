import { pgTable, uuid, text, integer, timestamp, boolean } from 'drizzle-orm/pg-core';

// ─── Thread Cash ────────────────────────────────────────────────────────────
// A platform-funded, non-cash reward credit for buyers. It cannot be cashed
// out, withdrawn, or converted to money — only applied toward purchases in
// the app. Created by migration 085.
//
// Mirrors the `loyalty_points` design (see routes/loyalty.ts): a single
// append-style ledger of signed cent amounts per buyer, with a redemption
// row reserved to one checkout and consumed only when that checkout's order
// is actually created. Balances are always `SUM(amount_cents)`, never a
// mutable counter, so a crashed request can never double-award or strand
// half a transaction.

export const threadCashEntries = pgTable('thread_cash_entries', {
  id:          uuid('id').primaryKey().defaultRandom(),
  buyerId:     text('buyer_id').notNull(),
  amountCents: integer('amount_cents').notNull(), // + earned/refunded, - spent/expired
  // 'daily_checkin' | 'streak_bonus' | 'redemption' | 'checkout_spend' |
  // 'refund_credit' | 'expiry' | 'admin_adjustment' | 'send_sent' |
  // 'send_received' | 'send_cancelled' | 'send_expired'
  source:      text('source').notNull(),
  referenceId: text('reference_id'),
  note:        text('note'),
  // Redemption rows are first attached to one checkout, then marked used only
  // after the corresponding order is successfully created (same pattern as
  // loyalty_points.checkout_session_id).
  checkoutSessionId: text('checkout_session_id'),
  usedAt:      timestamp('used_at', { withTimezone: true }),
  usedOrderId: uuid('used_order_id'),
  // Required for redeem/spend-style mutations so a client retry or double
  // tap can never post twice; enforced by a unique partial index.
  idempotencyKey: text('idempotency_key'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// One row per buyer. `lastCheckInDate` is the buyer-local calendar date
// (YYYY-MM-DD, per `timezone`) of the last successful check-in — comparisons
// use this string, never a UTC day boundary, so a check-in is always judged
// against the buyer's own midnight.
export const threadCashStreaks = pgTable('thread_cash_streaks', {
  buyerId:         text('buyer_id').primaryKey(),
  timezone:        text('timezone').notNull().default('UTC'), // IANA tz, reported by the client
  currentStreak:   integer('current_streak').notNull().default(0),
  longestStreak:   integer('longest_streak').notNull().default(0),
  lastCheckInDate: text('last_check_in_date'), // buyer-local YYYY-MM-DD
  lastCheckInAt:   timestamp('last_check_in_at', { withTimezone: true }),
  lastDeviceId:    text('last_device_id'),
  // Admin moderation kill switch: a frozen buyer can't check in, redeem,
  // send, or claim, independent of the global feature flags.
  frozen:          boolean('frozen').notNull().default(false),
  frozenReason:    text('frozen_reason'),
  frozenAt:        timestamp('frozen_at', { withTimezone: true }),
  frozenBy:        text('frozen_by'),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Single configurable-rules row, edited by moderators the same way as
// feature_flags. `id` is always 'default' — there is exactly one row.
export const threadCashConfig = pgTable('thread_cash_config', {
  id:                  text('id').primaryKey().default('default'),
  dailyAmountCents:    integer('daily_amount_cents').notNull().default(10),
  streakBonusCents:    integer('streak_bonus_cents').notNull().default(100),
  streakBonusDays:     integer('streak_bonus_days').notNull().default(7),
  graceHours:          integer('grace_hours').notNull().default(6),
  // null = never expires (the product default)
  expiryDays:          integer('expiry_days'),
  // null = no cap beyond the order total itself
  maxRedemptionPerOrderCents: integer('max_redemption_per_order_cents'),
  // Anti-farming: caps and eligibility for sending Thread Cash to a friend.
  dailySendCapCents:      integer('daily_send_cap_cents').notNull().default(2000),
  dailyReceiveCapCents:   integer('daily_receive_cap_cents').notNull().default(5000),
  minAccountAgeHoursForSend: integer('min_account_age_hours_for_send').notNull().default(24),
  maxCheckInsPerDevicePerDay: integer('max_check_ins_per_device_per_day').notNull().default(3),
  updatedBy:           text('updated_by'),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Send-in-chat (Apple-Cash-style) transfers. Feature-flagged OFF by default
// (see PR notes): peer-to-peer transfer of cash-like value has
// money-transmitter and App Store implications that need legal sign-off
// before `threadCashSend` is turned on. The schema/ledger exist so the UI
// and backend can be built and reviewed ahead of that decision.
export const threadCashTransfers = pgTable('thread_cash_transfers', {
  id:             uuid('id').primaryKey().defaultRandom(),
  senderId:       text('sender_id').notNull(),
  recipientId:    text('recipient_id').notNull(),
  conversationId: uuid('conversation_id'),
  amountCents:    integer('amount_cents').notNull(),
  status:         text('status').notNull().default('pending'), // pending | claimed | expired | cancelled
  messageId:      uuid('message_id'),
  note:           text('note'),
  claimedAt:      timestamp('claimed_at', { withTimezone: true }),
  cancelledAt:    timestamp('cancelled_at', { withTimezone: true }),
  expiresAt:      timestamp('expires_at', { withTimezone: true }),
  idempotencyKey: text('idempotency_key'),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
