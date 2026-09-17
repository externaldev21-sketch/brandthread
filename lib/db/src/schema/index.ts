import { pgTable, uuid, text, integer, timestamp, date, json, boolean, primaryKey, index, numeric, unique, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core';
export * from './manufacturers';
export * from './freelancers';
export * from './subscriptionEntitlements';
export * from './security';
import { manufacturers } from './manufacturers';
import { relations, sql } from 'drizzle-orm';

// ─── Users (brand team members + buyers, linked to Clerk) ─────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  // role: 'owner' | 'admin' | 'member' (seller side) | 'buyer' | 'seller'
  role: text('role').notNull().default('owner'),
  avatarUrl: text('avatar_url'),
  // Buyer / unified profile fields
  displayName: text('display_name'),
  bio: text('bio'),
  profileImageUrl: text('profile_image_url'),
  accountType: text('account_type'), // 'buyer' | 'seller' | 'both'
  // Referral / invite system
  inviteCode:     text('invite_code').unique(),   // lazily generated on first /referrals/code call
  referredByCode: text('referred_by_code'),       // code used when this user signed up
  // DM privacy: 'requests' (default) | 'followers_only'
  dmPrivacy:      text('dm_privacy').notNull().default('requests'),
  // Brand onboarding fields (seller side)
  brandName: text('brand_name'),
  brandType: text('brand_type'),
  brandStage: text('brand_stage'),
  sellModel: text('sell_model'),
  onboardingComplete: boolean('onboarding_complete').notNull().default(false),
  // Stripe Connect (seller payouts — separate from subscription billing)
  stripeAccountId:     text('stripe_account_id'),
  stripeAccountStatus: text('stripe_account_status'), // 'pending' | 'active' | 'restricted'
  // Stripe Customer + Subscription (seller's own recurring platform fee)
  // Completely distinct from stripeAccountId / Connect.
  stripeCustomerId:        text('stripe_customer_id'),
  subscriptionId:          text('subscription_id'),
  subscriptionStatus:      text('subscription_status').default('none'),
  subscriptionPeriodEnd:   timestamp('subscription_period_end'),
  subscriptionPlanId:      text('subscription_plan_id').default('starter'),
  // Authoritative trial window copied from Stripe subscription events. Keeping
  // this on the seller record lets reminder workers run without trusting a
  // client-provided date (and lets the dashboard render while Stripe is down).
  subscriptionTrialStartedAt: timestamp('subscription_trial_started_at', { withTimezone: true }),
  subscriptionTrialEndsAt:    timestamp('subscription_trial_ends_at', { withTimezone: true }),
  subscriptionTrialBannerDismissedTrialEnd: text('subscription_trial_banner_dismissed_trial_end'),
  // Trust signals & Stripe Identity verification
  verified:                     boolean('verified').notNull().default(false),
  /** 'unverified' | 'pending' | 'verified' | 'failed' */
  verificationStatus:           text('verification_status').notNull().default('unverified'),
  stripeVerificationSessionId:  text('stripe_verification_session_id'),
  // Platform-controlled seller eligibility. These must be evaluated together
  // with a completed identity verification before exposing a verified badge.
  activeStanding:               boolean('active_standing').notNull().default(true),
  policyRestricted:             boolean('policy_restricted').notNull().default(false),
  returnPolicy:       text('return_policy'),
  cancellationPolicy: text('cancellation_policy'),
  // Public profile link (bio website)
  website: text('website'),
  // Unique @handle (letters, numbers, underscores; 3–30 chars). Nullable so
  // existing rows are unaffected; the DB-level unique index enforces platform-wide uniqueness.
  username: text('username').unique(),
  // Storefront visit counter — incremented by a public endpoint each time a buyer
  // views this seller's storefront. Drives the real conversion rate stat.
  storefrontVisitCount: integer('storefront_visit_count').notNull().default(0),
  // Vacation / away mode
  vacationMode:    boolean('vacation_mode').notNull().default(false),
  vacationMessage: text('vacation_message'),
  vacationUntil:   timestamp('vacation_until', { withTimezone: true }),
  notificationPreferences: json('notification_preferences')
    .$type<Record<string, boolean>>()
    .notNull()
    .default({}),
  notificationDigest: text('notification_digest').notNull().default('realtime'),
  // A tombstone is retained after an account erasure request.  Keeping the
  // Clerk subject prevents a delayed client sync from creating a fresh profile.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Storefront Visits ─────────────────────────────────────────────────────────
// A signed-in viewer is counted once per seller per UTC day. This makes seller
// conversion meaningful without treating arbitrary public POST requests as traffic.
export const storefrontVisits = pgTable('storefront_visits', {
  id:        uuid('id').primaryKey().defaultRandom(),
  sellerId:  text('seller_id').notNull(),
  visitorId: text('visitor_id').notNull(),
  visitDate: date('visit_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sellerVisitDayUnique: uniqueIndex('storefront_visits_seller_visitor_day_unique')
    .on(table.sellerId, table.visitorId, table.visitDate),
  sellerVisitsIndex: index('storefront_visits_seller_id_idx').on(table.sellerId),
}));

// ─── Products ─────────────────────────────────────────────────────────────────

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().default(''), // Clerk user ID of brand owner / seller
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull().default('apparel'),
  status: text('status').notNull().default('draft'), // 'draft' | 'active' | 'archived'
  // Deleted products are immediately invisible publicly. The original status is
  // retained so a seller can restore it during the short recovery window.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  recoverableUntil: timestamp('recoverable_until', { withTimezone: true }),
  // `seller_deleted` can be restored briefly; `moderation_removed` is final.
  removalKind: text('removal_kind'),
  images: json('images').$type<string[]>().notNull().default([]),
  tags: json('tags').$type<string[]>().notNull().default([]),
  styleTags:             json('style_tags').$type<string[]>().notNull().default([]),
  // ── Pre-order / demand gauging ───────────────────────────────────────────
  isPreOrder:            boolean('is_pre_order').notNull().default(false),
  preOrderClosingDate:   timestamp('pre_order_closing_date'),
  preOrderEstShipDate:   timestamp('pre_order_est_ship_date'),
  dropId:                uuid('drop_id'),  // FK → drops.id (set null on delete; handled by migration)
  demandCount:           integer('demand_count').notNull().default(0),
  // ── Size chart ────────────────────────────────────────────────────────────
  // { columns: string[], rows: [{size:string, values:string[]}], unit?:string, notes?:string }
  sizeChart:             json('size_chart').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  dropIdx: index('products_drop_id_idx').on(table.dropId),
  deletedIdx: index('products_deleted_at_idx').on(table.deletedAt),
}));

