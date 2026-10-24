import { describe, expect, it } from "vitest";
import { REVIEW_REPLY_MAX } from "../reviewContent";
import { checkReviewReplyText, reviewReplyAccess } from "../reviewReply";

describe("checkReviewReplyText", () => {
  it("trims and accepts a reply up to the limit", () => {
    expect(checkReviewReplyText("  Thanks!  ")).toEqual({ ok: true, text: "Thanks!" });
    expect(checkReviewReplyText("x".repeat(REVIEW_REPLY_MAX)).ok).toBe(true);
  });
  it("rejects empty, non-string and over-long replies", () => {
    expect(checkReviewReplyText("   ")).toEqual({ ok: false, error: "replyText is required" });
    expect(checkReviewReplyText(undefined).ok).toBe(false);
    expect(checkReviewReplyText(42).ok).toBe(false);
    expect(checkReviewReplyText("x".repeat(REVIEW_REPLY_MAX + 1))).toEqual({
      ok: false, error: `Replies can be up to ${REVIEW_REPLY_MAX} characters.`,
    });
  });
});

describe("reviewReplyAccess", () => {
  const review = { sellerId: "seller_1", sellerReply: "Thanks!" };
  it("lets the review's seller post, edit and delete their reply", () => {
    expect(reviewReplyAccess(review, "seller_1", false)).toBeNull();
    expect(reviewReplyAccess(review, "seller_1", true)).toBeNull();
    expect(reviewReplyAccess({ sellerId: "seller_1", sellerReply: null }, "seller_1", false)).toBeNull();
  });
  it("404s a missing review, and a missing reply for edit/delete", () => {
    expect(reviewReplyAccess(undefined, "seller_1", true)).toEqual({ status: 404, error: "Review not found" });
    expect(reviewReplyAccess({ sellerId: "seller_1", sellerReply: null }, "seller_1", true))
      .toEqual({ status: 404, error: "Reply not found" });
  });
  it("forbids anyone but the review's seller", () => {
    expect(reviewReplyAccess(review, "seller_2", true)).toEqual({ status: 403, error: "Forbidden" });
    expect(reviewReplyAccess(review, "buyer_1", false)).toEqual({ status: 403, error: "Forbidden" });
    expect(reviewReplyAccess({ sellerId: null }, "seller_1", false)).toEqual({ status: 403, error: "Forbidden" });
  });
});
