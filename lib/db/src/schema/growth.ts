/**
 * Growth links: UTM tracked links, link-in-bio pages and store pixels.
 * See migrations/122_growth_links.sql. Additive only; nothing here changes
 * an existing table.
 */
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const trackedLinks = pgTable('tracked_links', {
  id:              uuid('id').primaryKey().defaultRandom(),
  sellerId:        text('seller_id').notNull(),
  code:            text('code').notNull(),
  label:           text('label').notNull().default(''),
  destinationType: text('destination_type').notNull(),
  destinationRef:  text('destination_ref'),
  utmSource:       text('utm_source'),
  utmMedium:       text('utm_medium'),
  utmCampaign:     text('utm_campaign'),
  utmTerm:         text('utm_term'),
  utmContent:      text('utm_content'),
  archivedAt:      timestamp('archived_at'),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  codeUidx:  uniqueIndex('tracked_links_code_uidx').on(t.code),
  sellerIdx: index('tracked_links_seller_idx').on(t.sellerId, t.createdAt),
}));

export const linkClicks = pgTable('link_clicks', {
  id:           uuid('id').primaryKey().defaultRandom(),
  linkId:       uuid('link_id').notNull(),
  sellerId:     text('seller_id').notNull(),
  country:      text('country'),
  referrerHost: text('referrer_host'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  linkIdx:   index('link_clicks_link_idx').on(t.linkId, t.createdAt),
  sellerIdx: index('link_clicks_seller_idx').on(t.sellerId, t.createdAt),
}));

export const checkoutAttributions = pgTable('checkout_attributions', {
  checkoutSessionId: uuid('checkout_session_id').primaryKey(),
  stripeSessionId:   text('stripe_session_id'),
  sellerId:          text('seller_id').notNull(),
  linkId:            uuid('link_id'),
  linkCode:          text('link_code'),
  utmSource:         text('utm_source'),
  utmMedium:         text('utm_medium'),
  utmCampaign:       text('utm_campaign'),
  createdAt:         timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  stripeIdx: index('checkout_attributions_stripe_idx').on(t.stripeSessionId),
  linkIdx:   index('checkout_attributions_link_idx').on(t.linkId),
  sellerIdx: index('checkout_attributions_seller_idx').on(t.sellerId),
}));

export const bioPages = pgTable('bio_pages', {
  sellerId:           text('seller_id').primaryKey(),
  slug:               text('slug').notNull(),
  displayName:        text('display_name').notNull().default(''),
  bio:                text('bio').notNull().default(''),
  avatarUrl:          text('avatar_url'),
  showShopButton:     boolean('show_shop_button').notNull().default(true),
  shopButtonLabel:    text('shop_button_label').notNull().default('Shop my store'),
  featuredProductIds: jsonb('featured_product_ids').$type<string[]>().notNull().default([]),
  socials:            jsonb('socials').$type<Record<string, string>>().notNull().default({}),
  theme:              text('theme').notNull().default('mono'),
  accentColor:        text('accent_color'),
  published:          boolean('published').notNull().default(true),
  createdAt:          timestamp('created_at').defaultNow().notNull(),
  updatedAt:          timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  slugUidx: uniqueIndex('bio_pages_slug_uidx').on(t.slug),
}));

export const bioLinks = pgTable('bio_links', {
  id:        uuid('id').primaryKey().defaultRandom(),
  sellerId:  text('seller_id').notNull(),
  title:     text('title').notNull(),
  url:       text('url').notNull(),
  enabled:   boolean('enabled').notNull().default(true),
  position:  integer('position').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  sellerIdx: index('bio_links_seller_idx').on(t.sellerId, t.position),
}));

export const bioEvents = pgTable('bio_events', {
  id:           uuid('id').primaryKey().defaultRandom(),
  sellerId:     text('seller_id').notNull(),
  bioLinkId:    uuid('bio_link_id'),
  kind:         text('kind').notNull(),
  ref:          text('ref'),
  country:      text('country'),
  referrerHost: text('referrer_host'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  sellerIdx: index('bio_events_seller_idx').on(t.sellerId, t.createdAt),
  linkIdx:   index('bio_events_link_idx').on(t.bioLinkId),
}));

export const storePixels = pgTable('store_pixels', {
  sellerId:      text('seller_id').primaryKey(),
  metaPixelId:   text('meta_pixel_id'),
  tiktokPixelId: text('tiktok_pixel_id'),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
});