// ─── Intellectual-property cases and immutable case history ───────────────────
export const ipCases = pgTable('ip_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicReference: text('public_reference').notNull().unique(),
  // SHA-256 of the high-entropy status bearer token; the raw token is returned
  // exactly once to the claimant and is never persisted.
  statusTokenHash: text('status_token_hash').notNull(),
  claimantName: text('claimant_name').notNull(),
  claimantEmail: text('claimant_email').notNull(),
  claimantContact: text('claimant_contact'),
  listingProductId: uuid('listing_product_id').references(() => products.id, { onDelete: 'set null' }),
  listingUrl: text('listing_url'),
  rightsType: text('rights_type').notNull(),
  description: text('description').notNull(),
  evidenceReferences: json('evidence_references').$type<string[]>().notNull().default([]),
  status: text('status').notNull().default('submitted'),
  moderatorNotes: text('moderator_notes'),
  assignedModeratorId: text('assigned_moderator_id'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  statusLookupIdx: index('ip_cases_reference_token_idx').on(table.publicReference, table.statusTokenHash),
  moderationIdx: index('ip_cases_moderation_idx').on(table.status, table.createdAt),
  listingIdx: index('ip_cases_listing_idx').on(table.listingProductId),
}));

export const ipCaseAuditHistory = pgTable('ip_case_audit_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => ipCases.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  previousStatus: text('previous_status'),
  nextStatus: text('next_status'),
  actorId: text('actor_id'),
  details: json('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  caseCreatedIdx: index('ip_case_audit_case_created_idx').on(table.caseId, table.createdAt),
}));

// ─── Product Variants (size / color / SKU combos) ─────────────────────────────

export const productVariants = pgTable('product_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  size: text('size'),
  color: text('color'),
  sku: text('sku').notNull().unique(),
  priceCents: integer('price_cents').notNull(),
  stock: integer('stock').notNull().default(0),
  lowStockThreshold: integer('low_stock_threshold').notNull().default(10),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  productIdx: index('product_variants_product_id_idx').on(table.productId),
}));

// ─── Customers ────────────────────────────────────────────────────────────────

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().default(''), // Clerk user ID of brand owner
  email: text('email').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  address: json('address').$type<{
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  }>(),
  totalSpentCents: integer('total_spent_cents').notNull().default(0),
  orderCount: integer('order_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Drops (Pre Order / Pre Made) ─────────────────────────────────────────────

export const drops = pgTable('drops', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().default(''), // Clerk user ID of brand owner
  name: text('name').notNull(),
  type: text('type').notNull(), // 'pre-order' | 'pre-made'
  status: text('status').notNull().default('draft'), // 'draft' | 'active' | 'closed' | 'fulfilled'
  releaseAt: timestamp('release_at'),             // when the drop goes live to buyers (countdown)
  endsAt: timestamp('ends_at', { withTimezone: true }),
  scheduledBroadcastAt: timestamp('scheduled_broadcast_at'), // when the follower notification should be sent
  estimatedShipDate: timestamp('estimated_ship_date'),
  totalCollectedCents: integer('total_collected_cents').notNull().default(0),
  orderCount: integer('order_count').notNull().default(0),
  mfgProgress: integer('mfg_progress').notNull().default(0), // 0–100
  payoutStatus: text('payout_status').notNull().default('pending'), // 'pending'|'held'|'processing'|'paid'
  estimatedPayoutDate: timestamp('estimated_payout_date'),
  stripePayoutId: text('stripe_payout_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const dropAlertSubscriptions = pgTable('drop_alert_subscriptions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  dropId:    uuid('drop_id').notNull().references(() => drops.id, { onDelete: 'cascade' }),
  userId:    text('user_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniq:    unique().on(t.dropId, t.userId),
  userIdx: index('drop_alert_subscriptions_user_idx').on(t.userId),
}));

// ─── Orders ───────────────────────────────────────────────────────────────────

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().default(''), // Clerk user ID of brand owner / seller
  buyerId: text('buyer_id'),                        // Clerk user ID of buyer (null for seller-created)
  guestEmail: text('guest_email'),                  // checkout email when buyerId is null
  orderNumber: text('order_number').notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  dropId: uuid('drop_id').references(() => drops.id),
  status: text('status').notNull().default('pending'), // 'pending'|'processing'|'fulfilled'|'shipped'|'cancelled'
  totalCents: integer('total_cents').notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  shippingCents: integer('shipping_cents').notNull().default(0),
  // Stripe's authoritative tax result and the actual amount captured. Both
  // remain explicit integer-cent values so tax is never inferred from
  // shipping or a locally configured rate.
  taxCents: integer('tax_cents').notNull().default(0),
  grossChargedCents: integer('gross_charged_cents').notNull().default(0),
  paidAt: timestamp('paid_at'),
  notes: text('notes'),
  shippingAddress: json('shipping_address').$type<{
    name?: string;
    street: string;
    line2?: string | null;
    city: string;
    state: string;
    zip: string;
    country: string;
  }>(),
  trackingNumber: text('tracking_number'),
  carrier: text('carrier'),
  trackingStatus: text('tracking_status'), // 'label_created'|'accepted'|'in_transit'|'out_for_delivery'|'delivered'|'exception'|'returned_to_sender'
  estimatedDelivery: text('estimated_delivery'), // ISO date string, e.g. '2026-08-20'
  // Fulfillment timestamps
  packedAt:  timestamp('packed_at'),
  shippedAt: timestamp('shipped_at'),
  // Discount code applied at checkout
  discountCode:        text('discount_code'),
  discountAmountCents: integer('discount_amount_cents').notNull().default(0),
  // Post/video that drove the Shop button click (attribution)
  sourcePostId: text('source_post_id'),
  // Cancellation fields
  cancellationReason: text('cancellation_reason'),
  cancellationNotes:  text('cancellation_notes'),
  // Stripe payment fields
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  stripeCheckoutSessionId: text('stripe_checkout_session_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  customerIdx: index('orders_customer_id_idx').on(table.customerId),
  dropIdx: index('orders_drop_id_idx').on(table.dropId),
}));

// ─── Order Items ──────────────────────────────────────────────────────────────

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => productVariants.id),
  productName: text('product_name').notNull(),
  variantLabel: text('variant_label'),
  quantity: integer('quantity').notNull(),
  priceCents: integer('price_cents').notNull(), // server-resolved price at time of order
}, (table) => ({
  orderIdx: index('order_items_order_id_idx').on(table.orderId),
  variantIdx: index('order_items_variant_id_idx').on(table.variantId),
}));

