/**
 * Email copies of the seller notifications that matter most: a new order,
 * a new review and a failed payout. publishNotification() hands every
 * notification here; only these seller types send an email, gated by the
 * seller's Settings → Notifications → Email switch for that category. The
 * Resend idempotency key (type + target) makes a retried webhook a no-op.
 *
 * Sellers on the daily digest don't get a separate email per new order.
 */
import { eq, sql } from "drizzle-orm";
import { db, orderItems, orders, products, reviews, users } from "@workspace/db";
import { sendBrandthreadEmail } from "../brandthreadEmail";
import { isChannelEnabled } from "../notificationChannels";
import { preferenceKey, type PushEventCategory } from "../push";
import { logger } from "../logger";
import { newOrderEmail, newReviewEmail, payoutFailedEmail, type RenderedEmail } from "./emails";

export type MirrorInput = {
  userId: string;
  type: string;
  title?: string;
  body?: string | null;
  targetId?: string | null;
};

const MIRRORED: Record<string, PushEventCategory | "review"> = {
  new_order_received: "order",
  new_review: "review",
  review_received: "review",
  payout_failed: "payout",
};

export function isMirroredSellerType(type: string): boolean {
  return type in MIRRORED;
}

/** Pure gate: does this seller want an email for this notification type? */
export function wantsSellerEmail(input: {
  type: string;
  accountType: string | null;
  preferences: Record<string, unknown> | null;
  digest: string | null;
}): boolean {
  const category = MIRRORED[input.type];
  if (!category) return false;
  if (input.type === "new_order_received" && input.digest === "daily") return false;
  const key = category === "review" ? null : preferenceKey(input.accountType ?? "seller", category);
  return key ? isChannelEnabled(input.preferences, key, "email") : true;
}

async function render(n: MirrorInput): Promise<RenderedEmail | null> {
  if (n.type === "new_order_received" && n.targetId) {
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, totalCents: orders.totalCents })
      .from(orders).where(eq(orders.id, n.targetId)).limit(1);
    if (!order) return null;
    const [{ items }] = await db.select({ items: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
      .from(orderItems).where(eq(orderItems.orderId, order.id));
    return newOrderEmail({ orderId: order.id, orderNumber: order.orderNumber, totalCents: order.totalCents, itemCount: Number(items) });
  }
  if ((n.type === "new_review" || n.type === "review_received") && n.targetId) {
    const [review] = await db.select({ rating: reviews.rating, body: reviews.body, productName: products.name })
      .from(reviews).leftJoin(products, eq(products.id, reviews.productId))
      .where(eq(reviews.id, n.targetId)).limit(1);
    if (!review) return null;
    return newReviewEmail({ rating: review.rating ?? null, productName: review.productName ?? null, body: review.body ?? null });
  }
  if (n.type === "payout_failed") {
    const amount = n.body?.match(/\$([\d,]+\.\d{2})/)?.[1];
    return payoutFailedEmail({ amountCents: amount ? Math.round(Number(amount.replaceAll(",", "")) * 100) : null, detail: n.body ?? null });
  }
  return null;
}

export async function mirrorSellerEmail(n: MirrorInput): Promise<boolean> {
  if (!isMirroredSellerType(n.type)) return false;
  try {
    const [seller] = await db.select({
      email: users.email, accountType: users.accountType, preferences: users.notificationPreferences, digest: users.notificationDigest,
      deletedAt: users.deletedAt,
    }).from(users).where(eq(users.clerkId, n.userId)).limit(1);
    if (!seller?.email || seller.deletedAt) return false;
    if (!wantsSellerEmail({ type: n.type, accountType: seller.accountType, preferences: seller.preferences as Record<string, unknown> | null, digest: seller.digest })) return false;
    const email = await render(n);
    if (!email) return false;
    return await sendBrandthreadEmail({
      to: seller.email,
      subject: email.subject,
      html: email.html,
      idempotencyKey: `seller-${n.type}/${n.targetId ?? n.userId}`,
    });
  } catch (err) {
    logger.warn({ err, type: n.type }, "Seller notification email failed");
    return false;
  }
}
