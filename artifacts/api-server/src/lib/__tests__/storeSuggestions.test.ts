import { describe, expect, it } from "vitest";
import { buildStoreContext, parseSuggestionAction, parseSuggestions, MAX_SUGGESTIONS } from "../storeSuggestions";

const good = {
  category: "copy",
  title: "Sharpen your SEO title",
  problem: "Your search title is empty.",
  recommendation: "Use a title that names what you sell.",
  action: { type: "set_seo_title", value: "Nightshift Studio — Heavyweight Tees" },
};

describe("parseSuggestionAction", () => {
  it("accepts known value actions and screens", () => {
    expect(parseSuggestionAction({ type: "set_store_name", value: " Nightshift " })).toEqual({ type: "set_store_name", value: "Nightshift" });
    expect(parseSuggestionAction({ type: "open_screen", screen: "collections" })).toEqual({ type: "open_screen", screen: "collections" });
  });

  it("rejects unknown types, unknown screens, empty or over-long values", () => {
    expect(parseSuggestionAction({ type: "delete_store" })).toBeNull();
    expect(parseSuggestionAction({ type: "open_screen", screen: "admin" })).toBeNull();
    expect(parseSuggestionAction({ type: "set_seo_title", value: "" })).toBeNull();
    expect(parseSuggestionAction({ type: "set_seo_title", value: "x".repeat(71) })).toBeNull();
    expect(parseSuggestionAction(null)).toBeNull();
  });

  it("strips markup characters from values", () => {
    expect(parseSuggestionAction({ type: "set_hero_heading", value: "New <b>drop</b>" })).toEqual({ type: "set_hero_heading", value: "New bdrop/b" });
  });
});

describe("parseSuggestions", () => {
  it("keeps valid suggestions with stable ids", () => {
    const out = parseSuggestions({ suggestions: [good] }, "t");
    expect(out).toEqual([{ id: "t_0", ...good }]);
  });

  it("drops malformed entries and duplicate titles, never fills in text", () => {
    const out = parseSuggestions({ suggestions: [
      good,
      { ...good },
      { ...good, title: "Other", category: "nonsense" },
      { ...good, title: "No action", action: undefined },
      { ...good, title: "No problem", problem: "" },
      "junk",
    ] }, "t");
    expect(out.map((s) => s.title)).toEqual(["Sharpen your SEO title"]);
  });

  it("caps the number of suggestions", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...good, title: `T${i}` }));
    expect(parseSuggestions({ suggestions: many })).toHaveLength(MAX_SUGGESTIONS);
  });

  it("returns [] for non-object replies", () => {
    expect(parseSuggestions(null)).toEqual([]);
    expect(parseSuggestions({ suggestions: "x" })).toEqual([]);
  });
});

describe("buildStoreContext", () => {
  it("summarises real store data", () => {
    const ctx = buildStoreContext({
      title: "Nightshift", status: "published", seo: { metaTitle: "NS" },
      sections: [{ type: "hero_image", settings: { heading: "Hi" } }],
      collections: [{ name: "Winter", status: "active" }, { name: "Old", status: "draft" }],
      pages: [{ type: "about", status: "published" }],
      navigation: [{ type: "main", items: [{}, {}] }],
    }, { activeProductCount: 3, sampleProductNames: ["Tee"], productsWithoutImages: 1 }) as any;
    expect(ctx.storeName).toBe("Nightshift");
    expect(ctx.published).toBe(true);
    expect(ctx.homepageSections[0]).toMatchObject({ type: "hero_image", heading: "Hi" });
    expect(ctx.collections).toEqual({ total: 2, live: 1, names: ["Winter", "Old"] });
    expect(ctx.pages).toEqual({ total: 1, published: 1, types: ["about"] });
    expect(ctx.navigation).toEqual([{ type: "main", itemCount: 2 }]);
    expect(ctx.catalog.activeProducts).toBe(3);
  });

  it("handles a missing storefront", () => {
    const ctx = buildStoreContext(null, { activeProductCount: 0, sampleProductNames: [], productsWithoutImages: 0 }) as any;
    expect(ctx.storeName).toBe("");
    expect(ctx.collections.total).toBe(0);
  });
});
