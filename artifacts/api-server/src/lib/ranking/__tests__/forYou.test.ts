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
  engagementQuality,
  mergePreferenceStyleAffinity,
  W_LIKED_BRAND,
  PREFERENCE_STYLE_SEED,
  type RankingCandidate,
  type PostEngagementStats,
} from "../forYou";
import { DEFAULT_RANKING_CONFIG, sanitizeRankingConfig, parseEnvOverride } from "../config";

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

const stats = (over: Partial<PostEngagementStats> = {}): PostEngagementStats => ({
  views: 100, avgCompletion: 0.5, likes: 0, shares: 0, saves: 0, purchases: 0, comments: 0, reposts: 0, ...over,
});

describe("engagementQuality", () => {
  it("is 0 without stats and always bounded to 0..1", () => {
    expect(engagementQuality(undefined)).toBe(0);
    const huge = engagementQuality(stats({ views: 1, likes: 1e6, shares: 1e6, saves: 1e6, purchases: 1e6, avgCompletion: 5 }));
    expect(huge).toBeLessThanOrEqual(1);
    expect(huge).toBeGreaterThan(0.6);
    expect(engagementQuality(stats({ views: 0, avgCompletion: -3 }))).toBeGreaterThanOrEqual(0);
  });

  it("rewards likes, shares, saves and purchases, purchases most", () => {
    const base = engagementQuality(stats());
    expect(engagementQuality(stats({ likes: 10 }))).toBeGreaterThan(base);
    expect(engagementQuality(stats({ shares: 10 }))).toBeGreaterThan(engagementQuality(stats({ likes: 10 })));
    expect(engagementQuality(stats({ purchases: 10 }))).toBeGreaterThan(engagementQuality(stats({ saves: 10 })));
  });

  it("rewards higher completion only when views back it up", () => {
    const high = engagementQuality(stats({ views: 100, avgCompletion: 0.95 }));
    const low = engagementQuality(stats({ views: 100, avgCompletion: 0.1 }));
    expect(high).toBeGreaterThan(low);
    const fewViewsHigh = engagementQuality(stats({ views: 1, avgCompletion: 0.95 }));
    expect(fewViewsHigh).toBeLessThan(high);
  });

  it("smooths tiny samples: 1 view + 1 like does not beat a proven post", () => {
    const tiny = engagementQuality(stats({ views: 1, likes: 1, avgCompletion: null }));
    const proven = engagementQuality(stats({ views: 500, likes: 150, shares: 30, saves: 40, avgCompletion: 0.8 }));
    expect(proven).toBeGreaterThan(tiny);
  });
});

describe("scoreCandidate with tunable config", () => {
  const now = Date.now();
  const cand = (over: Partial<RankingCandidate> = {}): RankingCandidate => ({
    id: "p", sellerId: "s", createdAt: new Date(now), styleTags: [], isFollowed: false, isBoosted: false,
    isLive: false, sellerScore: 0, ...over,
  });

  it("engagement term lifts a proven post and is scaled by its own weight", () => {
    const proven = cand({ engagement: stats({ likes: 50, shares: 20, saves: 20, purchases: 5, avgCompletion: 0.9 }) });
    const plain = cand();
    expect(scoreCandidate(proven, {}, {}, {}, now)).toBeGreaterThan(scoreCandidate(plain, {}, {}, {}, now));
    const off = sanitizeRankingConfig({ scoreWeights: { engagement: 0 } });
    expect(scoreCandidate(proven, {}, {}, {}, now, off)).toBeCloseTo(scoreCandidate(plain, {}, {}, {}, now, off), 10);
    const boosted = sanitizeRankingConfig({ scoreWeights: { engagement: 10 } });
    expect(scoreCandidate(proven, {}, {}, {}, now, boosted)).toBeGreaterThan(scoreCandidate(proven, {}, {}, {}, now));
  });

  it("honours a custom followed weight and half-life", () => {
    const cfg = sanitizeRankingConfig({ scoreWeights: { followed: 7 } });
    const diff = scoreCandidate(cand({ isFollowed: true }), {}, {}, {}, now, cfg) - scoreCandidate(cand(), {}, {}, {}, now, cfg);
    expect(diff).toBeCloseTo(7, 10);
    const slow = sanitizeRankingConfig({ recencyHalfLifeHours: 240 });
    const old = cand({ createdAt: new Date(now - 48 * 3600_000) });
    expect(scoreCandidate(old, {}, {}, {}, now, slow)).toBeGreaterThan(scoreCandidate(old, {}, {}, {}, now));
  });

  it("eventWeight uses overridden weights", () => {
    expect(eventWeight("like", null, { like: 9 })).toBe(9);
    expect(eventWeight("purchase", null, { like: 9 })).toBe(0);
  });
});

