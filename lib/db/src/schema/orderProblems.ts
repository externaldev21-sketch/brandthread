/**
 * Buyer "Report a problem" submissions (order detail → Report a problem).
 * Stored server-side so the order's seller and Brandthread support see them;
 * evidence photos are private object paths uploaded via POST /api/returns/evidence.
 */
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { orders } from './index';

export const orderProblemReports = pgTable('order_problem_reports', {
  id:              uuid('id').primaryKey().defaultRandom(),
  buyerId:         text('buyer_id').notNull(),
  // Null for a general (not order-specific) report.
  orderId:         uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  sellerId:        text('seller_id'),
  orderNumber:     text('order_number'),
  type:            text('type').notNull(),
  description:     text('description').notNull(),
  evidenceUrls:    jsonb('evidence_urls').$type<string[]>().notNull().default([]),
  contactedSeller: boolean('contacted_seller').notNull().default(false),
  status:          text('status').notNull().default('open'),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  buyerIdx: index('order_problem_reports_buyer_idx').on(t.buyerId, t.createdAt),
  orderIdx: index('order_problem_reports_order_idx').on(t.orderId),
  sellerIdx: index('order_problem_reports_seller_idx').on(t.sellerId, t.createdAt),
}));
