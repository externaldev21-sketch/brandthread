import { describe, expect, it } from "vitest";
import {
  K_ANONYMITY_MIN, applyKAnonymity, buildHeatmap, conversionPct, emptyGrid, funnelRates, goalPacing,
  locationLabel, monthWindow, parseInsightRange, rangeWindow, rankSlots, viewerKeyFor,
} from "./sellerInsights";
import { newlyAddedVariantIds } from "./sellerProductEvents";
import { toCSV } from "../routes/seller-export";

const V = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("range bucketing", () => {
  it("defaults unknown ranges to 30d", () => {
    expect(parseInsightRange("7d")).toBe("7d");
    expect(parseInsightRange("1y")).toBe("30d");
    expect(parseInsightRange(undefined)).toBe("30d");
  });
  it("aligns the window to local midnight, today included", () => {
    const now = new Date("2026-09-30T02:00:00Z"); // 22:00 on Sep 29 at UTC-4
    const { start } = rangeWindow("7d", now, -240);
    expect(start.toISOString()).toBe("2026-09-23T04:00:00.000Z");
  });
});

describe("conversion math", () => {
  it("returns null with no denominator and caps at 100", () => {
    expect(conversionPct(3, 0)).toBeNull();
    expect(conversionPct(5, 4)).toBe(100);
    expect(conversionPct(1, 3)).toBe(33.3);
  });
  it("computes view->cart and cart->purchase", () => {
    expect(funnelRates({ views: 200, addToCarts: 20, purchases: 5 })).toEqual({ viewToCartPct: 10, cartToPurchasePct: 25 });
    expect(funnelRates({ views: 0, addToCarts: 0, purchases: 2 })).toEqual({ viewToCartPct: null, cartToPurchasePct: null });
  });
});

describe("k-anonymity", () => {
  it("hides buckets below the threshold and counts them", () => {
    const r = applyKAnonymity([{ people: 12 }, { people: 5 }, { people: 4 }, { people: 1 }]);
    expect(r.shown.map((b) => b.people)).toEqual([12, 5]);
    expect(r.hiddenBuckets).toBe(2);
    expect(K_ANONYMITY_MIN).toBe(5);
  });
  it("normalises locations", () => {
    expect(locationLabel({ country: " us ", state: "ca" })).toEqual({ country: "US", region: "CA" });
    expect(locationLabel({ country: "" })).toBeNull();
    expect(locationLabel(null)).toBeNull();
  });
});

describe("best time to post", () => {
  it("buckets timestamps into local day x hour", () => {
    // Wed 2026-09-30 01:30 UTC is Tue 21:30 at UTC-4
    const grid = buildHeatmap([new Date("2026-09-30T01:30:00Z")], -240);
    expect(grid[2][21]).toBe(1);
  });
  it("ranks the top 3 deterministically and requires a minimum sample", () => {
    const grid = emptyGrid();
    grid[5][18] = 20; grid[2][9] = 20; grid[0][12] = 15; grid[1][1] = 3;
    expect(rankSlots(grid)).toEqual([
      { day: 2, hour: 9, count: 20 }, { day: 5, hour: 18, count: 20 }, { day: 0, hour: 12, count: 15 },
    ]);
    const thin = emptyGrid(); thin[1][1] = 5;
    expect(rankSlots(thin)).toEqual([]);
  });
});

describe("goal pacing", () => {
  const now = new Date("2026-09-16T00:00:00Z");
  const month = monthWindow(now, 0); // Sep, 30 days; 15 elapsed
  it("knows the month length", () => expect(month.daysInMonth).toBe(30));
  it("projects on-track and behind", () => {
    expect(goalPacing(6000, 10000, now, month)).toMatchObject({ projected: 12000, status: "on_track", progressPct: 60, remaining: 4000, expectedToDate: 5000 });
    expect(goalPacing(2000, 10000, now, month)).toMatchObject({ projected: 4000, status: "behind" });
  });
  it("flags achieved and not started", () => {
    expect(goalPacing(10000, 10000, now, month).status).toBe("achieved");
    const start = new Date("2026-09-01T00:00:00Z");
    expect(goalPacing(0, 10000, start, month)).toMatchObject({ projected: null, status: "not_started" });
  });
});

describe("hashing and add-to-cart diff", () => {
  it("salts viewer keys per seller", () => {
    expect(viewerKeyFor("s1", "u")).not.toBe(viewerKeyFor("s2", "u"));
    expect(viewerKeyFor("s1", "u")).toBe(viewerKeyFor("s1", "u"));
    expect(viewerKeyFor("s1", "u")).not.toContain("u".repeat(3) + "s1");
  });
  it("only reports newly added, valid variant ids", () => {
    expect(newlyAddedVariantIds([V(1)], [V(1), V(2), V(2), "not-a-uuid"])).toEqual([V(2)]);
  });
});

describe("CSV safety (shared toCSV)", () => {
  it("neutralises formula injection", () => {
    const csv = toCSV([{ a: "=HYPERLINK(\"x\")", b: "+1", c: "-2", d: "@sum", e: "ok, fine" }], ["a", "b", "c", "d", "e"]);
    const line = csv.split("\n")[1];
    expect(line).toContain("'=HYPERLINK");
    expect(line).toContain("'+1");
    expect(line).toContain("'-2");
    expect(line).toContain("'@sum");
    expect(line).toContain('"ok, fine"');
  });
});
