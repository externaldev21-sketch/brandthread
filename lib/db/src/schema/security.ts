import { index, integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex, unique } from "drizzle-orm/pg-core";
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

/** Buyer-scoped, one-shot release-check failures shared across API replicas. */
export const releaseTestFailureClaims = pgTable("release_test_failure_claims", {
  buyerId: text("buyer_id").primaryKey(),
  failureKind: text("failure_kind").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  expiresAtIdx: index("release_test_failure_claims_expires_at_idx").on(table.expiresAt),
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

/**
 * Provenance registry: one row per AI-generated image returned to a user
 * (SHA-256 of the bytes). Lets saved assets and posts be labelled
 * `ai_generated` by lookup. Written by the api-server AI safety guard.
 */
export const aiGeneratedMedia = pgTable("ai_generated_media", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: text("owner_id").notNull(),
  tool: text("tool").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerShaUniq: unique("ai_generated_media_owner_sha_uniq").on(table.ownerId, table.sha256),
  shaIdx: index("ai_generated_media_sha_idx").on(table.sha256),
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
/**
 * Public web account-deletion requests (Google Play account-deletion URL).
 * Only the SHA-256 hash of the emailed token is stored. A request becomes
 * `completed` only after the owner confirms the emailed link and the deletion
 * grace period is scheduled.
 */
export const accountDeletionRequests = pgTable("account_deletion_requests", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  clerkId: text("clerk_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenHashIdx: uniqueIndex("account_deletion_requests_token_hash_idx").on(table.tokenHash),
  emailIdx: index("account_deletion_requests_email_idx").on(table.email, table.createdAt),
}));

/**
 * Single-use email codes that re-authenticate password-less (OAuth-only)
 * accounts before they schedule account deletion. Only the SHA-256 hash is
 * stored; 15-minute expiry is enforced by the route.
 */
export const accountDeletionCodes = pgTable("account_deletion_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  clerkId: text("clerk_id").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clerkIdx: index("account_deletion_codes_clerk_idx").on(table.clerkId, table.createdAt),
}));

/**
 * Async "Email me a download link" data exports (migration 117). The raw
 * download token is never stored — only its SHA-256 hash.
 * status: queued | running | ready | failed | expired
 */
export const dataExportJobs = pgTable("data_export_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  clerkId: text("clerk_id").notNull(),
  status: text("status").notNull().default("queued"),
  categories: jsonb("categories").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  fileObjectKey: text("file_object_key"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  downloadTokenHash: text("download_token_hash"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
}, (table) => ({
  clerkIdx: index("data_export_jobs_clerk_idx").on(table.clerkId, table.requestedAt),
  statusIdx: index("data_export_jobs_status_idx").on(table.status, table.requestedAt),
  tokenHashUniq: uniqueIndex("data_export_jobs_token_hash_uniq").on(table.downloadTokenHash).where(sql`download_token_hash IS NOT NULL`),
}));