export const shippingLabelQuotes = pgTable('shipping_label_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull(),
  providerShipmentId: text('provider_shipment_id').notNull(),
  providerRateId: text('provider_rate_id').notNull(),
  carrier: text('carrier').notNull(),
  service: text('service').notNull(),
  priceCents: integer('price_cents').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  orderIdx: index('shipping_label_quotes_order_idx').on(table.orderId),
  rateUnique: uniqueIndex('shipping_label_quotes_rate_unique').on(table.ownerId, table.providerRateId),
}));
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(), // Clerk user ID of poster
  mediaUrl: text('media_url').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  mediaUrls: json('media_urls').$type<string[]>().notNull().default([]),
  /** Ordered object storage paths for each composed slideshow slide (empty for video/photo) */
  mediaPaths: json('media_paths').$type<string[]>().notNull().default([]),
  /** Per-slide overlay metadata. Each entry: { slideIndex, overlays: TextOverlay[] } */
  slideOverlays: json('slide_overlays').$type<Array<{
    slideIndex: number;
    overlays: Array<{
      id: string; text: string; x: number; y: number;
      color: string; fontStyle: string; align: string;
      bgStyle: string; fontSize: number;
      startTime?: number; endTime?: number;
    }>;
  }>>().notNull().default([]),
  mediaType: text('media_type').notNull().default('photo'), // 'photo' | 'video' | 'slideshow'
  aspectRatio: text('aspect_ratio').notNull().default('9:16'),
  caption: text('caption'),
  hashtags: json('hashtags').$type<string[]>().notNull().default([]),
  styleTags: json('style_tags').$type<string[]>().notNull().default([]),
  sound: json('sound').$type<{
    soundId: string;
    soundTitle: string;
    artist: string;
    startTime: number;
    volume: number;
  } | null>(),
  visibility: json('visibility').$type<{
    isPublic?: boolean;
    allowComments: boolean;
    allowReposts: boolean;
    showLikeCount: boolean;
  }>().notNull().default({
    isPublic: true,
    allowComments: true,
    allowReposts: true,
    showLikeCount: true,
  }),
  postStatus: text('post_status').notNull().default('published'), // 'draft' | 'scheduled' | 'published' | 'archived' | 'deleted'
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Interactions ─────────────────────────────────────────────────────────────

export const interactions = pgTable('interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),   // Clerk user ID of actor
  postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),        // 'like' | 'comment' | 'follow' | 'watch_time'
  value: text('value'),               // e.g. comment text, seconds watched, followed user ID
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  postIdx: index('interactions_post_id_idx').on(table.postId),
}));

// ─── Checkout Sessions (server-side cart record for Stripe webhook reconstruction)

export const checkoutSessions = pgTable('checkout_sessions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  stripeSessionId: text('stripe_session_id').unique(),  // set after Stripe responds
  buyerId:         text('buyer_id'),                     // Clerk user ID; null for guest checkout
  guestEmail:      text('guest_email'),
  // SHA-256 only. The raw high-entropy token is returned once at creation.
  guestAccessTokenHash: text('guest_access_token_hash'),
  sellerId:        text('seller_id').notNull(),          // Clerk user ID of seller
  // Serialized cart items — single DB row replaces per-field Stripe metadata
  items: json('items').$type<Array<{
    variantId:    string;
    productName:  string;
    variantLabel: string;
    quantity:     number;   // already aggregated by variantId
    priceCents:   number;
  }>>().notNull(),
  // Buyer-provided shipping address, persisted before Stripe session is opened.
  // The webhook uses this to attach a fulfillment address to the order.
  shippingAddress: json('shipping_address').$type<{
    name?:    string;
    street:   string;
    line2?:   string | null;
    city:     string;
    state:    string;
    zip:      string;
    country:  string;
  }>(),
  // Per-attempt idempotency key supplied by the client (format: {checkoutId}_{sellerId}).
  // The UNIQUE index on this column guarantees that concurrent duplicate submissions
  // hit a DB constraint rather than creating two Stripe sessions.
  clientIdempotencyKey: text('client_idempotency_key').unique(),
  // Optional loyalty redemption reserved for this Stripe Checkout Session.
  // The paid-order webhook consumes it atomically with order creation.
  loyaltyToken: text('loyalty_token'),
  loyaltyDiscountCents: integer('loyalty_discount_cents').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Buyer address book ─────────────────────────────────────────────────────
// Addresses belong to the Clerk buyer ID, never to a caller supplied user ID.
// The partial unique index is also created in the SQL migration, since Drizzle's
// schema DSL does not express a partial unique predicate consistently here.
export const buyerAddresses = pgTable('buyer_addresses', {
  id:            uuid('id').primaryKey().defaultRandom(),
  buyerId:       text('buyer_id').notNull(),
  label:         text('label').notNull().default('Shipping'),
  recipientName: text('recipient_name').notNull(),
  street:        text('street').notNull(),
  line2:         text('line2'),
  city:          text('city').notNull(),
  state:         text('state').notNull(),
  postalCode:    text('postal_code').notNull(),
  country:       text('country').notNull().default('US'),
  phone:         text('phone'),
  isDefault:     boolean('is_default').notNull().default(false),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  buyerListIdx: index('buyer_addresses_buyer_list_idx').on(table.buyerId, table.isDefault, table.createdAt),
}));

// ─── Klaviyo Integration ────────────────────────────────────────────────────────

export const klaviyoIntegrations = pgTable('klaviyo_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().unique(), // Clerk user ID of brand owner
  apiKey: text('api_key').notNull(), // Klaviyo Private API Key
  accountId: text('account_id'),
  companyName: text('company_name'),
  emailSubscriberCount: integer('email_subscriber_count').notNull().default(0),
  smsSubscriberCount: integer('sms_subscriber_count').notNull().default(0),
  listCount: integer('list_count').notNull().default(0),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Push Tokens (Expo push notification device registration) ─────────────────

export const pushTokens = pgTable('push_tokens', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    text('user_id').notNull(),
  token:     text('token').notNull().unique(),
  platform:  text('platform').notNull().default('unknown'), // 'ios' | 'android' | 'web'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Seller Quote Requests (seller → manufacturer quote/sample requests) ───────

export const sellerQuoteRequests = pgTable('seller_quote_requests', {
  id:               uuid('id').primaryKey().defaultRandom(),
  sellerId:         text('seller_id').notNull(),
  manufacturerId:   uuid('manufacturer_id').notNull().references(() => manufacturers.id, { onDelete: 'cascade' }),
  // 'quote' | 'sample'
  type:             text('type').notNull().default('quote'),
  productName:      text('product_name').notNull(),
  productType:      text('product_type').notNull().default('apparel'),
  quantity:         integer('quantity'),
  colorways:        text('colorways'),
  details:          text('details'),
  // 'submitted' | 'quoted' | 'accepted' | 'declined' | 'cancelled'
  status:           text('status').notNull().default('submitted'),
  quotedPriceCents: integer('quoted_price_cents'),
  quotedTurnaround: text('quoted_turnaround'),
  quoteValidUntil:  timestamp('quote_valid_until'),
  counteroffer:     json('counteroffer').$type<{
    desiredUnitPriceCents?: number;
    desiredMoq?: number;
    desiredProductionDays?: number;
    desiredPaymentTerms?: string;
    notes?: string;
    status: 'pending' | 'accepted' | 'declined';
    createdAt: string;
  }>(),
  notes:            text('notes'),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  manufacturerIdx: index('seller_quote_requests_mfr_idx').on(table.manufacturerId),
  sellerIdx: index('seller_quote_requests_seller_idx').on(table.sellerId),
}));

// ─── Relations ────────────────────────────────────────────────────────────────

export const productsRelations = relations(products, ({ many }) => ({
  variants: many(productVariants),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  orderItems: many(orderItems),
}));

export const shopifyImportJobs = pgTable('shopify_import_jobs', {
  id:              uuid('id').primaryKey().defaultRandom(),
  ownerId:         text('owner_id').notNull(),
  sourceUrl:       text('source_url').notNull(),
  status:          text('status').notNull().default('queued'),
  stage:           text('stage').notNull().default('validating'),
  importedCount:   integer('imported_count').notNull().default(0),
  failedCount:     integer('failed_count').notNull().default(0),
  nextCursor:      text('next_cursor'),
  hasMore:         boolean('has_more').notNull().default(false),
  sourceStoreName: text('source_store_name'),
  errorCode:       text('error_code'),
  errorMessage:    text('error_message'),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerCreatedIdx: index('shopify_import_jobs_owner_created_idx').on(table.ownerId, table.createdAt),
}));
export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const dropsRelations = relations(drops, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  drop: one(drops, { fields: [orders.dropId], references: [drops.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  variant: one(productVariants, { fields: [orderItems.variantId], references: [productVariants.id] }),
}));

export const postsRelations = relations(posts, ({ many }) => ({
  interactions: many(interactions),
}));

export const interactionsRelations = relations(interactions, ({ one }) => ({
  post: one(posts, { fields: [interactions.postId], references: [posts.id] }),
}));

// ─── Referrals (invite attribution; one inviter per invitee) ─────────────────

export const referrals = pgTable('referrals', {
  id:         uuid('id').primaryKey().defaultRandom(),
  inviterId:  text('inviter_id').notNull(),         // Clerk userId who shared the code
  inviteeId:  text('invitee_id').notNull().unique(), // Clerk userId of the new user
  inviteCode: text('invite_code').notNull(),         // the code that was used
  joinedAt:   timestamp('joined_at').defaultNow().notNull(),
  // Reward/status columns can be added here later without breaking existing rows
});

// ─── Blocks (server-side enforcement; replaces local AsyncStorage blocks) ─────

export const blocks = pgTable('blocks', {
  blockerId:  text('blocker_id').notNull(),
  blockedId:  text('blocked_id').notNull(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.blockerId, t.blockedId] }),
}));

