import { describe, expect, it } from "vitest";
import { isRankableTerm, rankSearchTrends, trendScore, trendTag } from "../searchTrends";

describe("searchTrends", () => {
  it("weights the last 24h double", () => {
    expect(trendScore({ term: "a", recent: 3, prior: 1 })).toBe(7);
    expect(trendScore({ term: "a", recent: -2, prior: Number.NaN })).toBe(0);
  });

  it("tags new only when there were no earlier searches", () => {
    expect(trendTag({ term: "a", recent: 3, prior: 0 })).toBe("new");
    expect(trendTag({ term: "a", recent: 2, prior: 0 })).toBeNull();
  });

  it("tags hot when the daily rate at least doubled", () => {
    expect(trendTag({ term: "a", recent: 4, prior: 4 })).toBe("hot");
    expect(trendTag({ term: "a", recent: 4, prior: 5 })).toBeNull();
    expect(trendTag({ term: "a", recent: 3, prior: 1 })).toBeNull();
  });

  it("drops junk terms", () => {
    expect(isRankableTerm("ok")).toBe(true);
    expect(isRankableTerm("a")).toBe(false);
    expect(isRankableTerm("!!!")).toBe(false);
    expect(isRankableTerm("x".repeat(61))).toBe(false);
  });

  it("ranks, numbers and caps", () => {
    const ranked = rankSearchTrends([
      { term: "b", recent: 0, prior: 1 },
      { term: "hoodie", recent: 1, prior: 1 },
      { term: "jorts", recent: 5, prior: 0 },
      { term: "denim", recent: 1, prior: 3 },
    ], 2);
    expect(ranked).toEqual([
      { term: "jorts", rank: 1, count: 5, tag: "new" },
      { term: "denim", rank: 2, count: 4, tag: null },
    ]);
  });
});
