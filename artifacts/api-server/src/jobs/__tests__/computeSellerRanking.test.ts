import { describe, expect, it } from "vitest";
import {
  applyRecencyDecay,
  computeSellerScore,
  applyRotationBonus,
  pickTopProductsPerSeller,
  selectColdStartFallback,
  needsColdStartFallback,
} from "../computeSellerRanking";

const HOUR_MS = 60 * 60 * 1000;

describe("applyRecencyDecay", () => {
  it("returns the full weight for an event with zero or negative age", () => {
    expect(applyRecencyDecay(10, 0)).toBe(10);
    expect(applyRecencyDecay(10, -500)).toBe(10);
  });

  it("halves the weight after exactly one half-life", () => {
    const halfLife = 30 * HOUR_MS;
    expect(applyRecencyDecay(10, halfLife, halfLife)).toBeCloseTo(5, 5);
  });

  it("weighs a very recent event higher than a stale one within the same window", () => {
    const halfLife = 30 * HOUR_MS;
    const recent = applyRecencyDecay(10, 3 * 60 * 1000, halfLife); // 3 minutes old
    const stale   = applyRecencyDecay(10, 71 * HOUR_MS, halfLife); // 71 hours old
    expect(recent).toBeGreaterThan(stale);
    expect(recent).toBeCloseTo(10, 1);
  });
});

describe("computeSellerScore", () => {
  it("normalizes raw engagement by log2(followers+2)+1", () => {
    const engagement = { like: 20, comment: 30 }; // raw sum = 50
    const scoreZeroFollowers = computeSellerScore(engagement, 0, 0);
    const scoreManyFollowers = computeSellerScore(engagement, 100_000, 0);
    // 0 followers -> divisor = log2(2)+1 = 2
    expect(scoreZeroFollowers).toBeCloseTo(50 / 2, 4);
    // Larger seller with identical raw engagement scores structurally lower.
    expect(scoreManyFollowers).toBeLessThan(scoreZeroFollowers);
  });

  it("penalizes a stale most-recent-activity timestamp but never zeroes the score out", () => {
    const engagement = { like: 10 };
    const fresh = computeSellerScore(engagement, 0, 0);
    const stale = computeSellerScore(engagement, 0, 30 * 24 * HOUR_MS); // a month stale
    expect(stale).toBeLessThan(fresh);
    expect(stale).toBeGreaterThan(fresh * 0.4); // floors at a 0.5x multiplier, never near-zero
  });

  it("returns zero for a seller with no engagement at all", () => {
    expect(computeSellerScore({}, 500, 0)).toBe(0);
  });
});

describe("applyRotationBonus", () => {
  it("gives the full bonus to a seller absent from yesterday's cache", () => {
    const bonused = applyRotationBonus(100, false, null);
    expect(bonused).toBeGreaterThan(100);
    expect(bonused).toBeCloseTo(115, 5);
  });

  it("gives no bonus to a seller who dominated yesterday's top ranks", () => {
    expect(applyRotationBonus(100, true, 1)).toBe(100);
    expect(applyRotationBonus(100, true, 5)).toBe(100);
  });

  it("gives a partial bonus to a returning seller ranked outside the top", () => {
    const bonused = applyRotationBonus(100, true, 6);
    expect(bonused).toBeGreaterThan(100);
    expect(bonused).toBeLessThan(applyRotationBonus(100, false, null));
  });
});

describe("pickTopProductsPerSeller", () => {
  const mk = (id: string, demandCount: number, createdAt: string) => ({
    id, demandCount, createdAt: new Date(createdAt),
  });

  it("caps at the given number, sorted by demandCount desc", () => {
    const products = [
      mk("a", 5, "2026-01-01"),
      mk("b", 50, "2026-01-01"),
      mk("c", 20, "2026-01-01"),
    ];
    expect(pickTopProductsPerSeller(products, 2).map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("breaks demandCount ties by newest first", () => {
    const products = [
      mk("old", 10, "2025-01-01"),
      mk("new", 10, "2026-01-01"),
    ];
    expect(pickTopProductsPerSeller(products, 1).map((p) => p.id)).toEqual(["new"]);
  });

  it("defaults to a cap of 2", () => {
    const products = [mk("a", 1, "2026-01-01"), mk("b", 2, "2026-01-01"), mk("c", 3, "2026-01-01")];
    expect(pickTopProductsPerSeller(products)).toHaveLength(2);
  });
});

describe("selectColdStartFallback", () => {
  const mk = (sellerId: string, hasActiveProduct: boolean, createdAt: string) => ({
    sellerId, hasActiveProduct, createdAt: new Date(createdAt),
  });

  it("excludes sellers without an active product", () => {
    const sellers = [mk("no-product", false, "2026-01-01"), mk("has-product", true, "2026-01-01")];
    expect(selectColdStartFallback(sellers).map((s) => s.sellerId)).toEqual(["has-product"]);
  });

  it("returns the newest active-product sellers first", () => {
    const sellers = [
      mk("oldest", true, "2024-01-01"),
      mk("newest", true, "2026-01-01"),
      mk("middle", true, "2025-01-01"),
    ];
    expect(selectColdStartFallback(sellers).map((s) => s.sellerId)).toEqual(["newest", "middle", "oldest"]);
  });

  it("respects the pool size cap", () => {
    const sellers = Array.from({ length: 10 }, (_, i) => mk(`s${i}`, true, `2026-01-0${(i % 9) + 1}`));
    expect(selectColdStartFallback(sellers, 3)).toHaveLength(3);
  });
});

describe("needsColdStartFallback", () => {
  it("is true when the candidate pool is too small", () => {
    expect(needsColdStartFallback(1, 1000)).toBe(true);
    expect(needsColdStartFallback(10, 1000)).toBe(false);
  });

  it("is true when total engagement is essentially zero even with enough sellers", () => {
    expect(needsColdStartFallback(50, 0)).toBe(true);
  });
});
