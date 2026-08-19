import { pgTable, uuid, text, integer, timestamp, json, boolean, index } from 'drizzle-orm/pg-core';

// ─── Manufacturers ────────────────────────────────────────────────────────────

export const manufacturers = pgTable('manufacturers', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  // nullable: public applications don't have a Clerk account yet
  clerkId:            text('clerk_id').unique(),
  businessName:       text('business_name').notNull(),
  country:            text('country').notNull(),
  city:               text('city'),
  specialty:          text('specialty').notNull(),
  description:        text('description'),
  yearsInBusiness:    integer('years_in_business').notNull().default(0),
  moq:                integer('moq').notNull().default(100),
  priceRange:         text('price_range').notNull().default(''),
  bulkTurnaround:     text('bulk_turnaround').notNull().default(''),
  sampleTurnaround:   text('sample_turnaround').notNull().default(''),
  photos:             json('photos').$type<string[]>().notNull().default([]),
  website:            text('website'),
  contactEmail:       text('contact_email'),
  // 'pending' | 'active' | 'suspended'
  status:             text('status').notNull().default('pending'),
  // true  = appears in the public Discover directory
  // false = only visible to the seller who invited them
  isPublicDirectory:  boolean('is_public_directory').notNull().default(true),
  verifiedAt:         timestamp('verified_at'),
  paymentSetup:       boolean('payment_setup').notNull().default(false),
  // Stripe Connect Express — manufacturer receives payouts here
  stripeAccountId:    text('stripe_account_id'),
  stripeAccountStatus: text('stripe_account_status'), // 'pending' | 'active' | 'restricted'
  createdAt:          timestamp('created_at').defaultNow().notNull(),
  updatedAt:          timestamp('updated_at').defaultNow().notNull(),
});

// ─── Manufacturer Payment Info (legacy bank/PayPal/Wise — kept for non-Stripe markets)

export const manufacturerPayments = pgTable('manufacturer_payments', {
  id:            uuid('id').primaryKey().defaultRandom(),
  manufacturerId: uuid('manufacturer_id').notNull().references(() => manufacturers.id, { onDelete: 'cascade' }),
  method:        text('method').notNull(),
  bankLast4:     text('bank_last4'),
  bankName:      text('bank_name'),
  currency:      text('currency').notNull().default('USD'),
  routingMasked: text('routing_masked'),
  paypalEmail:   text('paypal_email'),
  wiseEmail:     text('wise_email'),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
});

// ─── Manufacturer Invite Tokens (seller → private manufacturer onboarding) ─────

export const manufacturerInviteTokens = pgTable('manufacturer_invite_tokens', {
  id:             uuid('id').primaryKey().defaultRandom(),
  sellerId:       text('seller_id').notNull(),
  token:          text('token').notNull().unique(),
  companyName:    text('company_name'),
  contactName:    text('contact_name'),
  contactEmail:   text('contact_email'),
  notes:          text('notes'),
  usedAt:         timestamp('used_at'),
  manufacturerId: uuid('manufacturer_id').references(() => manufacturers.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  sellerIdx: index('mfg_invite_tokens_seller_idx').on(t.sellerId),
}));

// ─── Manufacturer Message Threads ─────────────────────────────────────────────

export const manufacturerThreads = pgTable('manufacturer_threads', {
  id:             uuid('id').primaryKey().defaultRandom(),
  manufacturerId: uuid('manufacturer_id').notNull().references(() => manufacturers.id, { onDelete: 'cascade' }),
  buyerClerkId:   text('buyer_clerk_id').notNull(),
  buyerName:      text('buyer_name').notNull(),
  buyerAvatar:    text('buyer_avatar'),
  subject:        text('subject').notNull(),
  orderStatus:    text('order_status'),
  unreadCount:    integer('unread_count').notNull().default(0),
  lastMessage:    text('last_message').notNull().default(''),
  lastMessageAt:  timestamp('last_message_at').defaultNow().notNull(),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
});

// ─── Messages ─────────────────────────────────────────────────────────────────

export const manufacturerMessages = pgTable('manufacturer_messages', {
  id:          uuid('id').primaryKey().defaultRandom(),
  threadId:    uuid('thread_id').notNull().references(() => manufacturerThreads.id, { onDelete: 'cascade' }),
  senderRole:  text('sender_role').notNull(),   // 'manufacturer' | 'seller'
  content:     text('content').notNull(),
  // Extended for real messaging
  messageType: text('message_type').notNull().default('text'),
  // 'text' | 'image' | 'sample_card' | 'bulk_card' | 'system'
  mediaUrls:   json('media_urls').$type<string[]>().notNull().default([]),
  // For sample_card / bulk_card messages
  cardData:    json('card_data').$type<Record<string, unknown> | null>(),
  sentAt:      timestamp('sent_at').defaultNow().notNull(),
});

