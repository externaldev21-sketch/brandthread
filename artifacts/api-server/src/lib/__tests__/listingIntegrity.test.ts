import { describe, expect, it, vi } from "vitest";

// Pure logic: the DB-backed defaults are always replaced through `deps`.
vi.mock("@workspace/db", () => ({ db: {}, users: {} }));
vi.mock("../threadCash/wallet", () => ({ isFeatureEnabled: async () => true }));

import { checkListingIntegrity, counterfeitRefusal, findCounterfeitTerms } from "../listingIntegrity";

const terms = (input: Parameters<typeof findCounterfeitTerms>[0]) => findCounterfeitTerms(input).map((h) => h.term);

describe("findCounterfeitTerms", () => {
  it("finds counterfeit signals in the name, description and tags", () => {
    expect(terms({ name: "Replica hoodie" })).toEqual(["replica"]);
    expect(terms({ description: "Mirror quality, ships fast" })).toEqual(["mirror quality"]);
    expect(terms({ name: "Tee", tags: ["1:1"] })).toEqual(["1:1"]);
  });

  it("finds protected brand names", () => {
    expect(terms({ name: "Vintage Nike windbreaker" })).toEqual(["nike"]);
    expect(terms({ name: "LOUIS VUITTON bag" })).toEqual(["louis vuitton"]);
  });

  it("sees through spacing, accents and separators", () => {
    expect(terms({ name: "Hermès scarf" })).toEqual(["hermes"]);
    expect(terms({ name: "louis-vuitton belt" })).toEqual(["louis vuitton"]);
    expect(terms({ name: "knock-off jacket" })).toContain("knock-off");
  });

  it("matches whole words only", () => {
    expect(terms({ name: "Snuggle blanket" })).toEqual([]);
    expect(terms({ name: "Nikesha's custom tee" })).toEqual([]);
    expect(terms({ description: "Faux leather jacket, bootleg-style print" })).toEqual([]);
    expect(terms({ name: "Heavyweight boxy tee", description: "Inspired by 90s skate culture" })).toEqual([]);
  });

  it("keeps the longest of overlapping brand names", () => {
    expect(terms({ name: "Yves Saint Laurent blazer" })).toEqual(["yves saint laurent"]);
  });

  it("does not join words across separate tags", () => {
    expect(terms({ tags: ["knock", "off"] })).toEqual([]);
  });
});

describe("checkListingIntegrity", () => {
  const on = async () => true;
  const off = async () => false;

  it("lets clean listings through without looking up the seller", async () => {
    let looked = false;
    const result = await checkListingIntegrity("seller", { name: "Boxy tee" }, {
      flagEnabled: on, sellerVerified: async () => { looked = true; return false; },
    });
    expect(result).toBeNull();
    expect(looked).toBe(false);
  });

  it("blocks unverified sellers", async () => {
    const result = await checkListingIntegrity("seller", { name: "Replica Gucci belt" }, {
      flagEnabled: on, sellerVerified: off,
    });
    expect(result?.map((h) => h.term)).toEqual(["replica", "gucci"]);
  });

  it("lets verified sellers through", async () => {
    const result = await checkListingIntegrity("seller", { name: "Nike Dunk Low, worn twice" }, {
      flagEnabled: on, sellerVerified: on,
    });
    expect(result).toBeNull();
  });

  it("does nothing when the flag is off", async () => {
    const result = await checkListingIntegrity("seller", { name: "Replica" }, {
      flagEnabled: off, sellerVerified: off,
    });
    expect(result).toBeNull();
  });
});

describe("counterfeitRefusal", () => {
  it("names up to three terms and points at verification", () => {
    const body = counterfeitRefusal([
      { term: "replica", kind: "signal" }, { term: "gucci", kind: "brand" },
      { term: "prada", kind: "brand" }, { term: "dior", kind: "brand" },
    ]);
    expect(body.code).toBe("COUNTERFEIT_TERMS");
    expect(body.error).toBe("Remove “replica”, “gucci”, “prada” to publish. Only verified brands can use these words in a listing.");
    expect(body.terms).toHaveLength(4);
    expect(body.verifyRoute).toBe("/seller-verification");
  });
});
