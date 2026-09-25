import { describe, expect, it } from "vitest";
import {
  updateAffinity,
  updateAffinityForKeys,
  eventWeight,
  affinityMatchScore,
  negativeAffinityPenalty,
  applyRecencyDecay,
  scoreCandidate,
  diversifyFeed,
  isCacheFresh,
  type RankingCandidate,
} from "../forYou";

describe("updateAffinity", () => {
  it("adds weight to a new key", () => {
    const next = updateAffinity({}, "streetwear", 2);
    expect(next.streetwear).toBe(2);
  });

  it("decays the existing value before adding the new weight", () => {
    const next = updateAffinity({ streetwear: 10 }, "streetwear", 1);
    expect(next.streetwear).toBeCloseTo(10 * 0.985 + 1, 5);
  });

  it("does not mutate the input map", () => {
    const original = { a: 1 };
    updateAffinity(original, "a", 5);
    expect(original.a).toBe(1);
  });

  it("ignores an empty key", () => {
    expect(updateAffinity({ a: 1 }, "", 5)).toEqual({ a: 1 });
  });
});

describe("updateAffinityForKeys", () => {
  it("splits the total weight evenly across unique keys", () => {
    const next = updateAffinityForKeys({}, ["a", "b"], 4);
    expect(next.a).toBe(2);
    expect(next.b).toBe(2);
  });

  it("dedupes repeated keys before splitting", () => {
    const next = updateAffinityForKeys({}, ["a", "a", "b"], 4);
    expect(next.a).toBe(2);
    expect(next.b).toBe(2);
  });

  it("returns the input unchanged for an empty key list", () => {
    const original = { a: 1 };
    expect(updateAffinityForKeys(original, [], 10)).toBe(original);
  });
});

describe("eventWeight", () => {
  it("returns the base weight for a simple event type", () => {
    expect(eventWeight("like")).toBe(1.5);
  });

  it("returns 0 for an unknown event type", () => {
    expect(eventWeight("unknown_type")).toBe(0);
  });

  it("scales watch_time by the completion fraction", () => {
    const full = eventWeight("watch_time", "1.0");
    const half = eventWeight("watch_time", "0.5");
    expect(full).toBeGreaterThan(half);
    expect(half).toBeCloseTo(full / 2, 5);
  });

  it("falls back to the base weight for a non-numeric watch_time value", () => {
    expect(eventWeight("watch_time", "not-a-number")).toBe(0.35);
  });

  it("returns negative weight for not_interested", () => {
    expect(eventWeight("not_interested")).toBeLessThan(0);
  });
});

describe("affinityMatchScore / negativeAffinityPenalty", () => {
  it("averages positive affinity across the given keys", () => {
    expect(affinityMatchScore({ a: 4, b: 2 }, ["a", "b"])).toBe(3);
  });

  it("treats a missing key as zero affinity", () => {
    expect(affinityMatchScore({ a: 4 }, ["a", "unknown"])).toBe(2);
  });

  it("ignores positive values when computing the negative penalty", () => {
    expect(negativeAffinityPenalty({ a: 4, b: -2 }, ["a", "b"])).toBe(-1);
  });

  it("returns 0 for an empty key list", () => {
    expect(affinityMatchScore({ a: 4 }, [])).toBe(0);
    expect(negativeAffinityPenalty({ a: -4 }, [])).toBe(0);
  });
});

describe("applyRecencyDecay", () => {
  it("returns the full weight for a non-positive age", () => {
    expect(applyRecencyDecay(10, 0)).toBe(10);
    expect(applyRecencyDecay(10, -100)).toBe(10);
  });

  it("halves the weight after one half-life", () => {
    const halfLife = 1000;
    expect(applyRecencyDecay(10, halfLife, halfLife)).toBeCloseTo(5, 5);
  });
});

