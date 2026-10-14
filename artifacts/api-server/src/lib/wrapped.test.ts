import { describe, expect, it } from "vitest";
import { isMonthKey, monthRange, previousMonth, rankBrands, supporterTopPercent } from "./wrapped";

describe("wrapped helpers", () => {
  it("covers the previous calendar month in UTC", () => {
    expect(previousMonth(new Date("2026-10-01T03:00:00Z"))).toBe("2026-09");
    expect(previousMonth(new Date("2026-01-05T00:00:00Z"))).toBe("2025-12");
    expect(monthRange("2026-09")).toEqual({ start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") });
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-09")).toBe(true);
  });

  it("only claims a supporter rank when it is true and meaningful", () => {
    expect(supporterTopPercent(1, 100)).toBe(1);
    expect(supporterTopPercent(5, 100)).toBe(5);
    expect(supporterTopPercent(25, 100)).toBe(25);
    expect(supporterTopPercent(26, 100)).toBeNull(); // outside the top quarter
    expect(supporterTopPercent(1, 19)).toBeNull(); // too few buyers to mean anything
    expect(supporterTopPercent(1, 20)).toBe(5);
    expect(supporterTopPercent(0, 50)).toBeNull();
  });

  it("ranks brands by pieces, then spend, with a real photo", () => {
    const row = (sellerId: string, quantity: number, priceCents: number, img?: string) =>
      ({ sellerId, brandName: sellerId.toUpperCase(), displayName: null, quantity, priceCents, images: img ? [img] : [] });
    const brands = rankBrands([row("a", 1, 100), row("b", 2, 150, "b.jpg"), row("c", 1, 900, "c.jpg"), row("a", 1, 100, "a.jpg"), row("d", 1, 50)]);
    expect(brands.map((b) => [b.name, b.pieces, b.imageUrl])).toEqual([["B", 2, "b.jpg"], ["A", 2, "a.jpg"], ["C", 1, "c.jpg"]]);
  });
});
