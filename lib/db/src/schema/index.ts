import { pgTable, uuid, text, integer, timestamp, json, boolean } from 'drizzle-orm/pg-core';
export * from './manufacturers';
import { relations } from 'drizzle-orm';

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
  // Brand onboarding fields (seller side)
  brandName: text('brand_name'),
  brandType: text('brand_type'),
  brandStage: text('brand_stage'),
  sellModel: text('sell_model'),
  onboardingComplete: boolean('onboarding_complete').notNull().default(false),
  // Stripe Connect (seller payouts)
  stripeAccountId: text('stripe_account_id'),
  stripeAccountStatus: text('stripe_account_status'), // 'pending' | 'active' | 'restricted'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Products ─────────────────────────────────────────────────────────────────

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().default(''), // Clerk user ID of brand owner / seller
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull().default('apparel'),
  status: text('status').notNull().default('draft'), // 'draft' | 'active' | 'archived'
  images: json('images').$type<string[]>().notNull().default([]),
  tags: json('tags').$type<string[]>().notNull().default([]),
  styleTags: json('style_tags').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
});

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

// ─── Orders ───────────────────────────────────────────────────────────────────

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().default(''), // Clerk user ID of brand owner / seller
  buyerId: text('buyer_id'),                        // Clerk user ID of buyer (null for seller-created)
  orderNumber: text('order_number').notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  dropId: uuid('drop_id').references(() => drops.id),
  status: text('status').notNull().default('pending'), // 'pending'|'processing'|'fulfilled'|'shipped'|'cancelled'
  totalCents: integer('total_cents').notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  shippingCents: integer('shipping_cents').notNull().default(0),
  notes: text('notes'),
  shippingAddress: json('shipping_address').$type<{
    name?: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  }>(),
  trackingNumber: text('tracking_number'),
  carrier: text('carrier'),
  // Stripe payment fields
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  stripeCheckoutSessionId: text('stripe_checkout_session_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Order Items ──────────────────────────────────────────────────────────────

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => productVariants.id),
  productName: text('product_name').notNull(),
  variantLabel: text('variant_label'),
  quantity: integer('quantity').notNull(),
  priceCents: integer('price_cents').notNull(), // server-resolved price at time of order
});

// ─── Posts ────────────────────────────────────────────────────────────────────

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(), // Clerk user ID of poster
  mediaUrl: text('media_url').notNull(),
  mediaType: text('media_type').notNull().default('photo'), // 'photo' | 'video' | 'slideshow'
  caption: text('caption'),
  styleTags: json('style_tags').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Interactions ─────────────────────────────────────────────────────────────

export const interactions = pgTable('interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),   // Clerk user ID of actor
  postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),        // 'like' | 'comment' | 'follow' | 'watch_time'
  value: text('value'),               // e.g. comment text, seconds watched, followed user ID
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Checkout Sessions (server-side cart record for Stripe webhook reconstruction)

export const checkoutSessions = pgTable('checkout_sessions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  stripeSessionId: text('stripe_session_id').unique(),  // set after Stripe responds
  buyerId:         text('buyer_id').notNull(),           // Clerk user ID
  sellerId:        text('seller_id').notNull(),          // Clerk user ID of seller
  // Serialized cart items — single DB row replaces per-field Stripe metadata
  items: json('items').$type<Array<{
    variantId:    string;
    productName:  string;
    variantLabel: string;
    quantity:     number;   // already aggregated by variantId
    priceCents:   number;
  }>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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

// ─── Relations ────────────────────────────────────────────────────────────────

export const productsRelations = relations(products, ({ many }) => ({
  variants: many(productVariants),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  orderItems: many(orderItems),
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