// ─── Conversations & Messages (buyer ↔ seller DM) ────────────────────────────

export const conversations = pgTable('conversations', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  type:               text('type').notNull().default('buyer_to_seller'),
  lastMessage:        text('last_message'),
  lastMessageAt:      timestamp('last_message_at'),
  // Follow-based message requests (buyer_to_buyer only)
  isRequest:          boolean('is_request').notNull().default(false),
  requestedBy:        text('requested_by'),  // Clerk userId of the sender awaiting acceptance
  contextOrderId:     text('context_order_id'),
  contextOrderNumber: text('context_order_number'),
  contextOrderStatus: text('context_order_status'),
  contextProductId:   text('context_product_id'),
  contextProductName: text('context_product_name'),
  contextSellerName:  text('context_seller_name'),
  moderationStatus:   text('moderation_status').notNull().default('clear'),
  moderationReason:   text('moderation_reason'),
  reportedAt:         timestamp('reported_at', { withTimezone: true }),
  reportCount:        integer('report_count').notNull().default(0),
  deletedAt:          timestamp('deleted_at', { withTimezone: true }),
  retentionUntil:     timestamp('retention_until', { withTimezone: true }),
  createdAt:          timestamp('created_at').defaultNow().notNull(),
  updatedAt:          timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  updatedAtIdx:  index('conversations_updated_at_idx').on(table.updatedAt),
  moderationIdx: index('conversations_moderation_review_idx').on(table.moderationStatus, table.reportedAt),
  retentionIdx: index('conversations_retention_idx').on(table.retentionUntil),
}));

export const conversationParticipants = pgTable('conversation_participants', {
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId:         text('user_id').notNull(),
  name:           text('name').notNull().default(''),
  handle:         text('handle').notNull().default(''),
  initials:       text('initials').notNull().default(''),
  color:          text('color').notNull().default('#8B5CF6'),
  accountType:    text('account_type').notNull().default('buyer'),
  unreadCount:    integer('unread_count').notNull().default(0),
  lastReadAt:     timestamp('last_read_at'),
  joinedAt:       timestamp('joined_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.conversationId, table.userId] }),
  userUnreadIdx: index('conversation_participants_unread_idx').on(table.userId, table.unreadCount, table.lastReadAt),
}));

export const messages = pgTable('messages', {
  id:             uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderId:       text('sender_id').notNull(),
  senderName:     text('sender_name').notNull().default(''),
  senderInitials: text('sender_initials').notNull().default(''),
  senderColor:    text('sender_color').notNull().default('#8B5CF6'),
  body:           text('body').notNull(),
  attachment:     json('attachment'),
  attachments:    json('attachments').$type<unknown[]>().notNull().default([]),
  replyToId:      uuid('reply_to_id'),
  status:         text('status').notNull().default('sent'),
  deliveredAt:    timestamp('delivered_at', { withTimezone: true }),
  readAt:         timestamp('read_at', { withTimezone: true }),
  moderationStatus: text('moderation_status').notNull().default('clear'),
  moderationReason: text('moderation_reason'),
  reportedAt:     timestamp('reported_at', { withTimezone: true }),
  deletedAt:      timestamp('deleted_at', { withTimezone: true }),
  deletedBy:      text('deleted_by'),
  retentionUntil: timestamp('retention_until', { withTimezone: true }),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  conversationOrderIdx: index('messages_conversation_order_idx').on(table.conversationId, table.createdAt),
  readWorkIdx:          index('messages_read_work_idx').on(table.conversationId, table.readAt, table.createdAt),
  moderationIdx:        index('messages_moderation_review_idx').on(table.moderationStatus, table.reportedAt),
  retentionIdx:         index('messages_retention_idx').on(table.retentionUntil),
}));

export const messageReports = pgTable('message_reports', {
  id:          uuid('id').primaryKey().defaultRandom(),
  messageId:   uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  reporterId:  text('reporter_id').notNull(),
  reason:      text('reason').notNull(),
  description: text('description'),
  status:      text('status').notNull().default('pending'),
  reviewedAt:  timestamp('reviewed_at', { withTimezone: true }),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  reporterUnique: unique('message_reports_message_reporter_unique').on(table.messageId, table.reporterId),
  reviewIdx:  index('message_reports_review_idx').on(table.status, table.createdAt),
  messageIdx: index('message_reports_message_idx').on(table.messageId, table.createdAt),
}));

// ─── Saved / wishlisted items ─────────────────────────────────────────────────

export const savedItems = pgTable('saved_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      text('user_id').notNull(),
  itemType:    text('item_type').notNull().default('product'),
  targetId:    text('target_id').notNull(),
  title:       text('title').notNull().default(''),
  subtitle:    text('subtitle'),
  accentColor: text('accent_color'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
});

// ─── Server-side cart (full-replace sync model) ───────────────────────────────

export const cartItems = pgTable('cart_items', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  userId:                text('user_id').notNull(),
  variantId:             text('variant_id').notNull(),
  savedForLater:         boolean('saved_for_later').notNull().default(false),
  itemData:              json('item_data').notNull().default({}),
  updatedAt:             timestamp('updated_at').defaultNow().notNull(),
  notifiedAbandonedAt:   timestamp('notified_abandoned_at'),
});

