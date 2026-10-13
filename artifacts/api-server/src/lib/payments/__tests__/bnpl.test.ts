import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows: Array<{ sellerId: string; bnplEnabled: boolean }> = [];
let dbFails = false;
vi.mock("@workspace/db", () => ({
  sellerPaymentSettings: { sellerId: "seller_id", bnplEnabled: "bnpl_enabled" },
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (dbFails) throw new Error("db down");
          return rows;
        },
      }),
    }),
  },
}));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  DEFAULT_BNPL_MIN_ORDER_CENTS, bnplInstallment, bnplMinOrderCents, bnplPlatformEnabled, eligibleBnplMethods, paymentIntentMethodParams, paymentMethodTypesFor,
} from "../bnpl";
import { bnplMethodsForCart } from "../sellerPaymentSettings";

const base = { platformEnabled: true, sellerOptIns: [true], currency: "usd", amountCents: 10_000, shipToCountry: "US" };

describe("bnplPlatformEnabled", () => {
  it("is off unless explicitly turned on", () => {
    expect(bnplPlatformEnabled({})).toBe(false);
    expect(bnplPlatformEnabled({ STRIPE_BNPL_ENABLED: "" })).toBe(false);
    expect(bnplPlatformEnabled({ STRIPE_BNPL_ENABLED: "maybe" })).toBe(false);
    expect(bnplPlatformEnabled({ STRIPE_BNPL_ENABLED: "false" })).toBe(false);
    expect(bnplPlatformEnabled({ STRIPE_BNPL_ENABLED: "true" })).toBe(true);
    expect(bnplPlatformEnabled({ STRIPE_BNPL_ENABLED: " 1 " })).toBe(true);
  });
});

describe("eligibleBnplMethods", () => {
  it("offers both methods for an eligible US cart", () => {
    expect(eligibleBnplMethods(base)).toEqual(["klarna", "afterpay_clearpay"]);
  });
  it("needs the platform flag", () => {
    expect(eligibleBnplMethods({ ...base, platformEnabled: false })).toEqual([]);
  });
  it("needs EVERY seller to opt in, and at least one seller", () => {
    expect(eligibleBnplMethods({ ...base, sellerOptIns: [true, false] })).toEqual([]);
    expect(eligibleBnplMethods({ ...base, sellerOptIns: [true, true] })).toHaveLength(2);
    expect(eligibleBnplMethods({ ...base, sellerOptIns: [] })).toEqual([]);
  });
  it("checks currency, country and amount limits per method", () => {
    expect(eligibleBnplMethods({ ...base, currency: "eur" })).toEqual([]);
    expect(eligibleBnplMethods({ ...base, shipToCountry: "CA" })).toEqual([]);
    expect(eligibleBnplMethods({ ...base, shipToCountry: "us" })).toHaveLength(2);
    expect(eligibleBnplMethods({ ...base, amountCents: 99, minOrderCents: 0 })).toEqual([]);
    // Afterpay tops out below Klarna.
    expect(eligibleBnplMethods({ ...base, amountCents: 500_000 })).toEqual(["klarna"]);
    expect(eligibleBnplMethods({ ...base, amountCents: 1_000_001 })).toEqual([]);
    expect(eligibleBnplMethods({ ...base, amountCents: 50.5 })).toEqual([]);
  });
});

describe("BNPL minimum order total", () => {
  beforeEach(() => { delete process.env.BNPL_MIN_ORDER_CENTS; });
  afterEach(() => { delete process.env.BNPL_MIN_ORDER_CENTS; });

  it("defaults to $75", () => {
    expect(DEFAULT_BNPL_MIN_ORDER_CENTS).toBe(7_500);
    expect(bnplMinOrderCents({})).toBe(7_500);
  });
  it("is off under $75, on at and over $75", () => {
    expect(eligibleBnplMethods({ ...base, amountCents: 7_499 })).toEqual([]);
    expect(eligibleBnplMethods({ ...base, amountCents: 7_500 })).toEqual(["klarna", "afterpay_clearpay"]);
    expect(eligibleBnplMethods({ ...base, amountCents: 7_501 })).toEqual(["klarna", "afterpay_clearpay"]);
  });
  it("reads BNPL_MIN_ORDER_CENTS", () => {
    expect(bnplMinOrderCents({ BNPL_MIN_ORDER_CENTS: "10000" })).toBe(10_000);
    expect(bnplMinOrderCents({ BNPL_MIN_ORDER_CENTS: " 0 " })).toBe(0);
    process.env.BNPL_MIN_ORDER_CENTS = "10000";
    expect(eligibleBnplMethods({ ...base, amountCents: 9_999 })).toEqual([]);
    expect(eligibleBnplMethods({ ...base, amountCents: 10_000 })).toHaveLength(2);
  });
  it("falls back to $75 for an invalid value", () => {
    for (const bad of ["", "abc", "-100", "75.5", "1e4", "99999999999999999999"]) {
      expect(bnplMinOrderCents({ BNPL_MIN_ORDER_CENTS: bad })).toBe(7_500);
    }
    process.env.BNPL_MIN_ORDER_CENTS = "junk";
    expect(eligibleBnplMethods({ ...base, amountCents: 7_499 })).toEqual([]);
    expect(eligibleBnplMethods({ ...base, amountCents: 7_500 })).toHaveLength(2);
  });
  it("an explicit minOrderCents wins over the env", () => {
    process.env.BNPL_MIN_ORDER_CENTS = "50000";
    expect(eligibleBnplMethods({ ...base, amountCents: 10_000, minOrderCents: 7_500 })).toHaveLength(2);
  });
  it("the platform flag off is still off above the minimum", () => {
    expect(eligibleBnplMethods({ ...base, platformEnabled: false, amountCents: 50_000 })).toEqual([]);
  });
});

