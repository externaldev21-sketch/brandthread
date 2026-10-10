import { pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { orders } from './index';

// Migration 262. One row per order, inserted before the post-delivery review
// request is sent, so the job can never ask twice for the same order.
export const orderReviewRequests = pgTable('order_review_requests', {
  orderId: uuid('order_id').primaryKey().references(() => orders.id, { onDelete: 'cascade' }),
  buyerId: text('buyer_id').notNull(),
  sentAt:  timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  buyerIdx: index('order_review_requests_buyer_idx').on(t.buyerId),
}));
