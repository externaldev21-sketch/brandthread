import { describe, expect, it } from "vitest";
import { SELLER_REFUND_NOTE_MAX, formatRefundAmount, parseSellerRefundRequest, sellerRefundBlockedReason } from "./sellerRefundRequest";

const valid = { amountCents: 1250, reason: "item_damaged", requestId: "abcd1234-xyz" };

describe("parseSellerRefundRequest", () => {
  it("accepts a valid request and trims the note", () => {
    const parsed = parseSellerRefundRequest({ ...valid, note: "  Torn seam  " });
    expect(parsed).toEqual({ ok: true, value: { ...valid, note: "Torn seam" } });
  });

  it("treats a blank or missing note as null", () => {
    expect(parseSellerRefundRequest(valid)).toMatchObject({ ok: true, value: { note: null } });
    expect(parseSellerRefundRequest({ ...valid, note: "   " })).toMatchObject({ ok: true, value: { note: null } });
  });

  it("refuses bad amounts", () => {
    for (const amountCents of [0, -5, 1.5, "100", undefined, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseSellerRefundRequest({ ...valid, amountCents })).toMatchObject({ ok: false, code: "INVALID_REFUND_AMOUNT" });
    }
  });

  it("refuses unknown reasons, long notes and malformed request ids", () => {
    expect(parseSellerRefundRequest({ ...valid, reason: "seller_cancelled" }).ok).toBe(false);
    expect(parseSellerRefundRequest({ ...valid, note: "x".repeat(SELLER_REFUND_NOTE_MAX + 1) }).ok).toBe(false);
    expect(parseSellerRefundRequest({ ...valid, note: 42 }).ok).toBe(false);
    expect(parseSellerRefundRequest({ ...valid, requestId: "short" }).ok).toBe(false);
    expect(parseSellerRefundRequest({ ...valid, requestId: "has spaces in it" }).ok).toBe(false);
    expect(parseSellerRefundRequest(null).ok).toBe(false);
  });
});

describe("sellerRefundBlockedReason", () => {
  const paid = { status: "shipped", autoRefundedAt: null, stripePaymentIntentId: "pi_1" };

  it("allows a paid order in any normal status", () => {
    expect(sellerRefundBlockedReason(paid)).toBeNull();
    expect(sellerRefundBlockedReason({ ...paid, status: "delivered" })).toBeNull();
    expect(sellerRefundBlockedReason({ ...paid, status: "processing" })).toBeNull();
  });

  it("blocks auto-refunded, in-flight and unpaid orders", () => {
    expect(sellerRefundBlockedReason({ ...paid, autoRefundedAt: new Date() })?.code).toBe("AUTO_REFUNDED");
    expect(sellerRefundBlockedReason({ ...paid, status: "refund_pending" })?.code).toBe("REFUND_IN_PROGRESS");
    expect(sellerRefundBlockedReason({ ...paid, stripePaymentIntentId: null })?.code).toBe("NOT_REFUNDABLE");
  });
});

describe("formatRefundAmount", () => {
  it("formats cents as dollars", () => {
    expect(formatRefundAmount(1250)).toBe("$12.50");
    expect(formatRefundAmount(5)).toBe("$0.05");
  });
});
