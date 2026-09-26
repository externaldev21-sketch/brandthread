import { index, integer, pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Server-issued (Resend-backed) forgot-password codes. The code itself is
 * never stored — only its SHA-256 hash — and each row is single-use
 * (`usedAt`) with a 15-minute expiry enforced by the route that writes it.
 */
export const passwordResetCodes = pgTable("password_reset_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  clerkId: text("clerk_id").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailIdx: index("password_reset_codes_email_idx").on(table.email, table.createdAt),
  expiresAtIdx: index("password_reset_codes_expires_at_idx").on(table.expiresAt),
}));

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(),
  requestCount: integer("request_count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  expiresAtIdx: index("rate_limit_buckets_expires_at_idx").on(table.expiresAt),
}));

/** Durable one-success allowance for the seller onboarding AI sample. */
export const onboardingAiSamples = pgTable("onboarding_ai_samples", {
  accountId: text("account_id").primaryKey(),
  status: text("status").notNull().default("reserved"),
  reservationId: text("reservation_id").notNull(),
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({
  reservationIdx: index("onboarding_ai_samples_reservation_idx").on(table.reservationId),
}));

export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("processing"),
  attemptCount: integer("attempt_count").notNull().default(1),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  lastError: text("last_error"),
}, (table) => ({
  statusStartedIdx: index("stripe_webhook_events_status_started_idx")
    .on(table.status, table.processingStartedAt),
}));

/**
 * Trial-ending warnings have an external side effect (push delivery) that
 * happens before the general webhook ledger can be marked processed. Keep a
 * durable event marker so a replay cannot send the same warning twice.
 */
export const stripeTrialWarningEvents = pgTable("stripe_trial_warning_events", {
  eventId: text("event_id").primaryKey(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sellerTrialReminderEvents = pgTable("seller_trial_reminder_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerId: text("seller_id").notNull(),
  trialEndAt: timestamp("trial_end_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sellerTrialUnique: unique("seller_trial_reminder_events_seller_trial_unique")
    .on(table.sellerId, table.trialEndAt),
  trialEndIdx: index("seller_trial_reminder_events_trial_end_idx").on(table.trialEndAt),
}));