import { describe, expect, it } from "vitest";
import { growthPct, rankRisingBrands, type RisingCandidate } from "../risingBrands";

const c = (sellerId: string, cur: number, prev: number, brandName = sellerId): RisingCandidate => ({
  sellerId, username: sellerId, brandName, logoUrl: null, cur, prev,
});

describe("growthPct", () => {
  it("is (cur - prev) / max(prev, 1) as a whole percent", () => {
    expect(growthPct(10, 2)).toBe(400);
    expect(growthPct(6, 0)).toBe(600);
    expect(growthPct(7, 5)).toBe(40);
    expect(growthPct(5, 3)).toBe(67);
  });
});

describe("rankRisingBrands", () => {
  it("needs at least 5 orders this week and growth above zero", () => {
    const ranked = rankRisingBrands([c("four", 4, 0), c("flat", 5, 5), c("down", 9, 12), c("five", 5, 1)]);
    expect(ranked.map((r) => r.sellerId)).toEqual(["five"]);
  });

  it("ranks by growth; ties go to the bigger week, then the name", () => {
    const ranked = rankRisingBrands([
      c("small-tie", 6, 3, "Zed"), c("big-tie", 8, 4, "Ama"), c("top", 6, 0), c("second", 10, 2),
      c("name-a", 6, 3, "Alpha"),
    ]);
    expect(ranked.map((r) => [r.rank, r.sellerId, r.growthPct])).toEqual([
      [1, "top", 600], [2, "second", 400], [3, "big-tie", 100], [4, "name-a", 100], [5, "small-tie", 100],
    ]);
  });

  it("returns at most 10 and never the order counts", () => {
    const ranked = rankRisingBrands(Array.from({ length: 14 }, (_, i) => c(`s${i}`, 10 + i, 1)));
    expect(ranked).toHaveLength(10);
    expect(ranked[0]?.sellerId).toBe("s13");
    for (const r of ranked) {
      expect(Object.keys(r).sort()).toEqual(["brandName", "growthPct", "logoUrl", "rank", "sellerId", "username"]);
    }
  });
});
