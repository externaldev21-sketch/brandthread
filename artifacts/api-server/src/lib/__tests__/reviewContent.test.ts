import { describe, expect, it } from "vitest";
import {
  MAX_REVIEW_PHOTOS, REVIEW_BODY_MAX, normalizeReviewBody, parseFitNote, reviewExtras,
  reviewPhotoPrefix, validateReviewPhotos,
} from "../reviewContent";
import { ANSWER_MAX, QUESTION_MAX, canAnswerQuestion, checkAnswer, checkQuestion } from "../productQa";

describe("parseFitNote", () => {
  it("maps the three chips to a scale and ignores case", () => {
    expect(parseFitNote("Runs small")).toEqual({ fitNote: "Runs small", fitScale: -1 });
    expect(parseFitNote("true to size")).toEqual({ fitNote: "True to size", fitScale: 0 });
    expect(parseFitNote("RUNS LARGE")).toEqual({ fitNote: "Runs large", fitScale: 1 });
  });
  it("treats empty as no answer and anything else as invalid", () => {
    expect(parseFitNote(undefined)).toBeUndefined();
    expect(parseFitNote("")).toBeUndefined();
    expect(parseFitNote("tiny")).toBeNull();
    expect(parseFitNote(3)).toBeNull();
  });
});

describe("validateReviewPhotos", () => {
  const mine = `${reviewPhotoPrefix("user_1")}abc`;
  it("accepts the buyer's own uploads and de-duplicates", () => {
    expect(validateReviewPhotos([mine, mine], "user_1")).toEqual({ ok: true, photos: [mine] });
    expect(validateReviewPhotos(undefined, "user_1")).toEqual({ ok: true, photos: [] });
  });
  it("rejects other buyers' paths, urls, traversal and oversize lists", () => {
    expect(validateReviewPhotos([mine], "user_2").ok).toBe(false);
    expect(validateReviewPhotos(["https://evil.example/x.jpg"], "user_1").ok).toBe(false);
    expect(validateReviewPhotos([`${reviewPhotoPrefix("user_1")}../../x`], "user_1").ok).toBe(false);
    expect(validateReviewPhotos(Array.from({ length: MAX_REVIEW_PHOTOS + 1 }, (_, i) => `${mine}${i}`), "user_1").ok).toBe(false);
    expect(validateReviewPhotos("nope", "user_1").ok).toBe(false);
  });
  it("sanitizes the buyer id into the prefix", () => {
    expect(reviewPhotoPrefix("user/../x")).toBe("/objects/reviews/user____x/");
  });
});

describe("normalizeReviewBody", () => {
  it("trims, nulls blanks and enforces the limit", () => {
    expect(normalizeReviewBody("  great  ")).toEqual({ ok: true, body: "great" });
    expect(normalizeReviewBody("   ")).toEqual({ ok: true, body: null });
    expect(normalizeReviewBody(undefined)).toEqual({ ok: true, body: null });
    expect(normalizeReviewBody("x".repeat(REVIEW_BODY_MAX + 1)).ok).toBe(false);
    expect(normalizeReviewBody(5).ok).toBe(false);
  });
});

describe("reviewExtras", () => {
  it("derives verifiedPurchase from the order link only", () => {
    const base = { photos: [], helpfulCount: 0, viewerHelpful: false };
    expect(reviewExtras({ order_id: "o1" }, base).verifiedPurchase).toBe(true);
    expect(reviewExtras({ orderId: "o1" }, base).verifiedPurchase).toBe(true);
    expect(reviewExtras({ order_id: null }, base).verifiedPurchase).toBe(false);
    expect(reviewExtras({ verifiedPurchase: true }, base).verifiedPurchase).toBe(false);
  });
  it("maps snake and camel rows to the same public fields", () => {
    const extras = reviewExtras(
      { order_id: "o", seller_reply: "Thanks", seller_replied_at: "t", size_bought: "M", fit_note: "True to size", fit_scale: 0, buyer_name: "Ada", buyer_avatar: null },
      { photos: ["u"], helpfulCount: 3, viewerHelpful: true },
    );
    expect(extras).toMatchObject({
      sellerReply: "Thanks", sizeBought: "M", fitNote: "True to size", fitScale: 0,
      photos: ["u"], helpfulCount: 3, viewerHelpful: true, buyerName: "Ada", buyerAvatar: null,
    });
  });
});

describe("product Q&A text rules", () => {
  it("collapses whitespace and enforces length", () => {
    expect(checkQuestion("  Does   this run\nsmall? ")).toEqual({ ok: true, text: "Does this run small?" });
    expect(checkQuestion("hey").ok).toBe(false);
    expect(checkQuestion("x".repeat(QUESTION_MAX + 1)).ok).toBe(false);
    expect(checkQuestion(null).ok).toBe(false);
    expect(checkAnswer("Yes").ok).toBe(true);
    expect(checkAnswer("   ").ok).toBe(false);
    expect(checkAnswer("x".repeat(ANSWER_MAX + 1)).ok).toBe(false);
  });
  it("only the owning seller can answer", () => {
    expect(canAnswerQuestion("seller_1", "seller_1")).toBe(true);
    expect(canAnswerQuestion("seller_1", "seller_2")).toBe(false);
    expect(canAnswerQuestion(null, "seller_1")).toBe(false);
  });
});
