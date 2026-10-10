/**
 * Post-delivery review request job. The rule and the claim/notify flow live in
 * lib/reviewRequest.ts; this wires the database, notifications and email.
 */
import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db, orders, orderReviewRequests, users } from "@workspace/db";
import { logger } from "../lib/logger";
import { publishNotification } from "../routes/notifications-feed";
import { sendReviewRequestEmail } from "../lib/brandthreadEmail";
import { isChannelEnabledForUser } from "../lib/notificationChannels";
import {
  REVIEW_REQUEST_AFTER_MS, REVIEW_REQUEST_MAX_AGE_MS,
  runReviewRequests as runRequests, type ReviewRequestDeps,
} from "../lib/reviewRequest";

const INTERVAL_MS = 60 * 60 * 1000;
const BATCH_LIMIT = 500;

export const dbReviewRequestDeps: ReviewRequestDeps = {
  async findCandidates(now) {
    return db.select({
      orderId: orders.id,
      buyerId: orders.buyerId,
      orderNumber: orders.orderNumber,
      status: orders.status,
      deliveredAt: orders.deliveredAt,
      totalCents: orders.totalCents,
      refundedCents: orders.refundedCents,
      autoRefundedAt: orders.autoRefundedAt,
      hasReview: sql<boolean>`EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = ${orders.id} AND r.buyer_id = ${orders.buyerId})`,
      alreadyRequested: sql<boolean>`EXISTS (SELECT 1 FROM order_review_requests q WHERE q.order_id = ${orders.id})`,
      productName: sql<string | null>`(SELECT oi.product_name FROM order_items oi WHERE oi.order_id = ${orders.id} ORDER BY oi.id LIMIT 1)`,
    }).from(orders).where(and(
      eq(orders.status, "delivered"),
      isNotNull(orders.buyerId),
      lte(orders.deliveredAt, new Date(now.getTime() - REVIEW_REQUEST_AFTER_MS)),
      gte(orders.deliveredAt, new Date(now.getTime() - REVIEW_REQUEST_MAX_AGE_MS)),
      sql`NOT EXISTS (SELECT 1 FROM order_review_requests q WHERE q.order_id = ${orders.id})`,
      sql`NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = ${orders.id} AND r.buyer_id = ${orders.buyerId})`,
    )).limit(BATCH_LIMIT);
  },
  async claim(orderId, buyerId, now) {
    const [row] = await db.insert(orderReviewRequests)
      .values({ orderId, buyerId, sentAt: now })
      .onConflictDoNothing({ target: orderReviewRequests.orderId })
      .returning({ orderId: orderReviewRequests.orderId });
    return !!row;
  },
  async release(orderId) {
    await db.delete(orderReviewRequests).where(eq(orderReviewRequests.orderId, orderId));
  },
  notify: publishNotification,
  async email(c) {
    if (!(await isChannelEnabledForUser(c.buyerId, "order", "email"))) return false;
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, c.buyerId)).limit(1);
    if (!u?.email) return false;
    return sendReviewRequestEmail({
      to: u.email,
      orderId: c.orderId,
      orderNumber: c.orderNumber,
      productName: c.productName,
      idempotencyKey: `review-request/${c.orderId}`,
    });
  },
};

export function runReviewRequests(now = new Date()) {
  return runRequests(now, dbReviewRequestDeps);
}

export function startReviewRequestJob(): void {
  setTimeout(() => { void runReviewRequests(); }, 7 * 60 * 1000);
  setInterval(() => { void runReviewRequests(); }, INTERVAL_MS);
  logger.info({ job: "reviewRequest", intervalMs: INTERVAL_MS }, "Review request job scheduled");
}
