import { describe, expect, it } from "vitest";
import {
  STITCH_MAX_CLIP_MS, brandRepostNeedsPermission, isQualifyingPurchase, nextRepostRequestStatus, validateStitchClip,
} from "./fitsRules";

describe("validateStitchClip", () => {
  it("accepts no clip (photo originals) as 0..0", () => {
    expect(validateStitchClip(undefined, undefined)).toEqual({ ok: true, startMs: 0, endMs: 0 });
  });
  it("accepts up to 5 seconds", () => {
    expect(validateStitchClip(1000, 1000 + STITCH_MAX_CLIP_MS)).toEqual({ ok: true, startMs: 1000, endMs: 6000 });
  });
  it("rejects longer clips, reversed ranges, negatives and non-integers", () => {
    expect(validateStitchClip(0, 5001).ok).toBe(false);
    expect(validateStitchClip(3000, 2000).ok).toBe(false);
    expect(validateStitchClip(-1, 1000).ok).toBe(false);
    expect(validateStitchClip(0.5, 1000).ok).toBe(false);
    expect(validateStitchClip(0, undefined).ok).toBe(false);
    expect(validateStitchClip(11 * 60_000 - 1000, 11 * 60_000).ok).toBe(false);
  });
});

describe("isQualifyingPurchase", () => {
  const paid = new Date();
  it("needs a paid, live, unrefunded line", () => {
    expect(isQualifyingPurchase({ orderStatus: "delivered", paidAt: paid, itemRefundedAt: null })).toBe(true);
    expect(isQualifyingPurchase({ orderStatus: "processing", paidAt: paid, itemRefundedAt: null })).toBe(true);
    expect(isQualifyingPurchase({ orderStatus: "delivered", paidAt: null, itemRefundedAt: null })).toBe(false);
    expect(isQualifyingPurchase({ orderStatus: "cancelled", paidAt: paid, itemRefundedAt: null })).toBe(false);
    expect(isQualifyingPurchase({ orderStatus: "pending", paidAt: paid, itemRefundedAt: null })).toBe(false);
    expect(isQualifyingPurchase({ orderStatus: "delivered", paidAt: paid, itemRefundedAt: paid })).toBe(false);
  });
});

describe("nextRepostRequestStatus", () => {
  it("owner approves or declines a pending request", () => {
    expect(nextRepostRequestStatus("pending", "approve", "owner")).toEqual({ ok: true, status: "approved" });
    expect(nextRepostRequestStatus("pending", "decline", "owner")).toEqual({ ok: true, status: "declined" });
  });
  it("only the requester cancels; only the owner answers", () => {
    expect(nextRepostRequestStatus("pending", "cancel", "requester")).toEqual({ ok: true, status: "cancelled" });
    expect(nextRepostRequestStatus("pending", "cancel", "owner")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(nextRepostRequestStatus("pending", "approve", "requester")).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it("answered requests never move", () => {
    for (const s of ["approved", "declined", "cancelled"] as const) {
      expect(nextRepostRequestStatus(s, "approve", "owner")).toEqual({ ok: false, code: "NOT_PENDING" });
    }
  });
});

describe("brandRepostNeedsPermission", () => {
  it("applies to brands reposting buyers only", () => {
    expect(brandRepostNeedsPermission("seller", "buyer", false)).toBe(true);
    expect(brandRepostNeedsPermission("buyer", "buyer", false)).toBe(false);
    expect(brandRepostNeedsPermission("seller", "seller", false)).toBe(false);
    expect(brandRepostNeedsPermission("seller", "buyer", true)).toBe(false);
  });
});
