import { describe, expect, it, vi } from "vitest";
import {
  buildReviewRequestCopy, isReviewRequestDue, reviewRequestHref, runReviewRequests,
  REVIEW_REQUEST_AFTER_MS, REVIEW_REQUEST_MAX_AGE_MS,
  type ReviewRequestCandidate, type ReviewRequestDeps,
} from "./reviewRequest";

const now = new Date("2026-10-10T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const DAY = 24 * 60 * 60 * 1000;

const row = (over: Partial<ReviewRequestCandidate> = {}): ReviewRequestCandidate => ({
  orderId: "o1", buyerId: "buyer_1", orderNumber: "#1042", status: "delivered",
  deliveredAt: ago(4 * DAY), totalCents: 5000, refundedCents: 0, autoRefundedAt: null,
  hasReview: false, alreadyRequested: false, productName: "Boxy tee", ...over,
});

describe("isReviewRequestDue", () => {
  it("asks 3 days after delivery when there is no review and no prior request", () => {
    expect(REVIEW_REQUEST_AFTER_MS).toBe(3 * DAY);
    expect(isReviewRequestDue(row(), now)).toBe(true);
    expect(isReviewRequestDue(row({ deliveredAt: ago(3 * DAY) }), now)).toBe(true);
    expect(isReviewRequestDue(row({ deliveredAt: ago(REVIEW_REQUEST_MAX_AGE_MS) }), now)).toBe(true);
  });

  it("waits until 3 days have passed and never asks about old orders", () => {
    expect(isReviewRequestDue(row({ deliveredAt: ago(3 * DAY - 1) }), now)).toBe(false);
    expect(isReviewRequestDue(row({ deliveredAt: ago(REVIEW_REQUEST_MAX_AGE_MS + 1) }), now)).toBe(false);
    expect(isReviewRequestDue(row({ deliveredAt: null }), now)).toBe(false);
  });

  it("skips reviewed, already-asked, guest, undelivered and refunded orders", () => {
    expect(isReviewRequestDue(row({ hasReview: true }), now)).toBe(false);
    expect(isReviewRequestDue(row({ alreadyRequested: true }), now)).toBe(false);
    expect(isReviewRequestDue(row({ buyerId: null }), now)).toBe(false);
    expect(isReviewRequestDue(row({ status: "shipped" }), now)).toBe(false);
    expect(isReviewRequestDue(row({ status: "cancelled" }), now)).toBe(false);
    expect(isReviewRequestDue(row({ autoRefundedAt: ago(DAY) }), now)).toBe(false);
    expect(isReviewRequestDue(row({ refundedCents: 5000 }), now)).toBe(false);
    expect(isReviewRequestDue(row({ refundedCents: 1000 }), now)).toBe(true);
  });
});

describe("copy and deep link", () => {
  it("deep-links to the order with the review form open", () => {
    expect(reviewRequestHref("a b")).toBe("/buyer-order-detail?id=a%20b&review=1");
  });
  it("names the product, falling back to the order number", () => {
    expect(buildReviewRequestCopy(row()).body).toBe("Rate Boxy tee and help other shoppers decide.");
    expect(buildReviewRequestCopy(row({ productName: null })).body).toContain("order #1042");
    expect(buildReviewRequestCopy(row()).title).not.toContain("!");
  });
});

describe("runReviewRequests", () => {
  function makeDeps(candidates: ReviewRequestCandidate[], opts: { notifyFails?: boolean; emailOn?: boolean } = {}) {
    const claimed = new Set<string>();
    const notify = vi.fn(async () => { if (opts.notifyFails) throw new Error("push down"); });
    const email = vi.fn(async () => opts.emailOn ?? true);
    const deps: ReviewRequestDeps = {
      findCandidates: async () => candidates,
      claim: async (orderId) => { if (claimed.has(orderId)) return false; claimed.add(orderId); return true; },
      release: async (orderId) => { claimed.delete(orderId); },
      notify,
      email,
    };
    return { deps, notify, email, claimed };
  }

  it("sends one review_request per due order, deep-linked, plus the email", async () => {
    const { deps, notify, email } = makeDeps([row(), row({ orderId: "o2", hasReview: true })]);
    expect(await runReviewRequests(now, deps)).toEqual({ notified: 1, emailed: 1 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      userId: "buyer_1", type: "review_request", targetId: "o1", targetType: "buyer_order",
    }));
    expect(email).toHaveBeenCalledTimes(1);
  });

  it("is idempotent across runs and replicas", async () => {
    const { deps, notify } = makeDeps([row()]);
    await runReviewRequests(now, deps);
    await runReviewRequests(now, deps);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when the push fails so the next run retries", async () => {
    const { deps, claimed, email } = makeDeps([row()], { notifyFails: true });
    expect(await runReviewRequests(now, deps)).toEqual({ notified: 0, emailed: 0 });
    expect(claimed.size).toBe(0);
    expect(email).not.toHaveBeenCalled();
  });

  it("counts no email when the buyer's email channel is off", async () => {
    const { deps } = makeDeps([row()], { emailOn: false });
    expect(await runReviewRequests(now, deps)).toEqual({ notified: 1, emailed: 0 });
  });
});
