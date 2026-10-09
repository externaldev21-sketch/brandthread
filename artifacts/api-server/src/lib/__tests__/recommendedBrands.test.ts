import { describe, expect, it } from "vitest";
import { rankRecommendedBrands, styleOverlap, type BrandCandidate } from "../recommendedBrands";

const brand = (id: string, over: Partial<BrandCandidate> = {}): BrandCandidate => ({
  sellerId: id, name: id, brandType: null, logoUrl: null, verified: false, followerCount: 0, styleTags: [], ...over,
});
const ctx = { styleInterests: [] as string[], likedBrandIds: [] as string[], likedBrandTypes: [] as string[] };

describe("styleOverlap", () => {
  it("is case-insensitive and reports the matched interests", () => {
    expect(styleOverlap(["Streetwear", "Vintage"], ["streetwear", "minimal"])).toEqual({ ratio: 0.5, matched: ["streetwear"] });
  });
  it("is 0 with no interests", () => expect(styleOverlap([], ["a"]).ratio).toBe(0));
});

describe("rankRecommendedBrands", () => {
  it("ranks style-matching brands above merely popular ones", () => {
    const out = rankRecommendedBrands(
      [brand("popular", { followerCount: 5000 }), brand("match", { styleTags: ["streetwear"], followerCount: 10 })],
      { ...ctx, styleInterests: ["streetwear"] },
    );
    expect(out.map((b) => b.id)).toEqual(["match", "popular"]);
    expect(out[0].reason).toBe("Matches your style");
  });

  it("boosts brands sharing a type with liked brands, and brands liked but not followed", () => {
    const out = rankRecommendedBrands(
      [brand("other"), brand("same-type", { brandType: "Footwear" }), brand("liked")],
      { ...ctx, likedBrandIds: ["liked"], likedBrandTypes: ["footwear"] },
    );
    expect(out.map((b) => b.id)).toEqual(["liked", "same-type", "other"]);
    expect(out[1].reason).toBe("Similar to your picks");
  });

  it("falls back to popularity for a buyer with no signals", () => {
    const out = rankRecommendedBrands([brand("a", { followerCount: 1 }), brand("b", { followerCount: 100 })], ctx);
    expect(out.map((b) => b.id)).toEqual(["b", "a"]);
    expect(out[0].reason).toBe("Popular right now");
  });

  it("drops excluded (followed/blocked) ids, honors the limit and returns [] when empty", () => {
    const out = rankRecommendedBrands([brand("a"), brand("b"), brand("c")], { ...ctx, excludeIds: new Set(["a"]) }, 1);
    expect(out).toHaveLength(1);
    expect(out[0].id).not.toBe("a");
    expect(rankRecommendedBrands([], ctx)).toEqual([]);
  });

  it("breaks ties deterministically by followers then id", () => {
    const out = rankRecommendedBrands([brand("z"), brand("m"), brand("a")], ctx);
    expect(out.map((b) => b.id)).toEqual(["a", "m", "z"]);
  });
});
