import { describe, expect, it } from "vitest";
import {
  CATEGORY_SLUGS, categoryLabel, classifyProduct, isCategorySlug, summarizeCategories,
} from "../categoryTaxonomy";

describe("classifyProduct", () => {
  it("maps the seller category field, singular or plural, any case", () => {
    expect(classifyProduct({ category: "Hoodie", name: "x" })).toBe("hoodies");
    expect(classifyProduct({ category: "hoodies", name: "x" })).toBe("hoodies");
    expect(classifyProduct({ category: "T-Shirts", name: "x" })).toBe("tees");
    expect(classifyProduct({ category: "sneakers", name: "x" })).toBe("footwear");
    expect(classifyProduct({ category: "Denim", name: "x" })).toBe("denim");
  });

  it("falls back to the product name when the category is the default", () => {
    expect(classifyProduct({ category: "apparel", name: "Heavyweight Zip-Up Hoodie" })).toBe("hoodies");
    expect(classifyProduct({ category: "apparel", name: "Raw Selvedge Jeans" })).toBe("denim");
    expect(classifyProduct({ category: "apparel", name: "Leather Ankle Boots" })).toBe("footwear");
  });

  it("falls back to tags and style tags last", () => {
    expect(classifyProduct({ category: "apparel", name: "Logo piece", tags: ["streetwear", "shorts"] })).toBe("shorts");
    expect(classifyProduct({ category: "apparel", name: "Logo piece", styleTags: ["knitwear"] })).toBe("knitwear");
  });

  it("prefers the more specific garment: a denim jacket is a jacket", () => {
    expect(classifyProduct({ category: "apparel", name: "Denim Trucker Jacket" })).toBe("jackets");
  });

  it("prefers the category field over the name", () => {
    expect(classifyProduct({ category: "accessories", name: "Hoodie strap bag" })).toBe("accessories");
  });

  it("does not match inside unrelated words", () => {
    expect(classifyProduct({ category: "apparel", name: "Shortbread print" })).toBeNull();
    expect(classifyProduct({ category: "apparel", name: "Capital Letters" })).toBeNull();
  });

  it("returns null when nothing maps, and tolerates bad input", () => {
    expect(classifyProduct({ category: "apparel", name: "Logo piece" })).toBeNull();
    expect(classifyProduct({})).toBeNull();
    expect(classifyProduct({ category: 5, name: null, tags: "nope", styleTags: [1, null] })).toBeNull();
  });
});

describe("taxonomy helpers", () => {
  it("exposes slugs and labels", () => {
    expect(CATEGORY_SLUGS).toEqual(expect.arrayContaining(["hoodies", "tees", "denim", "jackets", "footwear", "accessories"]));
    expect(isCategorySlug("hoodies")).toBe(true);
    expect(isCategorySlug("apparel")).toBe(false);
    expect(categoryLabel("tees")).toBe("Tees");
    expect(categoryLabel("nope")).toBeNull();
  });
});

describe("summarizeCategories", () => {
  it("counts per slug, biggest first, cover = newest product with an image", () => {
    const out = summarizeCategories([
      { slug: "tees", images: [] },
      { slug: "tees", images: ["tee-new.jpg"] },
      { slug: "tees", images: ["tee-old.jpg"] },
      { slug: "denim", images: ["jeans.jpg"] },
      { slug: null, images: ["ignored.jpg"] },
    ]);
    expect(out).toEqual([
      { slug: "tees", label: "Tees", productCount: 3, coverImageUrl: "tee-new.jpg" },
      { slug: "denim", label: "Denim", productCount: 1, coverImageUrl: "jeans.jpg" },
    ]);
  });

  it("breaks count ties by taxonomy order and returns [] for no products", () => {
    const out = summarizeCategories([
      { slug: "footwear", images: null },
      { slug: "hoodies", images: null },
    ]);
    expect(out.map((c) => c.slug)).toEqual(["hoodies", "footwear"]);
    expect(out[0].coverImageUrl).toBeNull();
    expect(summarizeCategories([])).toEqual([]);
  });
});
