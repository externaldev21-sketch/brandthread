/**
 * Post-delivery review request (database-free; jobs/reviewRequest.ts supplies
 * the real dependencies).
 *
 * REVIEW_REQUEST_AFTER_MS after an order is delivered, a buyer who has not
 * reviewed it gets ONE push/in-app notification (Settings -> Notifications ->
 * order updates) and, when their order-update email channel is on, one email.
 * Both open buyer-order-detail with review=1, which opens the review form.
 *
 * Idempotent: the request is claimed by inserting an order_review_requests row
 * (primary key = order id) before anything is sent. Only the run that inserts
 * it sends, so overlapping runs and multiple replicas never double-send. If
 * the push fails the claim is released so the next run retries.
 */
import { logger } from "./logger";

export const REVIEW_REQUEST_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
/** Orders delivered longer ago than this are never asked (no backfill blast). */
export const REVIEW_REQUEST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type ReviewRequestCandidate = {
  orderId: string;
  buyerId: string | null;
  orderNumber: string;
  status: string;
  deliveredAt: Date | null;
  totalCents: number;
  refundedCents: number;
  autoRefundedAt: Date | null;
  /** The buyer already left a review for this order. */
  hasReview: boolean;
  /** A review request row already exists for this order. */
  alreadyRequested: boolean;
  /** First line item's name, for the copy. */
  productName: string | null;
};

/** The rule. The SQL in the job is a coarse filter; this decides. */
export function isReviewRequestDue(c: ReviewRequestCandidate, now: Date): boolean {
  if (!c.buyerId) return false; // guest checkout: no account to review from
  if (c.status !== "delivered") return false;
  if (!c.deliveredAt) return false;
  const age = now.getTime() - c.deliveredAt.getTime();
  if (age < REVIEW_REQUEST_AFTER_MS || age > REVIEW_REQUEST_MAX_AGE_MS) return false;
  if (c.hasReview || c.alreadyRequested) return false;
  if (c.autoRefundedAt) return false;
  if (c.totalCents > 0 && c.refundedCents >= c.totalCents) return false; // fully refunded
  return true;
}

export function reviewRequestHref(orderId: string): string {
  return `/buyer-order-detail?id=${encodeURIComponent(orderId)}&review=1`;
}

export function buildReviewRequestCopy(c: Pick<ReviewRequestCandidate, "orderNumber" | "productName">): {
  title: string;
  body: string;
} {
  const what = c.productName?.trim() || `order ${c.orderNumber}`;
  return {
    title: "How was your order?",
    body: `Rate ${what} and help other shoppers decide.`,
  };
}

export interface ReviewRequestDeps {
  findCandidates(now: Date): Promise<ReviewRequestCandidate[]>;
  /** Insert the claim row; false when this order was already claimed. */
  claim(orderId: string, buyerId: string, now: Date): Promise<boolean>;
  release(orderId: string): Promise<void>;
  notify(n: {
    userId: string; category: string; type: string; title: string; body: string;
    targetId: string; targetType: string; cta: string;
  }): Promise<void>;
  /** Sends the email when the buyer has an address and the email channel is on. */
  email(c: ReviewRequestCandidate & { buyerId: string }, copy: { title: string; body: string }): Promise<boolean>;
}

export async function runReviewRequests(
  now: Date,
  deps: ReviewRequestDeps,
): Promise<{ notified: number; emailed: number }> {
  let notified = 0;
  let emailed = 0;
  try {
    const candidates = await deps.findCandidates(now);
    for (const c of candidates) {
      if (!isReviewRequestDue(c, now) || !c.buyerId) continue;
      const buyerId = c.buyerId;
      if (!await deps.claim(c.orderId, buyerId, now)) continue;
      const copy = buildReviewRequestCopy(c);
      try {
        await deps.notify({
          userId: buyerId,
          category: "orders",
          type: "review_request",
          title: copy.title,
          body: copy.body,
          targetId: c.orderId,
          targetType: "buyer_order",
          cta: "Leave a review",
        });
        notified += 1;
      } catch (err) {
        await deps.release(c.orderId).catch(() => {});
        logger.warn({ err, orderId: c.orderId, job: "reviewRequest" }, "Review request push failed; will retry");
        continue;
      }
      try {
        if (await deps.email({ ...c, buyerId }, copy)) emailed += 1;
      } catch (err) {
        logger.warn({ err, orderId: c.orderId, job: "reviewRequest" }, "Review request email failed");
      }
    }
  } catch (err) {
    logger.error({ err, job: "reviewRequest" }, "Review request job failed");
  }
  return { notified, emailed };
}