describe("sanitizeRankingConfig", () => {
  it("returns defaults for garbage input and never throws", () => {
    for (const bad of [null, undefined, 5, "x", [], [1, 2], { eventWeights: "no" }, { scoreWeights: [] }]) {
      expect(sanitizeRankingConfig(bad)).toEqual(DEFAULT_RANKING_CONFIG);
    }
  });

  it("clamps out-of-range values and ignores unknown keys", () => {
    const cfg = sanitizeRankingConfig({
      eventWeights: { like: 9999, purchase: -9999, bogus: 5, share: "3.5", view: "abc" },
      scoreWeights: { affinity: -4, freshness: 1e9, nope: 1 },
      recencyHalfLifeHours: 0,
      liveInterleaveEvery: 1,
      explorationEvery: 1000.4,
      engagementWindowDays: 9999,
      unknownTop: true,
    }) as any;
    expect(cfg.eventWeights.like).toBe(10);
    expect(cfg.eventWeights.purchase).toBe(-10);
    expect(cfg.eventWeights.share).toBe(3.5);
    expect(cfg.eventWeights.view).toBe(DEFAULT_RANKING_CONFIG.eventWeights.view);
    expect(cfg.eventWeights.bogus).toBeUndefined();
    expect(cfg.scoreWeights.affinity).toBe(0);
    expect(cfg.scoreWeights.freshness).toBe(20);
    expect(cfg.scoreWeights.nope).toBeUndefined();
    expect(cfg.recencyHalfLifeHours).toBe(1);
    expect(cfg.liveInterleaveEvery).toBe(2);
    expect(cfg.explorationEvery).toBe(50);
    expect(cfg.engagementWindowDays).toBe(90);
    expect(cfg.unknownTop).toBeUndefined();
  });

  it("does not mutate defaults and layers onto a base", () => {
    const before = JSON.stringify(DEFAULT_RANKING_CONFIG);
    const a = sanitizeRankingConfig({ scoreWeights: { affinity: 5 } });
    const b = sanitizeRankingConfig({ scoreWeights: { followed: 2 } }, a);
    expect(b.scoreWeights.affinity).toBe(5);
    expect(b.scoreWeights.followed).toBe(2);
    expect(JSON.stringify(DEFAULT_RANKING_CONFIG)).toBe(before);
  });

  it("parseEnvOverride tolerates invalid JSON", () => {
    expect(parseEnvOverride("{oops")).toBeNull();
    expect(parseEnvOverride(undefined)).toBeNull();
    expect(parseEnvOverride('{"scoreWeights":{"affinity":4}}')).toEqual({ scoreWeights: { affinity: 4 } });
  });
});

describe("survey preference seeding", () => {
  const now = Date.now();
  const cfg = DEFAULT_RANKING_CONFIG;
  const base: RankingCandidate = {
    id: "p1", sellerId: "brand_a", createdAt: new Date(now), styleTags: ["streetwear"],
    isFollowed: false, isBoosted: false, isLive: false, sellerScore: 0,
  };

  it("boosts a candidate from a brand the buyer liked in the survey", () => {
    const without = scoreCandidate(base, {}, {}, {}, now, cfg);
    const withLiked = scoreCandidate(base, {}, {}, {}, now, cfg, new Set(["brand_a"]));
    expect(withLiked - without).toBeCloseTo(W_LIKED_BRAND, 5);
    expect(scoreCandidate(base, {}, {}, {}, now, cfg, new Set(["brand_b"]))).toBeCloseTo(without, 5);
  });

  it("seeds survey style interests (case-insensitive) into an empty affinity map", () => {
    expect(mergePreferenceStyleAffinity({}, ["Streetwear", " Vintage "]))
      .toEqual({ streetwear: PREFERENCE_STYLE_SEED, vintage: PREFERENCE_STYLE_SEED });
  });

  it("never lowers a learned score and never overrides a negative one", () => {
    const merged = mergePreferenceStyleAffinity({ streetwear: 9, vintage: -2 }, ["streetwear", "vintage"]);
    expect(merged.streetwear).toBe(9);
    expect(merged.vintage).toBe(-2);
  });

  it("returns the same map when there are no survey interests and does not mutate input", () => {
    const learned = { a: 1 };
    expect(mergePreferenceStyleAffinity(learned, [])).toBe(learned);
    mergePreferenceStyleAffinity(learned, ["b"]);
    expect(learned).toEqual({ a: 1 });
  });

  it("ranks a survey-matching post above a non-matching one for a buyer with no history", () => {
    const affinity = mergePreferenceStyleAffinity({}, ["streetwear"]);
    const match = scoreCandidate(base, {}, affinity, {}, now, cfg);
    const miss = scoreCandidate({ ...base, styleTags: ["formal"] }, {}, affinity, {}, now, cfg);
    expect(match).toBeGreaterThan(miss);
  });
});
