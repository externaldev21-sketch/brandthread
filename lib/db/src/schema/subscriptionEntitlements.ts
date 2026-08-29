import { boolean, index, json, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * A cached, server-verified view of a seller's native-store entitlement.
 * RevenueCat remains authoritative; this table exists for authorization and
 * availability when a request cannot make a live provider call.
 */
export const sellerSubscriptionEntitlements = pgTable("seller_subscription_entitlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull(),
  provider: text("provider").notNull(), // currently "revenuecat"
  planId: text("plan_id").notNull().default("starter"),
  status: text("status").notNull().default("expired"), // active | trial | grace | expired
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  isSandbox: boolean("is_sandbox").notNull().default(false),
  productIdentifier: text("product_identifier"),
  providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  providerData: json("provider_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerUserUnique: uniqueIndex("seller_subscription_entitlements_provider_user_unique")
    .on(table.provider, table.clerkUserId),
  userStatusIdx: index("seller_subscription_entitlements_user_status_idx")
    .on(table.clerkUserId, table.status),
}));

/** RevenueCat delivery ledger. A unique event id makes retries harmless. */
export const revenueCatWebhookEvents = pgTable("revenuecat_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type"),
  appUserId: text("app_user_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  eventIdUnique: uniqueIndex("revenuecat_webhook_events_event_id_unique").on(table.eventId),
  appUserIdx: index("revenuecat_webhook_events_app_user_idx").on(table.appUserId, table.receivedAt),
}));