// ─── In-app notification feed ─────────────────────────────────────────────────

export const notificationsFeed = pgTable('notifications_feed', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        text('user_id').notNull(),
  category:      text('category').notNull().default('system'),
  type:          text('type').notNull(),
  title:         text('title').notNull(),
  body:          text('body').notNull().default(''),
  isRead:        boolean('is_read').notNull().default(false),
  isMuted:       boolean('is_muted').notNull().default(false),
  actorName:     text('actor_name'),
  actorHandle:   text('actor_handle'),
  actorInitials: text('actor_initials'),
  actorColor:    text('actor_color'),
  targetId:      text('target_id'),
  targetType:    text('target_type'),
  cta:           text('cta'),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  subscriptionPaymentFailureUnique: uniqueIndex('notifications_feed_subscription_payment_failed_unique')
    .on(table.userId, table.type, table.targetId)
    .where(sql`${table.type} = 'subscription_payment_failed' AND ${table.targetId} IS NOT NULL`),
  newOrderReceivedUnique: uniqueIndex('notifications_feed_new_order_received_unique')
    .on(table.userId, table.type, table.targetId)
    .where(sql`${table.type} = 'new_order_received' AND ${table.targetId} IS NOT NULL`),
  subscriptionTrialDayFourUnique: uniqueIndex('notifications_feed_subscription_trial_day_4_unique')
    .on(table.userId, table.type, table.targetId)
    .where(sql`${table.type} = 'subscription_trial_day_4' AND ${table.targetId} IS NOT NULL`),
}));

export const notificationDeliveries = pgTable('notification_deliveries', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  notificationId:     text('notification_id').notNull(),
  userId:             text('user_id').notNull(),
  ownerId:            text('owner_id').notNull(),
  pushToken:          text('push_token').notNull(),
  status:             text('status').notNull().default('queued'), // queued | sent | provider_error
  providerMessageId:  text('provider_message_id'),
  providerStatus:     text('provider_status'),
  providerError:      text('provider_error'),
  queuedAt:           timestamp('queued_at').defaultNow().notNull(),
  sentAt:             timestamp('sent_at'),
  providerResultAt:   timestamp('provider_result_at'),
  createdAt:          timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  notificationTokenUnique: uniqueIndex('notification_deliveries_notification_token_idx')
    .on(table.notificationId, table.pushToken),
  userIdx: index('notification_deliveries_user_idx').on(table.userId),
  ownerIdx: index('notification_deliveries_owner_idx').on(table.ownerId),
  notificationIdx: index('notification_deliveries_notification_idx').on(table.notificationId),
}));
export const reviews = pgTable('reviews', {
  id:        uuid('id').primaryKey().defaultRandom(),
  buyerId:   text('buyer_id').notNull(),
  sellerId:  text('seller_id').notNull(),
  orderId:   uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  rating:    integer('rating').notNull(),
  body:      text('body'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  orderIdx: index('reviews_order_id_idx').on(table.orderId),
  productIdx: index('reviews_product_id_idx').on(table.productId),
}));

// ─── Shoppable post tagging ────────────────────────────────────────────────────

export const postTaggedProducts = pgTable('post_tagged_products', {
  id:        uuid('id').primaryKey().defaultRandom(),
  postId:    uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  position:  integer('position').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  postIdx: index('ptp_post_id_idx').on(table.postId),
  productIdx: index('ptp_product_id_idx').on(table.productId),
}));

// ─── Server-side stories (buyers + sellers, 24 h TTL) ────────────────────────

export const stories = pgTable('stories', {
  id:                uuid('id').primaryKey().defaultRandom(),
  authorId:          text('author_id').notNull(),
  authorName:        text('author_name').notNull(),
  authorHandle:      text('author_handle'),
  authorInitials:    text('author_initials'),
  authorColor:       text('author_color'),
  authorAccountType: text('author_account_type').notNull().default('buyer'),
  media:             json('media').notNull().default([]),  // StoryMedia[]
  repliesDisabled:   boolean('replies_disabled').notNull().default(false),
  privacyVisibility: text('privacy_visibility').notNull().default('public'),
  privacyReplyPerm:  text('privacy_reply_perm').notNull().default('everyone'),
  likesCount:        integer('likes_count').notNull().default(0),
  viewsCount:        integer('views_count').notNull().default(0),
  createdAt:         timestamp('created_at').defaultNow().notNull(),
  expiresAt:         timestamp('expires_at').notNull(),
});

export const storyLikes = pgTable('story_likes', {
  storyId:   uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  userId:    text('user_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.storyId, t.userId] }),
}));

export const storyViews = pgTable('story_views', {
  storyId:  uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  userId:   text('user_id').notNull(),
  viewedAt: timestamp('viewed_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.storyId, t.userId] }),
}));

// ─── Buyer-to-buyer follows (social graph) ────────────────────────────────────

export const follows = pgTable('follows', {
  followerId:  text('follower_id').notNull(),   // Clerk user ID of the follower
  followingId: text('following_id').notNull(),  // Clerk user ID of the person being followed
  createdAt:   timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk:           primaryKey({ columns: [t.followerId, t.followingId] }),
  followingIdx: index('follows_following_idx').on(t.followingId),
}));

// ─── Discount codes ───────────────────────────────────────────────────────────

export const discountCodes = pgTable('discount_codes', {
  id:             text('id').primaryKey().default(''),
  sellerId:       text('seller_id').notNull(),
  code:           text('code').notNull(),
  /** 'percentage' | 'fixed' | 'free_shipping' */
  type:           text('type').notNull().default('percentage'),
  /** Percentage 0-100, or fixed amount in cents */
  value:          numeric('value', { precision: 10, scale: 2 }).notNull().default('0'),
  minOrderCents:  integer('min_order_cents').notNull().default(0),
  maxUses:        integer('max_uses'),
  usesCount:      integer('uses_count').notNull().default(0),
  expiresAt:      timestamp('expires_at'),
  active:         boolean('active').notNull().default(true),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  sellerIdx: index('discount_codes_seller_idx').on(t.sellerId),
  codeIdx:   index('discount_codes_code_idx').on(t.code),
}));

// ─── Returns ──────────────────────────────────────────────────────────────────

export const returns = pgTable('returns', {
  id:                  text('id').primaryKey().default(''),
  orderId:             uuid('order_id').notNull(),
  buyerId:             text('buyer_id').notNull(),
  sellerId:            text('seller_id').notNull(),
  reason:              text('reason').notNull(),
  notes:               text('notes'),
  /** 'refund' | 'exchange' | 'store_credit' | 'replacement' */
  resolutionRequested: text('resolution_requested').notNull().default('refund'),
  /** 'pending' | 'approved' | 'denied' | 'refunded' */
  status:              text('status').notNull().default('pending'),
  stripeRefundId:      text('stripe_refund_id'),
  refundAmountCents:   integer('refund_amount_cents'),
  sellerResponse:      text('seller_response'),
  evidenceUrls:        json('evidence_urls').$type<string[]>().notNull().default([]),
  requestedItems:      json('requested_items').$type<Array<{
    lineItemId?: string;
    productName?: string;
    variantTitle?: string;
    quantity?: number;
    unitPriceCents?: number;
  }>>().notNull().default([]),
  createdAt:           timestamp('created_at').defaultNow().notNull(),
  updatedAt:           timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  orderIdx:  index('returns_order_idx').on(t.orderId),
  sellerIdx: index('returns_seller_idx').on(t.sellerId),
  buyerIdx:  index('returns_buyer_idx').on(t.buyerId),
}));

