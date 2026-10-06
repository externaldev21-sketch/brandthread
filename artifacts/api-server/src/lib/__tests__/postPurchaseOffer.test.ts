import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Post-purchase offer: the server decides eligibility and the price. The
 * database is a small in-memory fake keyed by table; Stripe is a stub that
 * records the PaymentIntent it is asked to create.
 */
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  checkoutMode: "accounts_optional" as string,
  reserved: [] as Array<{ id: string; lines: unknown }>,
  released: [] as string[],
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: { column: string }, value: unknown) => ({ op: "eq", column: column.column, value }),
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  isNull: (column: { column: string }) => ({ op: "isNull", column: column.column }),
  inArray: (column: { column: string }, values: unknown[]) => ({ op: "in", column: column.column, values }),
  desc: (column: unknown) => column,
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ __table: name } as Record<string, unknown>, {
    get: (target, key) => key === "__table" ? target.__table : { table: name, column: String(key) },
  });
  const matches = (row: Record<string, any>, where: any): boolean => {
    if (!where) return true;
    if (where.op === "and") return where.conditions.every((c: any) => matches(row, c));
    if (where.op === "eq") return row[where.column] === where.value;
    if (where.op === "isNull") return row[where.column] == null;
    if (where.op === "in") return where.values.includes(row[where.column]);
    return true;
  };
  const rowsOf = (t: any) => (state.tables[t.__table] ??= []);
  const db: any = {
    select: () => ({
      from: (t: any) => {
        let where: any = null;
        const result = () => rowsOf(t).filter((r) => matches(r, where));
        const chain: any = {
          where: (w: any) => { where = w; return chain; },
          orderBy: () => chain,
          for: async () => result(),
          limit: async (n: number) => result().slice(0, n),
          then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
        };
        return chain;
      },
    }),
    insert: (t: any) => ({
      values: (values: Record<string, any>) => {
        const write = () => {
          const row = { id: `${t.__table}-${rowsOf(t).length + 1}`, createdAt: new Date(), ...values };
          const existing = t.__table === "seller_post_purchase_offers" ? rowsOf(t).find((r) => r.sellerId === values.sellerId) : null;
          if (existing) { Object.assign(existing, values); return existing; }
          rowsOf(t).push(row);
          return row;
        };
        return {
          returning: async () => [write()],
          onConflictDoUpdate: async () => [write()],
        };
      },
    }),
    update: (t: any) => ({
      set: (values: Record<string, any>) => ({
        where: async (where: any) => { for (const r of rowsOf(t).filter((row) => matches(row, where))) Object.assign(r, values); },
      }),
    }),
    delete: (t: any) => ({
      where: async (where: any) => { state.tables[t.__table] = rowsOf(t).filter((r) => !matches(r, where)); },
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return {
    db,
    orders: table("orders"),
    checkoutSessions: table("checkout_sessions"),
    products: table("products"),
    productVariants: table("product_variants"),
    sellerPostPurchaseOffers: table("seller_post_purchase_offers"),
    stockReservations: table("stock_reservations"),
    users: table("users"),
  };
});

vi.mock("../sellerCheckoutSettings", () => ({
  loadSellerCheckoutSettings: async (ids: string[]) => new Map(ids.map((id) => [id, { checkoutMode: state.checkoutMode, tippingEnabled: false, storeLanguage: "en" }])),
}));

vi.mock("../money/stockReservation", () => ({
  reserveStock: async (_tx: unknown, id: string, lines: unknown) => { state.reserved.push({ id, lines }); },
  releaseStockReservation: async (_tx: unknown, id: string) => { state.released.push(id); return 1; },
}));

vi.mock("../money/cartCheckout", () => ({
  CART_CHECKOUT_KIND: "cart_checkout",
  MIN_CARD_CHARGE_CENTS: 50,
  CartCheckoutError: class extends Error {},
  // The real one re-reads the variant's price from the DB; so does this stub.
  priceCartGroup: async (input: { items: Array<{ variantId: string; productId: string; quantity: number }> }) => {
    const variant = state.tables.product_variants.find((v) => v.id === input.items[0].variantId)!;
    return {
      sellerId: "seller_1", sellerStripeAccountId: "acct_1",
      items: [{ variantId: variant.id, productId: input.items[0].productId, productName: "Hoodie", variantLabel: "M", quantity: 1, priceCents: variant.priceCents }],
      subtotalCents: variant.priceCents, shippingCents: 800, shippingLineName: "Shipping", processingDays: null,
      discountCodeId: null, discountCode: null, discountCents: 0, merchandiseDiscountCents: 0, shippingDiscountCents: 0,
      platformFeeCents: 0, processingFeeEstimateCents: 0,
    };
  },
  calculateGroupTax: async (_stripe: unknown, group: { subtotalCents: number; merchandiseDiscountCents: number }) => ({
    taxCents: Math.round((group.subtotalCents - group.merchandiseDiscountCents) * 0.1), calculationId: "taxcalc_1",
  }),
}));

vi.mock("../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  MAX_OFFER_DISCOUNT_PERCENT, OFFER_WINDOW_MS, acceptOffer, checkEligibility, offerForOrder, offerPriceCents,
  saveOfferSettings, validateOfferPatch,
} from "../postPurchaseOffer";

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VARIANT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function stripeStub(paymentMethod: Record<string, unknown> | null = { id: "pm_1", type: "card", customer: "cus_buyer", card: { brand: "visa", last4: "4242" } }) {
  const created: any[] = [];
  return {
    created,
    paymentIntents: {
      retrieve: vi.fn(async () => ({ id: "pi_original", payment_method: paymentMethod })),
      create: vi.fn(async (params: any) => { created.push(params); return { id: "pi_upsell", status: "succeeded", client_secret: "secret", amount: params.amount }; }),
      cancel: vi.fn(async () => ({})),
    },
    tax: {},
  } as any;
}

function seed(overrides: { paidAt?: Date; offer?: Partial<Record<string, any>>; stock?: number; productOwner?: string } = {}) {
  state.tables = {
    orders: [{
      id: ORDER_ID, buyerId: "buyer_1", ownerId: "seller_1", orderNumber: "BT-00007", status: "pending",
      paidAt: overrides.paidAt ?? new Date(), stripePaymentIntentId: "pi_original", upsellOfOrderId: null,
      shippingAddress: { name: "Ana", street: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US" },
    }],
    seller_post_purchase_offers: [{ sellerId: "seller_1", enabled: true, productId: PRODUCT_ID, discountPercent: 20, ...overrides.offer }],
    products: [{ id: PRODUCT_ID, name: "Hoodie", images: ["https://img/h.jpg"], ownerId: overrides.productOwner ?? "seller_1", status: "active", deletedAt: null }],
    product_variants: [{ id: VARIANT_ID, productId: PRODUCT_ID, priceCents: 6_000, stock: overrides.stock ?? 3, size: "M", color: null }],
    users: [{ clerkId: "buyer_1", stripeCustomerId: "cus_buyer" }, { clerkId: "seller_1", name: "Northline", brandName: "Northline" }],
    checkout_sessions: [],
    stock_reservations: [],
  };
}

beforeEach(() => {
  state.checkoutMode = "accounts_optional";
  state.reserved = [];
  state.released = [];
  seed();
});

describe("offer price and settings validation", () => {
  it("discounts half-up to the cent and caps at 50%", () => {
    expect(offerPriceCents(6_000, 20)).toBe(4_800);
    expect(offerPriceCents(1_999, 15)).toBe(1_699);
    expect(offerPriceCents(1_000, 90)).toBe(500);
    expect(MAX_OFFER_DISCOUNT_PERCENT).toBe(50);
  });

  it("requires a product when on and a whole-number discount within 0–50", () => {
    expect(validateOfferPatch({ enabled: true, productId: PRODUCT_ID, discountPercent: 10 })).toMatchObject({ ok: true });
    expect(validateOfferPatch({ enabled: true, productId: null })).toEqual({ ok: false, error: "Choose a product to offer" });
    expect(validateOfferPatch({ enabled: false, productId: PRODUCT_ID, discountPercent: 51 })).toMatchObject({ ok: false });
    expect(validateOfferPatch({ enabled: false, discountPercent: 12.5 })).toMatchObject({ ok: false });
    expect(validateOfferPatch({ enabled: "yes" })).toMatchObject({ ok: false });
    expect(validateOfferPatch({ enabled: true, productId: "not-a-uuid" })).toMatchObject({ ok: false });
  });

  it("only lets a seller offer their own active, in-stock product", async () => {
    await expect(saveOfferSettings("seller_2", { enabled: true, productId: PRODUCT_ID, discountPercent: 0 }))
      .rejects.toMatchObject({ code: "INVALID_PRODUCT" });
    state.tables.product_variants[0].stock = 0;
    await expect(saveOfferSettings("seller_1", { enabled: true, productId: PRODUCT_ID, discountPercent: 0 }))
      .rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    state.tables.product_variants[0].stock = 2;
    await expect(saveOfferSettings("seller_1", { enabled: true, productId: PRODUCT_ID, discountPercent: 25 }))
      .resolves.toEqual({ enabled: true, productId: PRODUCT_ID, discountPercent: 25 });
  });
});

describe("eligibility", () => {
  it("offers the seller's product at the discounted price with the original card", async () => {
    const offer = await offerForOrder(stripeStub(), "buyer_1", ORDER_ID);
    expect(offer).toMatchObject({
      available: true, sellerName: "Northline", discountPercent: 20,
      product: { id: PRODUCT_ID, name: "Hoodie" },
      variants: [{ variantId: VARIANT_ID, priceCents: 6_000, offerPriceCents: 4_800, inStock: true }],
      card: { brand: "visa", last4: "4242" },
    });
  });

  it.each([
    ["someone else's order", () => { state.tables.orders[0].buyerId = "buyer_2"; }, "ORDER_NOT_FOUND"],
    ["an unpaid order", () => { state.tables.orders[0].paidAt = null; }, "ORDER_NOT_PAID"],
    ["an order that is itself an offer", () => { state.tables.orders[0].upsellOfOrderId = "x"; }, "ALREADY_AN_OFFER"],
    ["an old order", () => { state.tables.orders[0].paidAt = new Date(Date.now() - OFFER_WINDOW_MS - 1_000); }, "EXPIRED"],
    ["the offer turned off", () => { state.tables.seller_post_purchase_offers[0].enabled = false; }, "NO_OFFER"],
    ["a Guest checkout only store", () => { state.checkoutMode = "guest_only"; }, "GUEST_CHECKOUT_ONLY"],
    ["an archived product", () => { state.tables.products[0].status = "archived"; }, "PRODUCT_UNAVAILABLE"],
    ["another seller's product", () => { state.tables.products[0].ownerId = "seller_9"; }, "PRODUCT_UNAVAILABLE"],
    ["an out-of-stock product", () => { state.tables.product_variants[0].stock = 0; }, "OUT_OF_STOCK"],
  ])("refuses %s", async (_label, mutate, reason) => {
    mutate();
    expect(await checkEligibility(stripeStub(), "buyer_1", ORDER_ID)).toMatchObject({ ok: false, reason });
  });

  it("refuses when the original card isn't saved on the buyer's customer", async () => {
    expect(await checkEligibility(stripeStub({ id: "pm_x", type: "card", customer: null }), "buyer_1", ORDER_ID))
      .toMatchObject({ ok: false, reason: "NO_SAVED_PAYMENT_METHOD" });
    expect(await checkEligibility(stripeStub({ id: "pm_x", type: "card", customer: "cus_other" }), "buyer_1", ORDER_ID))
      .toMatchObject({ ok: false, reason: "NO_SAVED_PAYMENT_METHOD" });
  });

  it("refuses once an offer was accepted for the order", async () => {
    state.tables.orders.push({ id: "o2", buyerId: "buyer_1", ownerId: "seller_1", upsellOfOrderId: ORDER_ID, paidAt: new Date() });
    expect(await checkEligibility(stripeStub(), "buyer_1", ORDER_ID)).toMatchObject({ ok: false, reason: "ALREADY_ACCEPTED", acceptedOrderId: "o2" });
  });
});

describe("acceptOffer", () => {
  it("charges the original card the server's price, ships with the order, and links the checkout to it", async () => {
    const stripe = stripeStub();
    const result = await acceptOffer(stripe, { buyerId: "buyer_1", orderId: ORDER_ID, variantId: VARIANT_ID, clientIdempotencyKey: "key-12345678" });
    // $60.00 − 20% = $48.00, no shipping, 10% tax = $4.80.
    expect(result).toMatchObject({ paymentIntentId: "pi_upsell", status: "succeeded", amountCents: 5_280, subtotalCents: 6_000, discountCents: 1_200, taxCents: 480, clientSecret: null });
    expect(stripe.created[0]).toMatchObject({
      amount: 5_280, currency: "usd", customer: "cus_buyer", payment_method: "pm_1", confirm: true,
      metadata: { kind: "cart_checkout", upsellOfOrderId: ORDER_ID },
    });
    const row = state.tables.checkout_sessions[0];
    expect(row).toMatchObject({
      upsellOfOrderId: ORDER_ID, chargeModel: "transfer", shippingCents: 0, amountTotalCents: 5_280,
      stripePaymentIntentId: "pi_upsell", items: [{ variantId: VARIANT_ID, priceCents: 6_000, quantity: 1 }],
    });
    expect(state.reserved).toHaveLength(1);
  });

  it("returns the same payment for a repeated tap instead of charging twice", async () => {
    const stripe = stripeStub();
    await acceptOffer(stripe, { buyerId: "buyer_1", orderId: ORDER_ID, variantId: VARIANT_ID, clientIdempotencyKey: "key-12345678" });
    stripe.paymentIntents.retrieve.mockImplementation(async (id: string) => (id === "pi_upsell"
      ? { id: "pi_upsell", status: "succeeded", amount: 5_280, payment_method: "pm_1" }
      : { id: "pi_original", payment_method: { id: "pm_1", type: "card", customer: "cus_buyer", card: {} } }));
    const again = await acceptOffer(stripe, { buyerId: "buyer_1", orderId: ORDER_ID, variantId: VARIANT_ID, clientIdempotencyKey: "other-key-1" });
    expect(again.paymentIntentId).toBe("pi_upsell");
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a variant of a different product and gives the unit back on a decline", async () => {
    await expect(acceptOffer(stripeStub(), { buyerId: "buyer_1", orderId: ORDER_ID, variantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", clientIdempotencyKey: "key-12345678" }))
      .rejects.toMatchObject({ code: "INVALID_VARIANT" });
    const stripe = stripeStub();
    stripe.paymentIntents.create.mockRejectedValueOnce(Object.assign(new Error("Your card was declined."), {
      type: "StripeCardError", code: "card_declined", decline_code: "insufficient_funds", raw: { payment_intent: { id: "pi_failed" } },
    }));
    await expect(acceptOffer(stripe, { buyerId: "buyer_1", orderId: ORDER_ID, variantId: VARIANT_ID, clientIdempotencyKey: "key-12345678" }))
      .rejects.toMatchObject({ status: 402, code: "insufficient_funds" });
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_failed");
    expect(state.released).toHaveLength(1);
    expect(state.tables.checkout_sessions).toHaveLength(0);
  });
});