// ─── Manufacturer Orders ──────────────────────────────────────────────────────

export const manufacturerOrders = pgTable('manufacturer_orders', {
  id:             uuid('id').primaryKey().defaultRandom(),
  manufacturerId: uuid('manufacturer_id').notNull().references(() => manufacturers.id, { onDelete: 'cascade' }),
  orderNumber:    text('order_number').notNull(),
  buyerClerkId:   text('buyer_clerk_id').notNull(),
  buyerName:      text('buyer_name').notNull(),
  productType:    text('product_type').notNull(),
  quantity:       integer('quantity').notNull(),
  colorway:       text('colorway'),
  size:           text('size'),
  // 'sampling' | 'in_production' | 'shipping' | 'complete'
  status:         text('status').notNull().default('sampling'),
  totalCents:     integer('total_cents').notNull().default(0),
  notes:          text('notes'),
  trackingNumber: text('tracking_number'),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
});

// ─── Sample Orders (6-stage tracker — sample + bulk) ─────────────────────────

export const sampleOrders = pgTable('sample_orders', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  manufacturerId:          uuid('manufacturer_id').notNull().references(() => manufacturers.id, { onDelete: 'cascade' }),
  sellerId:                text('seller_id').notNull(),   // Clerk userId
  threadId:                uuid('thread_id').references(() => manufacturerThreads.id, { onDelete: 'set null' }),
  orderType:               text('order_type').notNull().default('sample'),  // 'sample' | 'bulk'
  title:                   text('title').notNull(),
  description:             text('description'),
  quantity:                integer('quantity').notNull().default(1),
  priceCents:              integer('price_cents').notNull().default(0),
  // Stage: payment_received → processing → cut_and_sew → packing → shipped → delivered
  status:                  text('status').notNull().default('payment_received'),
  stripePaymentIntentId:   text('stripe_payment_intent_id'),
  platformFeeCents:        integer('platform_fee_cents').notNull().default(0),
  payoutReleased:          boolean('payout_released').notNull().default(false),
  stripeTransferId:        text('stripe_transfer_id'),
  trackingNumber:          text('tracking_number'),
  carrier:                 text('carrier'),
  shippedAt:               timestamp('shipped_at'),
  deliveredAt:             timestamp('delivered_at'),
  walletId:                uuid('wallet_id'),   // FK enforced in migration
  notes:                   text('notes'),
  // Sample progress images — array of object storage paths (e.g. /objects/uploads/<uuid>)
  imageUrls:               json('image_urls').$type<string[]>().notNull().default([]),
  createdAt:               timestamp('created_at').defaultNow().notNull(),
  updatedAt:               timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  sellerIdx: index('sample_orders_seller_idx').on(t.sellerId),
  mfgIdx:    index('sample_orders_mfg_idx').on(t.manufacturerId),
}));

// ─── Drop Wallets ─────────────────────────────────────────────────────────────

export const dropWallets = pgTable('drop_wallets', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  dropId:             uuid('drop_id').notNull().unique(),   // FK → drops.id in schema/index.ts
  sellerId:           text('seller_id').notNull(),
  balanceCents:       integer('balance_cents').notNull().default(0),
  releasedCents:      integer('released_cents').notNull().default(0),
  reservedCents:      integer('reserved_cents').notNull().default(0),
  stripeTransferGroup: text('stripe_transfer_group'),
  createdAt:          timestamp('created_at').defaultNow().notNull(),
  updatedAt:          timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  sellerIdx: index('drop_wallets_seller_idx').on(t.sellerId),
}));

// ─── Drop Wallet Transactions (immutable ledger) ──────────────────────────────

export const dropWalletTransactions = pgTable('drop_wallet_transactions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  walletId:         uuid('wallet_id').notNull(),   // FK → dropWallets.id
  type:             text('type').notNull(),
  // 'deposit' | 'release' | 'bulk_payment' | 'shipping_payment'
  amountCents:      integer('amount_cents').notNull(),
  orderId:          uuid('order_id'),   // FK → orders.id (set in schema/index.ts relations)
  sampleOrderId:    uuid('sample_order_id'),
  description:      text('description'),
  stripeTransferId: text('stripe_transfer_id'),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('dwt_wallet_idx').on(t.walletId),
  orderIdx:  index('dwt_order_idx').on(t.orderId),
}));
