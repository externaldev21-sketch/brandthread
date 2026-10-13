import { describe, expect, it, vi } from "vitest";

// `@workspace/db` throws at import unless DATABASE_URL is set. The pool is
// lazy and rankRelatedProducts is pure, so nothing ever connects.
vi.hoisted(() => { process.env.DATABASE_URL ??= "postgres://unit-test@127.0.0.1:1/none"; });

const { rankRelatedProducts } = await import("../public");

const at = (day: number) => new Date(Date.UTC(2026, 9, day));
const p = (id: string, over: Partial<{ ownerId: string; category: string; tags: string[] }> = {}) => ({
  id, ownerId: over.ownerId ?? "other", category: over.category ?? "hoodies", tags: over.tags ?? [], styleTags: [], createdAt: at(1),
});

describe("rankRelatedProducts price band (polish 102)", () => {
  const current = p("current", { ownerId: "me" });
  const prices = new Map([["current", 10000], ["cheap", 2000], ["near", 11000], ["pricey", 30000], ["near-old", 9000]]);

  it("ranks same-category items in the price band first", () => {
    const ranked = rankRelatedProducts(current, [p("cheap"), p("pricey"), p("near")], prices).map((x) => x.id);
    expect(ranked[0]).toBe("near");
  });

  it("keeps the seller and category tiers above the price band", () => {
    const sameSellerOutOfBand = p("cheap", { ownerId: "me" });
    const otherCategoryInBand = p("near", { category: "pants" });
    const ranked = rankRelatedProducts(current, [otherCategoryInBand, p("near-old"), sameSellerOutOfBand], prices).map((x) => x.id);
    expect(ranked).toEqual(["cheap", "near-old", "near"]);
  });

  it("falls back to the previous order without prices", () => {
    const withTag = p("tagged", { tags: ["drop"] });
    const cur = { ...current, tags: ["drop"] };
    expect(rankRelatedProducts(cur, [p("plain"), withTag]).map((x) => x.id)).toEqual(["tagged", "plain"]);
  });
});
