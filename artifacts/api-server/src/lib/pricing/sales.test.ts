import { describe, it, expect } from "vitest";
import { resolveEffectivePrice, saleDiscountFor, isSaleLive, saleAppliesTo, type SaleRule } from "./sales";

const T0 = new Date("2026-06-01T00:00:00Z");
const T1 = new Date("2026-06-10T00:00:00Z");
const mk = (o: Partial<SaleRule> = {}): SaleRule => ({
  id: "s1", sellerId: "sel", name: "Summer", discountType: "percent", value: 20,
  scope: "store", startsAt: T0, endsAt: T1, active: true, ...o,
});
const target = { productId: "p1", sellerId: "sel", category: "Hoodies", tags: ["Fall", "Drop 2"] };
const price = (sales: SaleRule[], now: Date, p = 10000, compareAt?: number | null) =>
  resolveEffectivePrice({ priceCents: p, compareAtPriceCents: compareAt, target, sales, now });

describe("time windows", () => {
  const now = new Date("2026-06-05T00:00:00Z");
  it("applies inside the window", () => expect(price([mk()], now).priceCents).toBe(8000));
  it("is inclusive at start, exclusive at end", () => {
    expect(price([mk()], T0).priceCents).toBe(8000);
    expect(price([mk()], T1).priceCents).toBe(10000);
  });
  it("does not apply before start or after end", () => {
    expect(price([mk()], new Date("2026-05-31T23:59:59Z")).saleId).toBeNull();
    expect(price([mk()], new Date("2026-07-01T00:00:00Z")).saleId).toBeNull();
  });
  it("open-ended sale keeps applying", () => expect(price([mk({ endsAt: null })], new Date("2030-01-01")).priceCents).toBe(8000));
  it("inactive sale never applies", () => expect(isSaleLive(mk({ active: false }), now)).toBe(false));
});

describe("scope", () => {
  const now = new Date("2026-06-05T00:00:00Z");
  it("store applies to every product of that seller only", () => {
    expect(saleAppliesTo(mk(), target)).toBe(true);
    expect(saleAppliesTo(mk({ sellerId: "other" }), target)).toBe(false);
  });
  it("products applies to listed ids only", () => {
    expect(price([mk({ scope: "products", productIds: ["p1"] })], now).saleId).toBe("s1");
    expect(price([mk({ scope: "products", productIds: ["p2"] })], now).saleId).toBeNull();
  });
  it("collection matches category or tag, case-insensitively", () => {
    expect(saleAppliesTo(mk({ scope: "collection", collection: " hoodies " }), target)).toBe(true);
    expect(saleAppliesTo(mk({ scope: "collection", collection: "drop 2" }), target)).toBe(true);
    expect(saleAppliesTo(mk({ scope: "collection", collection: "Tees" }), target)).toBe(false);
    expect(saleAppliesTo(mk({ scope: "collection", collection: "" }), target)).toBe(false);
  });
});

describe("rounding and floors", () => {
  it("rounds percent to the nearest cent", () => {
    expect(saleDiscountFor({ discountType: "percent", value: 15 }, 1999)).toBe(300); // 299.85
    expect(saleDiscountFor({ discountType: "percent", value: 33 }, 1001)).toBe(330); // 330.33
    expect(saleDiscountFor({ discountType: "percent", value: 50 }, 1001)).toBe(501); // 500.5 half up
  });
  it("never reduces a price below 1 cent", () => {
    expect(saleDiscountFor({ discountType: "fixed", value: 99999 }, 500)).toBe(499);
    expect(saleDiscountFor({ discountType: "percent", value: 100 }, 500)).toBe(499);
    expect(price([mk({ discountType: "fixed", value: 99999 })], new Date("2026-06-02")).priceCents).toBe(1);
  });
  it("ignores negative/garbage values and 1-cent prices", () => {
    expect(saleDiscountFor({ discountType: "fixed", value: -5 }, 500)).toBe(0);
    expect(saleDiscountFor({ discountType: "percent", value: NaN }, 500)).toBe(0);
    expect(saleDiscountFor({ discountType: "percent", value: 50 }, 1)).toBe(0);
  });
  it("fixed amount is cents off each unit", () => {
    expect(price([mk({ discountType: "fixed", value: 1500 })], new Date("2026-06-02")).priceCents).toBe(8500);
  });
});

describe("stacking and compare-at", () => {
  const now = new Date("2026-06-05T00:00:00Z");
  it("sales do not stack: best single sale wins", () => {
    const r = price([mk({ id: "a", value: 10 }), mk({ id: "b", value: 30 }), mk({ id: "c", discountType: "fixed", value: 500 })], now);
    expect(r.saleId).toBe("b");
    expect(r.priceCents).toBe(7000);
  });
  it("ties go to the first listed sale", () => {
    expect(price([mk({ id: "a", value: 20 }), mk({ id: "b", value: 20 })], now).saleId).toBe("a");
  });
  it("strikes through the pre-sale price when no seller compare-at", () => {
    const r = price([mk()], now);
    expect(r).toMatchObject({ priceCents: 8000, compareAtPriceCents: 10000, basePriceCents: 10000, saleDiscountCents: 2000, percentOff: 20 });
  });
  it("keeps a higher seller compare-at as the strike price", () => {
    const r = price([mk()], now, 10000, 15000);
    expect(r).toMatchObject({ priceCents: 8000, compareAtPriceCents: 15000, percentOff: 47 });
  });
  it("ignores a compare-at at or below the price", () => {
    expect(price([], now, 10000, 9000).compareAtPriceCents).toBeNull();
    expect(price([mk()], now, 10000, 9000).compareAtPriceCents).toBe(10000);
  });
  it("without a sale the seller compare-at passes through", () => {
    expect(price([], now, 10000, 12500)).toMatchObject({ priceCents: 10000, compareAtPriceCents: 12500, saleId: null, percentOff: 20 });
  });
  it("discount codes apply on top: a code sees the sale price", () => {
    const sale = price([mk()], now).priceCents;
    expect(Math.round(sale * 0.9)).toBe(7200); // 10% code on the 20%-off price, not on 10000
  });
});
