import { describe, expect, it } from "vitest";
import {
  TIER, bestTier, escapeRegex, isSearchChipKey, matchTier, orderSections, rankScore, secondaryTier, styleTagSpellings,
} from "./searchRanking";

describe("matchTier", () => {
  it("orders exact > prefix > word > contains > fuzzy", () => {
    expect(matchTier("Vintage Tee", "vintage tee")).toBe(TIER.EXACT);
    expect(matchTier("Vintage Tee", "vint")).toBe(TIER.PREFIX);
    expect(matchTier("Washed Vintage Tee", "vint")).toBe(TIER.WORD);
    expect(matchTier("Vintage Tee", "tag")).toBe(TIER.CONTAINS);
    expect(matchTier("Vintage Tee", "vintge")).toBe(TIER.FUZZY);
  });

  it("is case-insensitive and treats punctuation as a word boundary", () => {
    expect(matchTier("NORTHLINE", "northline")).toBe(TIER.EXACT);
    expect(matchTier("y2k-baby tee", "baby")).toBe(TIER.WORD);
    expect(matchTier("#streetwear fit", "streetwear")).toBe(TIER.WORD);
    expect(matchTier("@northline", "north")).toBe(TIER.WORD);
  });

  it("finds a later word-start even when an earlier occurrence is mid-word", () => {
    // first "tee" is inside "steel", second starts a word
    expect(matchTier("steel tee", "tee")).toBe(TIER.WORD);
  });

  it("handles empty input", () => {
    expect(matchTier(null, "tee")).toBe(TIER.FUZZY);
    expect(matchTier("tee", "  ")).toBe(TIER.FUZZY);
  });
});

describe("secondary fields", () => {
  it("never rank above a word match", () => {
    expect(secondaryTier(TIER.EXACT)).toBe(TIER.WORD);
    expect(secondaryTier(TIER.PREFIX)).toBe(TIER.WORD);
    expect(secondaryTier(TIER.CONTAINS)).toBe(TIER.CONTAINS);
  });

  it("a title prefix beats a description that starts with the query", () => {
    const titled = bestTier(["Hoodie Classic"], ["Heavyweight fleece"], "hoodie");
    const described = bestTier(["Classic Pullover"], ["Hoodie in heavyweight fleece"], "hoodie");
    expect(titled).toBe(TIER.PREFIX);
    expect(described).toBe(TIER.WORD);
    expect(titled).toBeLessThan(described);
  });
});

describe("rankScore", () => {
  it("tier dominates popularity", () => {
    const prefixUnknown = rankScore(TIER.PREFIX, 0.2, 0);
    const wordFamous = rankScore(TIER.WORD, 1, 10_000_000);
    expect(prefixUnknown).toBeGreaterThan(wordFamous);
  });

  it("popularity and similarity break ties within a tier", () => {
    expect(rankScore(TIER.WORD, 0.5, 1000)).toBeGreaterThan(rankScore(TIER.WORD, 0.5, 10));
    expect(rankScore(TIER.WORD, 0.8, 0)).toBeGreaterThan(rankScore(TIER.WORD, 0.3, 0));
  });

  it("sorting a mixed list puts exact > prefix > word > contains", () => {
    const rows = [
      { name: "Retro Vintage Tee", pop: 900 },
      { name: "vintage", pop: 0 },
      { name: "Vintage Denim", pop: 5 },
      { name: "Revintaged Cap", pop: 50_000 },
    ];
    const sorted = rows
      .map((r) => ({ ...r, score: rankScore(matchTier(r.name, "vintage"), 0, r.pop) }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.name);
    expect(sorted).toEqual(["vintage", "Vintage Denim", "Retro Vintage Tee", "Revintaged Cap"]);
  });
});

describe("orderSections (Top overview)", () => {
  it("puts the section with the best-tier match first", () => {
    expect(orderSections({
      products: { items: [{ tier: TIER.WORD }] },
      brands: { items: [{ tier: TIER.EXACT }] },
      posts: { items: [{ tier: TIER.PREFIX }] },
    })).toEqual(["brands", "posts", "products"]);
  });

  it("breaks equal tiers by buying intent: products > brands > people > posts", () => {
    expect(orderSections({
      posts: { items: [{ tier: TIER.PREFIX }] },
      people: { items: [{ tier: TIER.PREFIX }] },
      products: { items: [{ tier: TIER.PREFIX }] },
    })).toEqual(["products", "people", "posts"]);
  });

  it("drops empty sections", () => {
    expect(orderSections({ products: { items: [] }, people: { items: [{ tier: TIER.FUZZY }] } })).toEqual(["people"]);
  });
});

describe("category chips", () => {
  it("accepts style tags and the accessories category, rejects anything else", () => {
    for (const k of ["streetwear", "vintage", "y2k", "accessories", "dark_academia"]) expect(isSearchChipKey(k)).toBe(true);
    expect(isSearchChipKey("'; drop table products")).toBe(false);
    expect(isSearchChipKey("Streetwear")).toBe(false);
  });

  it("expands underscore keys into the spellings sellers type as tags", () => {
    expect(styleTagSpellings("dark_academia")).toEqual(["dark_academia", "dark academia", "darkacademia", "dark-academia"]);
    expect(styleTagSpellings("y2k")).toEqual(["y2k"]);
  });

  it("escapes regex metacharacters", () => {
    expect(escapeRegex("a.b*c")).toBe("a\\.b\\*c");
  });
});
