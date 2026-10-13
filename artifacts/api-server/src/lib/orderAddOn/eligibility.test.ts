import { describe, expect, it } from "vitest";
import { ADD_ON_WINDOW_MS, addOnExpiresAt, addOnIneligibleReason, reusableCard } from "./eligibility";

const paidAt = new Date("2026-10-13T12:00:00.000Z");
const base = {
  buyerId: "buyer_1", status: "processing", paidAt, trackingNumber: null, isPreorder: false, stripePaymentIntentId: "pi_1",
};

describe("addOnIneligibleReason", () => {
  it("is open for the buyer inside the window", () => {
    expect(addOnIneligibleReason(base, "buyer_1", new Date(paidAt.getTime() + ADD_ON_WINDOW_MS - 1))).toBeNull();
  });

  it("closes at the end of the window", () => {
    expect(addOnIneligibleReason(base, "buyer_1", new Date(paidAt.getTime() + ADD_ON_WINDOW_MS))).toBe("WINDOW_CLOSED");
    expect(addOnExpiresAt(paidAt).getTime()).toBe(paidAt.getTime() + ADD_ON_WINDOW_MS);
  });

  it("refuses other buyers, unpaid, cancelled, shipped and preorder orders", () => {
    const at = new Date(paidAt.getTime() + 1000);
    expect(addOnIneligibleReason(base, "someone_else", at)).toBe("NOT_YOUR_ORDER");
    expect(addOnIneligibleReason({ ...base, buyerId: null }, "buyer_1", at)).toBe("NOT_YOUR_ORDER");
    expect(addOnIneligibleReason({ ...base, paidAt: null }, "buyer_1", at)).toBe("NOT_PAID");
    expect(addOnIneligibleReason({ ...base, status: "cancelled" }, "buyer_1", at)).toBe("CANCELLED");
    expect(addOnIneligibleReason({ ...base, trackingNumber: "1Z" }, "buyer_1", at)).toBe("ALREADY_SHIPPED");
    expect(addOnIneligibleReason({ ...base, status: "shipped" }, "buyer_1", at)).toBe("ALREADY_SHIPPED");
    expect(addOnIneligibleReason({ ...base, isPreorder: true }, "buyer_1", at)).toBe("PREORDER");
    expect(addOnIneligibleReason({ ...base, stripePaymentIntentId: null }, "buyer_1", at)).toBe("NO_PAYMENT");
  });
});

describe("reusableCard", () => {
  const card = { id: "pm_1", type: "card", customer: "cus_1", card: { brand: "visa", last4: "4242" } };

  it("returns a card saved on the order's customer", () => {
    expect(reusableCard({ customer: "cus_1", payment_method: card }))
      .toEqual({ customerId: "cus_1", paymentMethodId: "pm_1", brand: "visa", last4: "4242" });
  });

  it("refuses unsaved cards, other customers' cards, BNPL and unexpanded methods", () => {
    expect(reusableCard({ customer: "cus_1", payment_method: { ...card, customer: null } })).toBeNull();
    expect(reusableCard({ customer: "cus_1", payment_method: { ...card, customer: "cus_2" } })).toBeNull();
    expect(reusableCard({ customer: "cus_1", payment_method: { ...card, type: "klarna" } })).toBeNull();
    expect(reusableCard({ customer: "cus_1", payment_method: "pm_1" })).toBeNull();
    expect(reusableCard({ customer: null, payment_method: card })).toBeNull();
  });
});
