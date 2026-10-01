/**
 * Unit coverage for the discount-code rule engine (lib/discounts.ts), the
 * single source of truth used both by the seller-facing /validate preview and
 * the real buyer checkout charge. Each rule from the Discounts spec gets its
 * own case: expiry, start date, usage limit, one-use-per-customer, minimum
 * order, and product scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  discountRow: null as any,
  priorUse: null as any,
  customerUses: 0,
  hasPriorOrder: false,
  collectionProducts: new Set<string>(),
}));

vi.mock("../discountLookups", () => ({
  countCustomerUses: async () => state.customerUses,
  hasPriorPaidOrder: async () => state.hasPriorOrder,
  resolveCollectionProductIds: async () => state.collectionProducts,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (...values: unknown[]) => values,
  sql: (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ strings, exprs }),
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => {
              // discountCodes select vs discountCodeUses select are
              // distinguished by call order: the code lookup always runs
              // first, the per-customer usage lookup only when needed.
              if ((table as any) === "discountCodesTable") {
                return state.discountRow ? [state.discountRow] : [];
              }
              return state.priorUse ? [state.priorUse] : [];
            },
          }),
        }),
      }),
    },
    discountCodes: "discountCodesTable",
    discountCodeUses: "discountCodeUsesTable",
  };
});

import { validateDiscountCode, DiscountValidationError } from "../discounts";

function baseDiscount(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "code-1",
    sellerId: "seller-1",
    code: "SAVE20",
    type: "percentage",
    value: "20",
    minOrderCents: 0,
    maxUses: null,
    usesCount: 0,
    expiresAt: null,
    startsAt: null,
    appliesTo: "entire_store",
    productIds: [],
    oneUsePerCustomer: false,
    firstOrderOnly: false,
    collectionIds: [],
    maxUsesPerCustomer: null,
    minQuantity: 0,
    active: true,
    ...overrides,
  };
}

const cart = { sellerId: "seller-1", code: "SAVE20", customerKey: "buyer-1", cartSubtotalCents: 10_000, lines: [{ productId: "p1", priceCents: 10_000, quantity: 1 }] };

beforeEach(() => {
  state.discountRow = baseDiscount();
  state.priorUse = null;
  state.customerUses = 0;
  state.hasPriorOrder = false;
  state.collectionProducts = new Set();
});
afterEach(() => vi.clearAllMocks());

describe("validateDiscountCode", () => {
  it("applies a percentage discount to the eligible subtotal", async () => {
    const result = await validateDiscountCode(cart);
    expect(result.appliedAmountCents).toBe(2_000);
  });

  it("rejects an unknown code", async () => {
    state.discountRow = null;
    await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "NOT_FOUND" } as Partial<DiscountValidationError>);
  });

  it("rejects a paused code", async () => {
    state.discountRow = baseDiscount({ active: false });
    await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "INACTIVE" });
  });

  it("rejects a code that hasn't started yet", async () => {
    state.discountRow = baseDiscount({ startsAt: new Date(Date.now() + 86_400_000) });
    await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "NOT_STARTED" });
  });

  it("rejects an expired code", async () => {
    state.discountRow = baseDiscount({ expiresAt: new Date(Date.now() - 1000) });
    await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("accepts a code with no end date", async () => {
    state.discountRow = baseDiscount({ expiresAt: null });
    await expect(validateDiscountCode(cart)).resolves.toMatchObject({ appliedAmountCents: 2_000 });
  });

  it("rejects a code that has hit its total usage limit", async () => {
    state.discountRow = baseDiscount({ maxUses: 5, usesCount: 5 });
    await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "MAX_USES_REACHED" });
  });

  it("allows a single-use code (maxUses=1) on its first use", async () => {
    state.discountRow = baseDiscount({ maxUses: 1, usesCount: 0 });
    await expect(validateDiscountCode(cart)).resolves.toMatchObject({ appliedAmountCents: 2_000 });
  });

  it("enforces one-use-per-customer even under the total usage limit", async () => {
    state.discountRow = baseDiscount({ oneUsePerCustomer: true });
    state.priorUse = { id: "use-1" };
    await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "ALREADY_USED_BY_CUSTOMER" });
  });

  it("allows a different customer under one-use-per-customer", async () => {
    state.discountRow = baseDiscount({ oneUsePerCustomer: true });
    state.priorUse = null;
    await expect(validateDiscountCode(cart)).resolves.toMatchObject({ appliedAmountCents: 2_000 });
  });

  it("rejects an order below the minimum", async () => {
    state.discountRow = baseDiscount({ minOrderCents: 20_000 });
    await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "MIN_ORDER_NOT_MET", details: { minOrderCents: 20_000 } });
  });

  it("accepts an order at or above the minimum", async () => {
    state.discountRow = baseDiscount({ minOrderCents: 10_000 });
    await expect(validateDiscountCode(cart)).resolves.toMatchObject({ appliedAmountCents: 2_000 });
  });

  it("scopes a specific-products code to only matching cart lines", async () => {
    state.discountRow = baseDiscount({ appliesTo: "specific_products", productIds: ["p2"] });
    const mixedCart = {
      ...cart,
      lines: [
        { productId: "p1", priceCents: 6_000, quantity: 1 },
        { productId: "p2", priceCents: 4_000, quantity: 1 },
      ],
    };
    const result = await validateDiscountCode(mixedCart);
    // Only the $40 p2 line is eligible: 20% of 4000 = 800.
    expect(result.appliedAmountCents).toBe(800);
  });

  it("rejects a specific-products code when no cart line qualifies", async () => {
    state.discountRow = baseDiscount({ appliesTo: "specific_products", productIds: ["p9"] });
    await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "NO_ELIGIBLE_ITEMS" });
  });

  it("caps a fixed discount at the eligible subtotal", async () => {
    state.discountRow = baseDiscount({ type: "fixed", value: "999" });
    const result = await validateDiscountCode(cart);
    expect(result.appliedAmountCents).toBe(10_000);
  });

  it("marks free_shipping codes with zero merchandise discount and freeShipping=true", async () => {
    state.discountRow = baseDiscount({ type: "free_shipping", value: "0" });
    const result = await validateDiscountCode(cart);
    expect(result.appliedAmountCents).toBe(0);
    expect(result.freeShipping).toBe(true);
  });

  it("gives free_item the price of the cheapest eligible line", async () => {
    state.discountRow = baseDiscount({ type: "free_item", value: "0" });
    const mixedCart = {
      ...cart,
      lines: [
        { productId: "p1", priceCents: 3_000, quantity: 1 },
        { productId: "p2", priceCents: 7_000, quantity: 1 },
      ],
    };
    const result = await validateDiscountCode(mixedCart);
    expect(result.appliedAmountCents).toBe(3_000);
  });

  describe("first-order-only", () => {
    it("accepts a buyer with no prior paid order with the seller", async () => {
      state.discountRow = baseDiscount({ firstOrderOnly: true });
      await expect(validateDiscountCode(cart)).resolves.toMatchObject({ appliedAmountCents: 2_000 });
    });
    it("rejects a returning buyer with FIRST_ORDER_ONLY", async () => {
      state.discountRow = baseDiscount({ firstOrderOnly: true });
      state.hasPriorOrder = true;
      await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "FIRST_ORDER_ONLY" });
    });
    it("ignores order history when the flag is off", async () => {
      state.hasPriorOrder = true;
      await expect(validateDiscountCode(cart)).resolves.toMatchObject({ appliedAmountCents: 2_000 });
    });
  });

  describe("per-customer use limit", () => {
    it("allows a customer under the limit", async () => {
      state.discountRow = baseDiscount({ maxUsesPerCustomer: 3 });
      state.customerUses = 2;
      await expect(validateDiscountCode(cart)).resolves.toMatchObject({ appliedAmountCents: 2_000 });
    });
    it("rejects a customer at the limit", async () => {
      state.discountRow = baseDiscount({ maxUsesPerCustomer: 3 });
      state.customerUses = 3;
      await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "CUSTOMER_LIMIT_REACHED" });
    });
  });

  describe("collection scope", () => {
    const lines = [
      { productId: "p1", priceCents: 6_000, quantity: 1 },
      { productId: "p2", priceCents: 4_000, quantity: 1 },
    ];
    it("discounts only lines whose product is in the collection", async () => {
      state.discountRow = baseDiscount({ appliesTo: "collections", collectionIds: ["c1"] });
      state.collectionProducts = new Set(["p2"]);
      const result = await validateDiscountCode({ ...cart, lines });
      expect(result.appliedAmountCents).toBe(800);
    });
    it("rejects with NO_ELIGIBLE_ITEMS when nothing in the cart is in the collection", async () => {
      state.discountRow = baseDiscount({ appliesTo: "collections", collectionIds: ["c1"] });
      state.collectionProducts = new Set(["p9"]);
      await expect(validateDiscountCode({ ...cart, lines })).rejects.toMatchObject({ code: "NO_ELIGIBLE_ITEMS" });
    });
  });

  describe("minimum quantity", () => {
    it("rejects when eligible quantity is short", async () => {
      state.discountRow = baseDiscount({ minQuantity: 3 });
      await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "MIN_QUANTITY_NOT_MET" });
    });
    it("accepts once the eligible quantity is met", async () => {
      state.discountRow = baseDiscount({ minQuantity: 3 });
      const lines = [{ productId: "p1", priceCents: 3_000, quantity: 3 }];
      await expect(validateDiscountCode({ ...cart, cartSubtotalCents: 9_000, lines })).resolves.toMatchObject({ appliedAmountCents: 1_800 });
    });
  });

  it("explains the minimum spend in dollars", async () => {
    state.discountRow = baseDiscount({ minOrderCents: 20_000 });
    await expect(validateDiscountCode(cart)).rejects.toMatchObject({ message: "Spend $200.00 or more to use this code." });
  });
});
