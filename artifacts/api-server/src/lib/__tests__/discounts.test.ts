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
    active: true,
    ...overrides,
  };
}

const cart = { sellerId: "seller-1", code: "SAVE20", customerKey: "buyer-1", cartSubtotalCents: 10_000, lines: [{ productId: "p1", priceCents: 10_000, quantity: 1 }] };

beforeEach(() => {
  state.discountRow = baseDiscount();
  state.priorUse = null;
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
});