describe("bnplInstallment", () => {
  it("splits an even total into 4 equal payments", () => {
    expect(bnplInstallment(9_500)).toEqual([2_375, 2_375, 2_375, 2_375]);
  });
  it("puts the rounding remainder on the first payment", () => {
    expect(bnplInstallment(9_501)).toEqual([2_376, 2_375, 2_375, 2_375]);
    expect(bnplInstallment(9_503)).toEqual([2_378, 2_375, 2_375, 2_375]);
    expect(bnplInstallment(7_501)).toEqual([1_876, 1_875, 1_875, 1_875]);
  });
  it("always sums to the total", () => {
    for (const total of [0, 1, 3, 7_500, 12_345, 99_999, 400_000]) {
      const parts = bnplInstallment(total);
      expect(parts).toHaveLength(4);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
    }
  });
  it("treats junk as zero", () => {
    expect(bnplInstallment(Number.NaN)).toEqual([0, 0, 0, 0]);
    expect(bnplInstallment(-500)).toEqual([0, 0, 0, 0]);
  });
});

describe("paymentIntentMethodParams", () => {
  it("card only keeps the existing top-level setup_future_usage", () => {
    expect(paymentIntentMethodParams([], true)).toEqual({ payment_method_types: ["card"], setup_future_usage: "off_session" });
    expect(paymentIntentMethodParams([], false)).toEqual({ payment_method_types: ["card"] });
  });
  it("never sets top-level setup_future_usage when BNPL is offered (Stripe rejects the combination)", () => {
    const params = paymentIntentMethodParams(["klarna", "afterpay_clearpay"], true);
    expect(params).not.toHaveProperty("setup_future_usage");
    expect(params.payment_method_types).toEqual(["card", "klarna", "afterpay_clearpay"]);
    expect((params as any).payment_method_options).toEqual({ card: { setup_future_usage: "off_session" } });
    expect(paymentIntentMethodParams(["klarna"], false)).toEqual({ payment_method_types: ["card", "klarna"] });
  });
  it("lists card first", () => {
    expect(paymentMethodTypesFor(["klarna"])).toEqual(["card", "klarna"]);
  });
});

describe("bnplMethodsForCart", () => {
  beforeEach(() => {
    rows.length = 0;
    dbFails = false;
    delete process.env.STRIPE_BNPL_ENABLED;
  });
  const cart = { sellerIds: ["a", "b"], amountCents: 8_000, shipToCountry: "US" };

  it("is empty while the platform flag is off, even if sellers opted in", async () => {
    rows.push({ sellerId: "a", bnplEnabled: true }, { sellerId: "b", bnplEnabled: true });
    expect(await bnplMethodsForCart(cart)).toEqual([]);
  });
  it("offers BNPL only when every seller in the cart opted in", async () => {
    process.env.STRIPE_BNPL_ENABLED = "true";
    rows.push({ sellerId: "a", bnplEnabled: true });
    expect(await bnplMethodsForCart(cart)).toEqual([]);
    rows.push({ sellerId: "b", bnplEnabled: true });
    expect(await bnplMethodsForCart(cart)).toEqual(["klarna", "afterpay_clearpay"]);
    rows[1].bnplEnabled = false;
    expect(await bnplMethodsForCart(cart)).toEqual([]);
  });
  it("a cart under the $75 minimum is card only", async () => {
    process.env.STRIPE_BNPL_ENABLED = "true";
    rows.push({ sellerId: "a", bnplEnabled: true }, { sellerId: "b", bnplEnabled: true });
    expect(await bnplMethodsForCart({ ...cart, amountCents: 7_499 })).toEqual([]);
    expect(await bnplMethodsForCart({ ...cart, amountCents: 7_500 })).toEqual(["klarna", "afterpay_clearpay"]);
  });
  it("never throws: a database failure means card only", async () => {
    process.env.STRIPE_BNPL_ENABLED = "true";
    dbFails = true;
    expect(await bnplMethodsForCart(cart)).toEqual([]);
  });
});
