import { pgTable, uuid, text, integer, timestamp, json, boolean } from 'drizzle-orm/pg-core';

// ─── Manufacturers ────────────────────────────────────────────────────────────

export const manufacturers = pgTable('manufacturers', {
  id:               uuid('id').primaryKey().defaultRandom(),
  clerkId:          text('clerk_id').notNull().unique(),
  businessName:     text('business_name').notNull(),
  country:          text('country').notNull(),
  specialty:        text('specialty').notNull(),
  description:      text('description'),
  moq:              integer('moq').notNull().default(100),
  priceRange:       text('price_range').notNull().default(''),
  bulkTurnaround:   text('bulk_turnaround').notNull().default(''),
  sampleTurnaround: text('sample_turnaround').notNull().default(''),
  photos:           json('photos').$type<string[]>().notNull().default([]),
  website:          text('website'),
  // 'pending' | 'active' | 'suspended'
  status:           text('status').notNull().default('pending'),
  verifiedAt:       timestamp('verified_at'),
  paymentSetup:     boolean('payment_setup').notNull().default(false),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
});

// ─── Manufacturer Payment Info ────────────────────────────────────────────────

export const manufacturerPayments = pgTable('manufacturer_payments', {
  id:            uuid('id').primaryKey().defaultRandom(),
  manufacturerId: uuid('manufacturer_id').notNull().references(() => manufacturers.id, { onDelete: 'cascade' }),
  // 'bank_transfer' | 'paypal' | 'wise'
  method:        text('method').notNull(),
  // Store only last 4 digits of account for display
  bankLast4:     text('bank_last4'),
  bankName:      text('bank_name'),
  currency:      text('currency').notNull().default('USD'),
  // Encrypted / masked routing; in production use a vault
  routingMasked: text('routing_masked'),
  paypalEmail:   text('paypal_email'),
  wiseEmail:     text('wise_email'),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
});

// ─── Manufacturer Message Threads ─────────────────────────────────────────────

export const manufacturerThreads = pgTable('manufacturer_threads', {
  id:             uuid('id').primaryKey().defaultRandom(),
  manufacturerId: uuid('manufacturer_id').notNull().references(() => manufacturers.id, { onDelete: 'cascade' }),
  buyerClerkId:   text('buyer_clerk_id').notNull(),
  buyerName:      text('buyer_name').notNull(),
  buyerAvatar:    text('buyer_avatar'),
  subject:        text('subject').notNull(),
  // 'sampling' | 'in_production' | 'shipping' | 'complete' | null
  orderStatus:    text('order_status'),
  unreadCount:    integer('unread_count').notNull().default(0),
  lastMessage:    text('last_message').notNull().default(''),
  lastMessageAt:  timestamp('last_message_at').defaultNow().notNull(),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
});

// ─── Messages ─────────────────────────────────────────────────────────────────

export const manufacturerMessages = pgTable('manufacturer_messages', {
  id:         uuid('id').primaryKey().defaultRandom(),
  threadId:   uuid('thread_id').notNull().references(() => manufacturerThreads.id, { onDelete: 'cascade' }),
  // 'manufacturer' | 'buyer'
  senderRole: text('sender_role').notNull(),
  content:    text('content').notNull(),
  sentAt:     timestamp('sent_at').defaultNow().notNull(),
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
