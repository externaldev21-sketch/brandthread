import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Dunning state for a seller's Stripe platform subscription (item 115).
 * Written only by the Stripe webhooks (lib/billing/dunning.ts in the API
 * server); read by GET /api/seller/subscription/status for the retry banner.
 */
export const sellerSubscriptionDunning = pgTable("seller_subscription_dunning", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  subscriptionId: text("subscription_id").notNull(),
  invoiceId: text("invoice_id"),
  /** Stripe invoice.attempt_count of the last failure handled (1 = first charge). */
  lastAttempt: integer("last_attempt").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  resumedAt: timestamp("resumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  subscriptionIdx: index("seller_subscription_dunning_subscription_idx").on(table.subscriptionId),
}));