function candidate(overrides: Partial<RankingCandidate> = {}): RankingCandidate {
  return {
    id: "post-1",
    sellerId: "seller-1",
    createdAt: new Date(),
    styleTags: ["streetwear"],
    isFollowed: false,
    isBoosted: false,
    isLive: false,
    sellerScore: 0,
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  const now = Date.now();

  it("scores a matching-taste candidate higher than a mismatched one", () => {
    const matching = candidate({ styleTags: ["streetwear"] });
    const mismatched = candidate({ id: "post-2", styleTags: ["formalwear"] });
    const affinity = { streetwear: 5 };
    const matchingScore = scoreCandidate(matching, {}, affinity, {}, now);
    const mismatchedScore = scoreCandidate(mismatched, {}, affinity, {}, now);
    expect(matchingScore).toBeGreaterThan(mismatchedScore);
  });

  it("rewards followed sellers and boosted posts", () => {
    const base = candidate();
    const followed = candidate({ isFollowed: true });
    const boosted = candidate({ isBoosted: true });
    expect(scoreCandidate(followed, {}, {}, {}, now)).toBeGreaterThan(scoreCandidate(base, {}, {}, {}, now));
    expect(scoreCandidate(boosted, {}, {}, {}, now)).toBeGreaterThan(scoreCandidate(base, {}, {}, {}, now));
  });

  it("penalizes a seller the buyer marked not-interested", () => {
    const target = candidate({ sellerId: "bad-seller" });
    const withPenalty = scoreCandidate(target, {}, {}, { "bad-seller": -3 }, now);
    const withoutPenalty = scoreCandidate(target, {}, {}, {}, now);
    expect(withPenalty).toBeLessThan(withoutPenalty);
  });

  it("scores an older post lower than a fresher one, all else equal", () => {
    const fresh = candidate({ createdAt: new Date(now) });
    const stale = candidate({ id: "post-2", createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000) });
    expect(scoreCandidate(fresh, {}, {}, {}, now)).toBeGreaterThan(scoreCandidate(stale, {}, {}, {}, now));
  });
});

describe("diversifyFeed", () => {
  it("never places the same seller in two consecutive slots when an alternative exists", () => {
    const ranked = [
      { sellerId: "a", isLive: false, id: 1 },
      { sellerId: "a", isLive: false, id: 2 },
      { sellerId: "b", isLive: false, id: 3 },
      { sellerId: "a", isLive: false, id: 4 },
    ];
    const result = diversifyFeed(ranked);
    // b (the only non-"a" seller) must land between two of the three "a"s,
    // otherwise two "a"s would be adjacent despite an alternative existing.
    const bIndex = result.findIndex((r) => r.sellerId === "b");
    expect(bIndex).toBeGreaterThan(0);
    expect(bIndex).toBeLessThan(result.length - 1);
  });

  it("includes every candidate exactly once", () => {
    const ranked = [
      { sellerId: "a", isLive: false, id: 1 },
      { sellerId: "b", isLive: false, id: 2 },
      { sellerId: "c", isLive: false, id: 3 },
    ];
    const result = diversifyFeed(ranked);
    expect(result).toHaveLength(3);
    expect(new Set(result.map((r) => r.id)).size).toBe(3);
  });

  it("interleaves live candidates at the configured cadence", () => {
    const videos = Array.from({ length: 10 }, (_, i) => ({ sellerId: `s${i}`, isLive: false, id: `v${i}` }));
    const lives = [{ sellerId: "live-seller", isLive: true, id: "l0" }];
    const result = diversifyFeed([...videos, ...lives], { liveInterleaveEvery: 3 });
    expect(result.some((r) => r.isLive)).toBe(true);
  });
});

describe("isCacheFresh", () => {
  it("is fresh right after computation", () => {
    expect(isCacheFresh(new Date(), 60_000)).toBe(true);
  });

  it("is stale after the TTL has elapsed", () => {
    expect(isCacheFresh(new Date(Date.now() - 120_000), 60_000)).toBe(false);
  });
});
