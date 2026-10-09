import { describe, expect, it } from "vitest";
import {
  TRENDING_WINDOW_DAYS, rankByScore, scoreBrandSignals, scoreProductSignals, windowStart,
} from "../trendingScoring";

describe("scoreProductSignals", () => {
  it("is 0 with no signals and ignores negative / non-finite input", () => {
    expect(scoreProductSignals({ views: 0, saves: 0, orderUnits: 0, reservations: 0 })).toBe(0);
    expect(scoreProductSignals({ views: -5, saves: Number.NaN, orderUnits: Infinity, reservations: -1 })).toBe(0);
  });

  it("weights purchase intent above saves above views", () => {
    const base = { views: 0, saves: 0, orderUnits: 0, reservations: 0 };
    const order = scoreProductSignals({ ...base, orderUnits: 1 });
    const reserve = scoreProductSignals({ ...base, reservations: 1 });
    const save = scoreProductSignals({ ...base, saves: 1 });
    const view = scoreProductSignals({ ...base, views: 1 });
    expect(order).toBeGreaterThan(reserve);
    expect(reserve).toBeGreaterThan(save);
    expect(save).toBeGreaterThan(view);
  });

  it("dampens views so 100 views do not beat 3 paid units", () => {
    expect(scoreProductSignals({ views: 100, saves: 0, orderUnits: 0, reservations: 0 }))
      .toBeLessThan(scoreProductSignals({ views: 0, saves: 0, orderUnits: 3, reservations: 0 }));
  });
});

describe("scoreBrandSignals", () => {
  it("is 0 with no signals", () => {
    expect(scoreBrandSignals({ orders: 0, newFollowers: 0, saves: 0, visits: 0 })).toBe(0);
  });

  it("rewards orders and new followers over raw visits", () => {
    const order = scoreBrandSignals({ orders: 1, newFollowers: 0, saves: 0, visits: 0 });
    const follower = scoreBrandSignals({ orders: 0, newFollowers: 1, saves: 0, visits: 0 });
    const visit = scoreBrandSignals({ orders: 0, newFollowers: 0, saves: 0, visits: 1 });
    expect(order).toBeGreaterThan(follower);
    expect(follower).toBeGreaterThan(visit);
    expect(visit).toBeGreaterThan(0);
  });
});

describe("rankByScore", () => {
  it("drops zero scores, sorts high to low, breaks ties by id, applies the limit", () => {
    const ranked = rankByScore(
      [
        { id: "b", score: 5 },
        { id: "a", score: 5 },
        { id: "z", score: 0 },
        { id: "c", score: 9 },
      ],
      3,
    );
    expect(ranked.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(rankByScore([{ id: "a", score: 1 }, { id: "b", score: 2 }], 1).map((r) => r.id)).toEqual(["b"]);
    expect(rankByScore([{ id: "a", score: 0 }], 5)).toEqual([]);
  });
});

describe("windowStart", () => {
  it("is N days before now (default window)", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    expect(windowStart(now).toISOString()).toBe(
      new Date(now.getTime() - TRENDING_WINDOW_DAYS * 86_400_000).toISOString(),
    );
    expect(windowStart(now, 1).toISOString()).toBe("2026-09-29T12:00:00.000Z");
  });
});