// ─── Shipping rates ────────────────────────────────────────────────────────────

export const shippingRates = pgTable('shipping_rates', {
  id:             text('id').primaryKey().default(''),
  sellerId:       text('seller_id').notNull(),
  name:           text('name').notNull().default('Standard Shipping'),
  /** Base shipping cost in cents; 0 = free */
  flatRateCents:  integer('flat_rate_cents').notNull().default(0),
  /** When order subtotal >= this value, shipping is free; NULL = never auto-free */
  freeAboveCents: integer('free_above_cents'),
  active:         boolean('active').notNull().default(true),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  sellerIdx: index('shipping_rates_seller_idx').on(t.sellerId),
}));

// ─── Content reports ──────────────────────────────────────────────────────────

export const reports = pgTable('reports', {
  id:          uuid('id').primaryKey().defaultRandom(),
  reporterId:  text('reporter_id').notNull(),
  targetType:  text('target_type').notNull(),  // 'post'|'product'|'profile'|'story'|'message'|'seller'
  targetId:    text('target_id').notNull(),
  targetLabel: text('target_label'),
  reason:      text('reason').notNull(),
  description: text('description'),
  // 'pending' | 'reviewed' | 'actioned' | 'dismissed'
  status:      text('status').notNull().default('pending'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
});

// ─── Pre-order reserves (demand signal, no charge) ────────────────────────────

export const productReserves = pgTable('product_reserves', {
  id:         uuid('id').primaryKey().defaultRandom(),
  productId:  uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  userId:     text('user_id').notNull(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniq: unique().on(t.productId, t.userId),
}));

// ─── Waitlist entries (out-of-stock variant interest) ─────────────────────────

export const waitlistEntries = pgTable('waitlist_entries', {
  id:           uuid('id').primaryKey().defaultRandom(),
  productId:    uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  variantId:    uuid('variant_id'),
  userId:       text('user_id').notNull(),
  sellerId:     text('seller_id').notNull(),
  productName:  text('product_name').notNull().default(''),
  variantLabel: text('variant_label').notNull().default(''),
  notifiedAt:   timestamp('notified_at'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniq: unique().on(t.productId, t.variantId, t.userId),
  variantIdx: index('waitlist_entries_variant_id').on(t.variantId),
}));

// ─── Product bundles ──────────────────────────────────────────────────────────

export const productBundles = pgTable('product_bundles', {
  id:                uuid('id').primaryKey().defaultRandom(),
  ownerId:           text('owner_id').notNull(),
  name:              text('name').notNull(),
  description:       text('description'),
  bundlePriceCents:  integer('bundle_price_cents').notNull().default(0),
  compareAtCents:    integer('compare_at_cents').notNull().default(0),
  status:            text('status').notNull().default('draft'), // 'draft' | 'active' | 'archived'
  images:            json('images').$type<string[]>().notNull().default([]),
  createdAt:         timestamp('created_at').defaultNow().notNull(),
  updatedAt:         timestamp('updated_at').defaultNow().notNull(),
});

export const bundleItems = pgTable('bundle_items', {
  id:         uuid('id').primaryKey().defaultRandom(),
  bundleId:   uuid('bundle_id').notNull().references(() => productBundles.id, { onDelete: 'cascade' }),
  productId:  uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  variantId:  uuid('variant_id'),
  quantity:   integer('quantity').notNull().default(1),
}, (table) => ({
  bundleIdx: index('bundle_items_bundle_id_idx').on(table.bundleId),
  productIdx: index('bundle_items_product_id_idx').on(table.productId),
  variantIdx: index('bundle_items_variant_id_idx').on(table.variantId),
}));

// ─── Storefronts ─────────────────────────────────────────────────────────────
export const storefronts = pgTable('storefronts', {
  id:            uuid('id').primaryKey().defaultRandom(),
  ownerId:       text('owner_id').notNull().unique(),
  slug:          text('slug').notNull().unique(),
  title:         text('title').notNull().default(''),
  subtitle:      text('subtitle'),
  description:   text('description'),
  status:        text('status').notNull().default('draft'),
  theme:         json('theme').$type<Record<string, unknown>>().notNull().default({}),
  branding:      json('branding').$type<Record<string, unknown>>().notNull().default({}),
  sections:      json('sections').$type<unknown[]>().notNull().default([]),
  seo:           json('seo').$type<Record<string, unknown>>().notNull().default({}),
  socialLinks:   json('social_links').$type<Record<string, unknown>>().notNull().default({}),
  analyticsCode: text('analytics_code'),
  publishedAt:          timestamp('published_at'),
  sharePreviewRevokedAt: timestamp('share_preview_revoked_at', { withTimezone: true }),
  // SHA-256 fingerprint of the one currently valid public preview token.
  // The raw bearer token is never stored in the database.
  sharePreviewTokenHash: text('share_preview_token_hash'),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
});

export const storefrontVersions = pgTable('storefront_versions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  storefrontId: uuid('storefront_id').notNull().references(() => storefronts.id, { onDelete: 'cascade' }),
  label:        text('label').notNull().default(''),
  snapshot:     json('snapshot').$type<Record<string, unknown>>().notNull().default({}),
  createdBy:    text('created_by').notNull(),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  storefrontIdx: index('storefront_versions_storefront_id_idx').on(table.storefrontId),
}));

// ─── Design Studio cloud projects ────────────────────────────────────────────
export const designStudioProjects = pgTable('design_studio_projects', {
  id:        text('id').primaryKey(),
  ownerId:   text('owner_id').notNull(),
  snapshot:  json('snapshot').$type<Record<string, unknown>>().notNull().default({}),
  revision:  integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index('design_studio_projects_owner_id_idx').on(table.ownerId),
  idOwnerUnique: uniqueIndex('design_studio_projects_id_owner_unique').on(table.id, table.ownerId),
}));

