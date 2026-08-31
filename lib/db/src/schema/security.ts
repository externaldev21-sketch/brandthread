import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(),
  requestCount: integer("request_count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  expiresAtIdx: index("rate_limit_buckets_expires_at_idx").on(table.expiresAt),
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