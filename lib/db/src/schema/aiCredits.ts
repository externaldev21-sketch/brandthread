import { pgTable, uuid, text, integer, timestamp, date, jsonb, primaryKey, index } from 'drizzle-orm/pg-core';

// ─── AI credits ─────────────────────────────────────────────────────────────
// Created by migration 119. Every AI tool call debits credits server-side.
// Three buckets, spent in this order: rollover (last month's unused credits,
// one month only), the monthly allowance (resets each UTC month) and purchased
// packs (never expire). Every plan, Pro included, has a finite allowance;
// ai_pro_usage only holds usage rows from when Pro was unlimited.

export const aiCreditAccounts = pgTable('ai_credit_accounts', {
  clerkUserId:      text('clerk_user_id').primaryKey(),
  monthlyBalance:   integer('monthly_balance').notNull().default(0),
  rolloverBalance:  integer('rollover_balance').notNull().default(0),
  purchasedBalance: integer('purchased_balance').notNull().default(0),
  monthlyAllowance: integer('monthly_allowance').notNull().default(0),
  monthlyPeriod:    text('monthly_period').notNull().default(''),
  // Migration 261: first time the subscription was seen past due (null when paid).
  billingIssueSince: timestamp('billing_issue_since', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiCreditLedger = pgTable('ai_credit_ledger', {
  id:             uuid('id').primaryKey().defaultRandom(),
  clerkUserId:    text('clerk_user_id').notNull(),
  kind:           text('kind').notNull(),
  delta:          integer('delta').notNull(),
  toolKey:        text('tool_key'),
  reference:      text('reference'),
  idempotencyKey: text('idempotency_key'),
  monthlyDelta:   integer('monthly_delta').notNull().default(0),
  rolloverDelta:  integer('rollover_delta').notNull().default(0),
  purchasedDelta: integer('purchased_delta').notNull().default(0),
  balanceAfter:   integer('balance_after').notNull().default(0),
  meta:           jsonb('meta').$type<Record<string, unknown>>(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('ai_credit_ledger_user_idx').on(t.clerkUserId, t.createdAt),
}));

export const aiSpendDaily = pgTable('ai_spend_daily', {
  day:         date('day').notNull(),
  clerkUserId: text('clerk_user_id').notNull(),
  spent:       integer('spent').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.day, t.clerkUserId] }) }));

export const aiSpendAlerts = pgTable('ai_spend_alerts', {
  day:       date('day').notNull(),
  scope:     text('scope').notNull(),
  threshold: integer('threshold').notNull(),
  firedAt:   timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.day, t.scope, t.threshold] }) }));

export const aiCreditPurchases = pgTable('ai_credit_purchases', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  clerkUserId:             text('clerk_user_id').notNull(),
  packId:                  text('pack_id').notNull(),
  credits:                 integer('credits').notNull(),
  amountCents:             integer('amount_cents').notNull(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id'),
  status:                  text('status').notNull().default('pending_payment'),
  paidAt:                  timestamp('paid_at', { withTimezone: true }),
  createdAt:               timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiProUsage = pgTable('ai_pro_usage', {
  clerkUserId:      text('clerk_user_id').primaryKey(),
  period:           text('period').notNull().default(''),
  creditsUsed:      integer('credits_used').notNull().default(0),
  day:              text('day').notNull().default(''),
  generationsToday: integer('generations_today').notNull().default(0),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