export const designStudioAssets = pgTable('design_studio_assets', {
  id:         uuid('id').primaryKey().defaultRandom(),
  projectId:  text('project_id').notNull().references(() => designStudioProjects.id, { onDelete: 'cascade' }),
  ownerId:    text('owner_id').notNull(),
  uploadId:   text('upload_id'),
  kind:       text('kind').notNull(), // 'master' | 'thumbnail' | 'source' (never interchangeable)
  objectPath: text('object_path').notNull(),
  width:      integer('width').notNull(),
  height:     integer('height').notNull(),
  mimeType:   text('mime_type').notNull(),
  format:     text('format').notNull(),
  lossless:   boolean('lossless').notNull(),
  quality:    integer('quality'),
  byteSize:   integer('byte_size').notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  projectIdx: index('design_studio_assets_project_id_idx').on(table.projectId),
  ownerIdx: index('design_studio_assets_owner_id_idx').on(table.ownerId),
  uploadIdUnique: uniqueIndex('design_studio_assets_upload_id_unique')
    .on(table.ownerId, table.projectId, table.uploadId)
    .where(sql`${table.uploadId} IS NOT NULL`),
  projectOwnerFk: foreignKey({
    columns: [table.projectId, table.ownerId],
    foreignColumns: [designStudioProjects.id, designStudioProjects.ownerId],
    name: 'design_studio_assets_project_owner_fk',
  }).onDelete('cascade'),
}));

export const designStudioObjectCleanup = pgTable('design_studio_object_cleanup', {
  objectPath:    text('object_path').primaryKey(),
  attemptCount:  integer('attempt_count').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  claimedAt:     timestamp('claimed_at', { withTimezone: true }),
  lastError:     text('last_error'),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  dueIdx: index('design_studio_object_cleanup_due_idx').on(table.nextAttemptAt),
}));

export const storefrontCustomDomains = pgTable('storefront_custom_domains', {
  id:           uuid('id').primaryKey().defaultRandom(),
  storefrontId: uuid('storefront_id').notNull().references(() => storefronts.id, { onDelete: 'cascade' }),
  domain:       text('domain').notNull().unique(),
  verified:     boolean('verified').notNull().default(false),
  verifyToken:  text('verify_token'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  storefrontIdx: index('storefront_custom_domains_storefront_id_idx').on(table.storefrontId),
}));

// ─── Team Members ─────────────────────────────────────────────────────────────
export const teamMembers = pgTable('team_members', {
  id:           uuid('id').primaryKey().defaultRandom(),
  ownerId:      text('owner_id').notNull(),
  /** Clerk userId of the invitee — set when they accept the invite. Drives role enforcement. */
  memberClerkId: text('member_clerk_id'),
  email:        text('email').notNull(),
  name:         text('name'),
  /** 'owner' | 'manager' | 'staff' */
  role:         text('role').notNull().default('staff'),
  /** 'pending' | 'active' | 'removed' */
  status:       text('status').notNull().default('pending'),
  inviteToken:  text('invite_token').unique(),
  invitedAt:    timestamp('invited_at').defaultNow().notNull(),
  /** NULL = legacy invite (no expiry); otherwise the token is invalid after this time. */
  expiresAt:    timestamp('expires_at'),
  /** Set after the one-time reminder email is successfully sent. */
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  /** Short-lived delivery lease for a reminder currently being sent. */
  reminderClaimedAt: timestamp('reminder_claimed_at', { withTimezone: true }),
  acceptedAt:   timestamp('accepted_at'),
  lastActiveAt: timestamp('last_active_at'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
});

export const teamActivityLogs = pgTable('team_activity_logs', {
  id:        uuid('id').primaryKey().defaultRandom(),
  ownerId:   text('owner_id').notNull(),
  memberId:  uuid('member_id').references(() => teamMembers.id, { onDelete: 'set null' }),
  /** Clerk userId of who performed the action (owner or team member). */
  actorClerkId: text('actor_clerk_id'),
  /** 'owner' | 'manager' | 'staff' at the time of the action. */
  actorRole:    text('actor_role'),
  actorName: text('actor_name'),
  action:    text('action').notNull(),
  /** 'product' | 'order' | 'inventory' | 'team' */
  resourceType: text('resource_type'),
  resourceId:   text('resource_id'),
  target:    text('target'),
  metadata:  json('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  memberIdx: index('team_activity_logs_member_id_idx').on(table.memberId),
}));

// ─── Disputes / Chargebacks ───────────────────────────────────────────────────
export const disputes = pgTable('disputes', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  stripeDisputeId:        text('stripe_dispute_id').notNull().unique(),
  stripeChargeId:         text('stripe_charge_id'),
  stripePaymentIntentId:  text('stripe_payment_intent_id'),
  orderId:                uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  sellerId:               text('seller_id').notNull(),
  amountCents:            integer('amount_cents').notNull().default(0),
  currency:               text('currency').notNull().default('usd'),
  reason:                 text('reason'),
  status:                 text('status').notNull().default('needs_response'),
  evidenceDueBy:          timestamp('evidence_due_by'),
  evidenceJson:           json('evidence_json').$type<Record<string, unknown>[]>().notNull().default([]),
  stripeEvidenceDetails:  json('stripe_evidence_details').$type<Record<string, unknown>>().notNull().default({}),
  isChargeRefundable:     boolean('is_charge_refundable').notNull().default(true),
  networkReasonCode:      text('network_reason_code'),
  customerClaim:          text('customer_claim').notNull().default(''),
  createdAt:              timestamp('created_at').defaultNow().notNull(),
  updatedAt:              timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  orderIdx: index('disputes_order_idx').on(table.orderId),
}));

// ─── Paid Promotion Boosts ────────────────────────────────────────────────────
export const boosts = pgTable('boosts', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  sellerId:                text('seller_id').notNull(),
  targetType:              text('target_type').notNull(),             // 'post' | 'product'
  targetId:                text('target_id').notNull(),
  objective:               text('objective').notNull().default('views'), // 'views' | 'likes' | 'followers' | 'profile_visits'
  budgetCents:             integer('budget_cents').notNull(),
  spentCents:              integer('spent_cents').notNull().default(0),
  durationDays:            integer('duration_days').notNull().default(7),
  stripePaymentIntentId:   text('stripe_payment_intent_id'),
  status:                  text('status').notNull().default('active'), // 'active' | 'paused' | 'completed' | 'cancelled'
  impressionsCount:        integer('impressions_count').notNull().default(0),
  startsAt:                timestamp('starts_at').defaultNow().notNull(),
  endsAt:                  timestamp('ends_at').notNull(),
  createdAt:               timestamp('created_at').defaultNow().notNull(),
});

