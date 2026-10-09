import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Seller email list. One row per (seller, lower(email)); suppression lives in `status`. */
export const emailSubscribers = pgTable("email_subscribers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sellerId: text("seller_id").notNull(),
  email: text("email").notNull(),
  source: text("source").notNull().default("store_site"),
  /** subscribed | pending | unsubscribed | bounced | complained */
  status: text("status").notNull().default("subscribed"),
  unsubscribeToken: text("unsubscribe_token").notNull(),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  consentIpHash: text("consent_ip_hash"),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sellerEmailUidx: uniqueIndex("email_subscribers_seller_email_uidx").on(t.sellerId, sql`lower(${t.email})`),
  tokenUidx: uniqueIndex("email_subscribers_token_uidx").on(t.unsubscribeToken),
  sellerCreatedIdx: index("email_subscribers_seller_created_idx").on(t.sellerId, t.createdAt),
}));

export const emailSettings = pgTable("email_settings", {
  sellerId: text("seller_id").primaryKey(),
  fromName: text("from_name"),
  replyTo: text("reply_to"),
  postalAddress: text("postal_address"),
  doubleOptIn: boolean("double_opt_in").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailCampaigns = pgTable("email_campaigns", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sellerId: text("seller_id").notNull(),
  subject: text("subject").notNull().default(""),
  preheader: text("preheader").notNull().default(""),
  body: jsonb("body").notNull().default(sql`'{}'::jsonb`),
  /** subscribers | customers | followers */
  audience: text("audience").notNull().default("subscribers"),
  /** draft | scheduled | sending | sent */
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  recipientCount: integer("recipient_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sellerIdx: index("email_campaigns_seller_idx").on(t.sellerId, t.createdAt),
  dueIdx: index("email_campaigns_due_idx").on(t.status, t.scheduledAt),
}));

export const emailCampaignSends = pgTable("email_campaign_sends", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: uuid("campaign_id").notNull(),
  sellerId: text("seller_id").notNull(),
  subscriberId: uuid("subscriber_id").notNull(),
  email: text("email").notNull(),
  /** queued | sending | sent | failed | skipped */
  status: text("status").notNull().default("queued"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  bouncedAt: timestamp("bounced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  campaignSubUidx: uniqueIndex("email_campaign_sends_campaign_sub_uidx").on(t.campaignId, t.subscriberId),
  statusIdx: index("email_campaign_sends_status_idx").on(t.campaignId, t.status),
  sellerSentIdx: index("email_campaign_sends_seller_sent_idx").on(t.sellerId, t.sentAt),
  providerIdx: index("email_campaign_sends_provider_idx").on(t.providerMessageId),
}));
