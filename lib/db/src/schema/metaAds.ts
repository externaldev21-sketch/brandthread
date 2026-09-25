import { pgTable, uuid, text, integer, numeric, timestamp, boolean, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

// ─── Meta Ads (Facebook + Instagram) ───────────────────────────────────────────
// A seller connects their own Meta Business/Ad Account via OAuth (Facebook Login
// for Business); Brandthread never touches ad spend — Meta bills the seller's ad
// account payment method directly. All Graph API calls happen server-side; the
// client never sees raw tokens.

// One row per seller connection. Access token is AES-256-GCM encrypted at rest
// (see api-server src/lib/metaCrypto.ts) — never stored or returned in plaintext.
export const metaAdAccounts = pgTable('meta_ad_accounts', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  sellerId:               text('seller_id').notNull().unique(),

  metaUserId:             text('meta_user_id'),
  metaUserName:           text('meta_user_name'),

  // Encrypted long-lived user access token, format "v1:<iv>:<authTag>:<ciphertext>" (base64 parts).
  accessTokenEncrypted:   text('access_token_encrypted').notNull(),
  tokenExpiresAt:         timestamp('token_expires_at', { withTimezone: true }),
  scopes:                 jsonb('scopes').$type<string[]>().notNull().default([]),

  businessId:             text('business_id'),
  businessName:           text('business_name'),
  adAccountId:            text('ad_account_id'), // e.g. "act_1234567890"
  adAccountName:          text('ad_account_name'),
  adAccountCurrency:      text('ad_account_currency'),
  pageId:                 text('page_id'),
  pageName:               text('page_name'),
  instagramActorId:       text('instagram_actor_id'),
  instagramUsername:      text('instagram_username'),
  pixelId:                text('pixel_id'), // also used as the Conversions API dataset id

  /** 'pending_selection' | 'connected' | 'needs_reauth' | 'disconnected' */
  status:                 text('status').notNull().default('pending_selection'),
  lastError:              text('last_error'),
  connectedAt:            timestamp('connected_at', { withTimezone: true }),
  disconnectedAt:         timestamp('disconnected_at', { withTimezone: true }),

  createdAt:              timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:              timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// A seller-authored Meta campaign, created through Brandthread's Create Ad flow.
// Maps 1:1 onto a live Meta Campaign -> Ad Set -> Ad Creative -> Ad chain, built
// idempotently via idempotencyKey so a retried "Launch" tap never double-creates.
export const metaCampaigns = pgTable('meta_campaigns', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  sellerId:               text('seller_id').notNull(),
  adAccountRecordId:      uuid('ad_account_record_id').notNull(),
  /** Optional link back to the in-house ad_campaigns draft this was promoted from */
  localAdCampaignId:      uuid('local_ad_campaign_id'),

  /** 'product' | 'store' | 'video' */
  promoteKind:            text('promote_kind').notNull(),
  /** product UUID / feed video or post id — null when promoteKind = 'store' */
  promoteRefId:           text('promote_ref_id'),

  /** Brandthread-facing goal: 'sales' | 'traffic' | 'awareness' */
  objective:              text('objective').notNull(),
  /** Meta objective this maps to, e.g. 'OUTCOME_SALES' | 'OUTCOME_TRAFFIC' | 'OUTCOME_AWARENESS' */
  metaObjective:          text('meta_objective').notNull(),

  primaryText:            text('primary_text'),
  headline:               text('headline'),
  /** e.g. 'SHOP_NOW' | 'LEARN_MORE' | 'SIGN_UP' */
  ctaType:                text('cta_type').notNull().default('SHOP_NOW'),
  destinationUrl:         text('destination_url').notNull(),

  mediaKind:              text('media_kind').notNull().default('photos'), // 'video' | 'photos'
  mediaObjectPaths:       jsonb('media_object_paths').$type<string[]>().notNull().default([]),

  /** 'daily' | 'lifetime' */
  budgetType:             text('budget_type').notNull().default('daily'),
  budgetCents:            integer('budget_cents').notNull(),
  startTime:              timestamp('start_time', { withTimezone: true }),
  endTime:                timestamp('end_time', { withTimezone: true }),

  /** Advantage+ on by default; when true, placements/audience below are hints only */
  advantagePlus:          boolean('advantage_plus').notNull().default(true),
  /** ['facebook','instagram'] positions or Advantage+ placement config */
  placements:             jsonb('placements').$type<Record<string, unknown>>().notNull().default({}),
  /** { countries: string[], ageMin, ageMax, genders: string[], interests: {id,name}[] } */
  targetingSpec:          jsonb('targeting_spec').$type<Record<string, unknown>>().notNull().default({}),

  /**
   * 'draft' | 'launching' | 'in_review' | 'active' | 'paused' | 'rejected' |
   * 'completed' | 'failed' | 'archived'
   */
  status:                 text('status').notNull().default('draft'),
  rejectionReason:        text('rejection_reason'),

  /** Deterministic per-launch-attempt key so a retried request never double-creates on Meta */
  idempotencyKey:         text('idempotency_key').notNull().unique(),

  metaCampaignId:         text('meta_campaign_id'),
  metaAdSetId:            text('meta_ad_set_id'),
  metaCreativeId:         text('meta_creative_id'),
  metaAdId:               text('meta_ad_id'),

  lastSyncedAt:           timestamp('last_synced_at', { withTimezone: true }),
  launchedAt:             timestamp('launched_at', { withTimezone: true }),

  createdAt:              timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:              timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sellerCreatedIdx:  index('meta_campaigns_seller_id_idx').on(table.sellerId, table.createdAt),
  metaCampaignIdx:   index('meta_campaigns_meta_campaign_id_idx').on(table.metaCampaignId),
}));

// Latest Insights API snapshot per campaign — refreshed on demand from the
// manage screen; not a time-series (Meta remains the source of truth).
export const metaCampaignInsights = pgTable('meta_campaign_insights', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  campaignId:         uuid('campaign_id').notNull(),

  spendCents:         integer('spend_cents').notNull().default(0),
  impressions:        integer('impressions').notNull().default(0),
  reach:              integer('reach').notNull().default(0),
  clicks:             integer('clicks').notNull().default(0),
  ctr:                numeric('ctr', { precision: 8, scale: 4 }),
  cpcCents:           integer('cpc_cents'),
  purchases:          integer('purchases').notNull().default(0),
  purchaseValueCents: integer('purchase_value_cents').notNull().default(0),
  roas:               numeric('roas', { precision: 10, scale: 4 }),

  fetchedAt:          timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  campaignUnique: uniqueIndex('meta_campaign_insights_campaign_id_unique').on(table.campaignId),
}));

// Conversions API event log, keyed for dedup against the client-side Meta Pixel
// fire using the same event_id (per Meta's dedup guidance).
export const metaConversionEvents = pgTable('meta_conversion_events', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  sellerId:           text('seller_id').notNull(),
  eventId:            text('event_id').notNull(),
  /** 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase' */
  eventName:          text('event_name').notNull(),
  occurredAt:         timestamp('occurred_at', { withTimezone: true }).notNull(),
  productId:          text('product_id'),
  valueCents:         integer('value_cents'),
  currency:           text('currency').default('USD'),

  sentToMeta:         boolean('sent_to_meta').notNull().default(false),
  metaResponseStatus: text('meta_response_status'),

  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  dedupUnique: uniqueIndex('meta_conversion_events_dedup_unique').on(table.sellerId, table.eventId, table.eventName),
}));