// ─── Loyalty / Rewards Points Ledger ─────────────────────────────────────────
export const loyaltyPoints = pgTable('loyalty_points', {
  id:          uuid('id').primaryKey().defaultRandom(),
  buyerId:     text('buyer_id').notNull(),
  points:      integer('points').notNull(),                            // +earned / -redeemed
  source:      text('source').notNull(),                               // 'order_earn' | legacy 'purchase' | 'referral' | 'signup' | 'redemption' | 'bonus'
  referenceId: text('reference_id'),
  note:        text('note'),
  // Redemption rows are first attached to one checkout, then marked used only
  // after the corresponding order has been successfully created.
  checkoutSessionId: text('checkout_session_id'),
  usedAt:      timestamp('used_at'),
  usedOrderId: uuid('used_order_id'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
});

// ─── Drop Broadcast Throttle ──────────────────────────────────────────────────
export const dropBroadcasts = pgTable('drop_broadcasts', {
  id:        uuid('id').primaryKey().defaultRandom(),
  dropId:    uuid('drop_id').notNull().unique(),
  sellerId:  text('seller_id').notNull(),
  sentAt:    timestamp('sent_at').defaultNow().notNull(),
  sentCount: integer('sent_count').notNull().default(0),
});

// ─── Trending Cache — pre-computed daily list ─────────────────────────────────
// Written once/day by the computeTrending background job; read by GET /api/public/trending.
export const trendingCache = pgTable('trending_cache', {
  id:          uuid('id').primaryKey().defaultRandom(),
  computedAt:  timestamp('computed_at').defaultNow().notNull(),
  cacheDate:   text('cache_date').notNull().unique(),   // 'YYYY-MM-DD' UTC
  results:     json('results').$type<any[]>().notNull().default([]),
  itemCount:   integer('item_count').notNull().default(0),
});

// ─── Seller Tax Configuration ─────────────────────────────────────────────────
export const sellerTaxConfig = pgTable('seller_tax_config', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  sellerId:            text('seller_id').notNull().unique(),
  stripeTaxEnabled:    boolean('stripe_tax_enabled').notNull().default(false),
  collectDuties:       boolean('collect_duties').notNull().default(false),
  chargeShippingTax:   boolean('charge_shipping_tax').notNull().default(false),
  chargeVat:           boolean('charge_vat').notNull().default(false),
  taxCalculationMode:  text('tax_calculation_mode').notNull().default('automatic'),
  stripeTaxSettings:   json('stripe_tax_settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt:           timestamp('created_at').defaultNow().notNull(),
  updatedAt:           timestamp('updated_at').defaultNow().notNull(),
});

// One immutable payment record per physical-goods order. A paid order remains
// in this ledger even if it is later refunded; 1099-K preparation reports gross
// payment volume rather than net-after-refund proceeds.
export const sellerTaxLedger = pgTable('seller_tax_ledger', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  sellerId:               text('seller_id').notNull(),
  orderId:                uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }).unique(),
  calendarYear:           integer('calendar_year').notNull(),
  grossPaymentCents:      integer('gross_payment_cents').notNull(),
  taxCents:               integer('tax_cents').notNull().default(0),
  shippingCents:          integer('shipping_cents').notNull().default(0),
  currency:               text('currency').notNull().default('usd'),
  stripePaymentIntentId:  text('stripe_payment_intent_id'),
  stripeCheckoutSessionId: text('stripe_checkout_session_id'),
  paidAt:                 timestamp('paid_at').notNull(),
  paidAtSource:           text('paid_at_source').notNull().default('stripe_event'),
  createdAt:              timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sellerYearIdx: index('seller_tax_ledger_seller_year_idx').on(table.sellerId, table.calendarYear),
  checkoutIdx: index('seller_tax_ledger_checkout_idx').on(table.stripeCheckoutSessionId),
}));

export const shopifyImportCollections = pgTable('shopify_import_collections', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  ownerId:            text('owner_id').notNull(),
  sourceUrl:          text('source_url').notNull(),
  importJobId:        uuid('import_job_id').notNull().references(() => shopifyImportJobs.id, { onDelete: 'cascade' }),
  sourceCollectionId: text('source_collection_id').notNull(),
  title:              text('title').notNull(),
  handle:             text('handle'),
  sourceProductIds:   json('source_product_ids').notNull().default([]),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sourceCollectionUnique: uniqueIndex('shopify_import_source_collection_unique')
    .on(table.ownerId, table.sourceUrl, table.sourceCollectionId),
}));

export const shopifyImportProductMappings = pgTable('shopify_import_product_mappings', {
  id:              uuid('id').primaryKey().defaultRandom(),
  ownerId:         text('owner_id').notNull(),
  sourceUrl:       text('source_url').notNull(),
  sourceProductId: text('source_product_id').notNull(),
  importJobId:     uuid('import_job_id').notNull().references(() => shopifyImportJobs.id, { onDelete: 'cascade' }),
  productId:       uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sourceProductUnique: uniqueIndex('shopify_import_source_product_unique')
    .on(table.ownerId, table.sourceUrl, table.sourceProductId),
  jobIdx: index('shopify_import_product_mappings_job_idx').on(table.importJobId),
}));

export const notificationEvents = pgTable('notification_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  notificationId: text('notification_id').notNull(),
  userId:         text('user_id').notNull(),
  ownerId:        text('owner_id').notNull(),
  deliveryId:     uuid('delivery_id').references(() => notificationDeliveries.id, { onDelete: 'set null' }),
  eventType:      text('event_type').notNull(), // receipt | open | tap
  eventKey:       text('event_key').notNull().unique(),
  occurredAt:     timestamp('occurred_at').defaultNow().notNull(),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('notification_events_user_idx').on(table.userId),
  ownerIdx: index('notification_events_owner_idx').on(table.ownerId),
  notificationIdx: index('notification_events_notification_idx').on(table.notificationId),
}));

export const shippingLabels = pgTable('shipping_labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  provider: text('provider').notNull().default('shippo'),
  providerShipmentId: text('provider_shipment_id'),
  providerTransactionId: text('provider_transaction_id'),
  providerRateId: text('provider_rate_id').notNull(),
  carrier: text('carrier'),
  service: text('service'),
  trackingNumber: text('tracking_number'),
  labelUrl: text('label_url'),
  priceCents: integer('price_cents').notNull(),
  status: text('status').notNull().default('purchasing'), // purchasing|active|failed|void_pending|voided
  failureReason: text('failure_reason'),
  previousOrderStatus: text('previous_order_status'),
  refundedAt: timestamp('refunded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  orderIdx: index('shipping_labels_order_idx').on(table.orderId),
  ownerIdx: index('shipping_labels_owner_idx').on(table.ownerId),
  idempotencyUnique: uniqueIndex('shipping_labels_owner_idempotency_unique')
    .on(table.ownerId, table.idempotencyKey),
}));

export const orderFundReservations = pgTable('order_fund_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull(),
  shippingLabelId: uuid('shipping_label_id').notNull().references(() => shippingLabels.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  status: text('status').notNull().default('reserved'), // reserved|spent|released|refunded
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  orderIdx: index('order_fund_reservations_order_idx').on(table.orderId),
  ownerIdx: index('order_fund_reservations_owner_idx').on(table.ownerId),
  labelUnique: uniqueIndex('order_fund_reservations_label_unique').on(table.shippingLabelId),
}));

export const sellerCashoutAttempts = pgTable('seller_cashout_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull(),
  stripeAccountId: text('stripe_account_id'),
  bankDestinationId: text('bank_destination_id'),
  status: text('status').notNull().default('processing'), // processing|succeeded|failed
  stripePayoutId: text('stripe_payout_id'),
  responseStatus: text('response_status'),
  responseArrivalDate: timestamp('response_arrival_date', { withTimezone: true }),
  errorHttpStatus: integer('error_http_status'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index('seller_cashout_attempts_owner_idx').on(table.ownerId),
  ownerIdempotencyUnique: uniqueIndex('seller_cashout_attempts_owner_idempotency_unique')
    .on(table.ownerId, table.idempotencyKey),
}));
