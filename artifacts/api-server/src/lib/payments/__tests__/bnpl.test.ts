import { beforeEach, describe, expect, it, vi } from "vitest";

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
  bnplPlatformEnabled, eligibleBnplMethods, paymentIntentMethodParams, paymentMethodTypesFor,
} from "../bnpl";
import { bnplMethodsForCart } from "../sellerPaymentSettings";

const base = { platformEnabled: true, sellerOptIns: [true], currency: "usd", amountCents: 5_000, shipToCountry: "US" };

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
    expect(eligibleBnplMethods({ ...base, amountCents: 99 })).toEqual([]);
    // Afterpay tops out below Klarna.
    expect(eligibleBnplMethods({ ...base, amountCents: 500_000 })).toEqual(["klarna"]);
    expect(eligibleBnplMethods({ ...base, amountCents: 1_000_001 })).toEqual([]);
    expect(eligibleBnplMethods({ ...base, amountCents: 50.5 })).toEqual([]);
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
  it("never throws: a database failure means card only", async () => {
    process.env.STRIPE_BNPL_ENABLED = "true";
    dbFails = true;
    expect(await bnplMethodsForCart(cart)).toEqual([]);
  });
});
