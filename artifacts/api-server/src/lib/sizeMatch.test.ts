import { describe, expect, it } from "vitest";
import {
  matchSizeLabel, productSizeCategory, productSizeLabels, savedSizeMatchesVariant, sizeCategoryFor,
} from "./sizeMatch";

// Cases copied from artifacts/mobile/lib/sizeRecommendation.test.ts and sizeBadge.test.ts.
const product = (over: Record<string, unknown> = {}) => ({
  name: "Wool tee",
  category: "Tops",
  options: [{ name: "Size", values: [{ label: "S" }, { label: "M" }, { label: "L" }] }],
  ...over,
});

describe("sizeCategoryFor", () => {
  it("maps common product text", () => {
    expect(sizeCategoryFor("Leather Ankle Boots")).toBe("shoes");
    expect(sizeCategoryFor("Puffer jacket")).toBe("outerwear");
    expect(sizeCategoryFor("Wide-leg jeans")).toBe("bottoms");
    expect(sizeCategoryFor("Boxy tee")).toBe("tops");
    expect(sizeCategoryFor("Candle")).toBeNull();
  });
  it("is null for empty input", () => {
    expect(sizeCategoryFor("")).toBeNull();
    expect(sizeCategoryFor(null)).toBeNull();
    expect(sizeCategoryFor(undefined)).toBeNull();
  });
});

describe("productSizeCategory", () => {
  it("uses the category first, then the name", () => {
    expect(productSizeCategory({ category: "Footwear", name: "Wool tee" })).toBe("shoes");
    expect(productSizeCategory({ category: "Home", name: "Denim jacket" })).toBe("outerwear");
    expect(productSizeCategory({ category: "Home", name: "Candle" })).toBeNull();
  });
});

describe("size labels", () => {
  it("matches a size to a chip label", () => {
    expect(matchSizeLabel("m", ["S", "M"])).toBe("M");
    expect(matchSizeLabel("xl", ["S"])).toBeNull();
    expect(matchSizeLabel("M", null)).toBeNull();
  });
  it("reads size labels from the Size option", () => {
    expect(productSizeLabels(product())).toEqual(["S", "M", "L"]);
    expect(productSizeLabels({ options: [{ name: "Color", values: [{ label: "Red" }] }] })).toBeNull();
  });
});

describe("savedSizeMatchesVariant", () => {
  it("matches the saved size for the category, ignoring case and spaces", () => {
    expect(savedSizeMatchesVariant({ tops: "m" }, "tops", "M")).toBe(true);
    expect(savedSizeMatchesVariant({ shoes: "US 10" }, "shoes", "us10")).toBe(true);
  });
  it("does not match another size or another category's size", () => {
    expect(savedSizeMatchesVariant({ tops: "L" }, "tops", "M")).toBe(false);
    expect(savedSizeMatchesVariant({ bottoms: "M" }, "tops", "M")).toBe(false);
  });
  it("never matches without a category, saved size or variant size", () => {
    expect(savedSizeMatchesVariant({ tops: "M" }, null, "M")).toBe(false);
    expect(savedSizeMatchesVariant({}, "tops", "M")).toBe(false);
    expect(savedSizeMatchesVariant(null, "tops", "M")).toBe(false);
    expect(savedSizeMatchesVariant({ tops: "M" }, "tops", null)).toBe(false);
    expect(savedSizeMatchesVariant({ tops: "M" }, "tops", "  ")).toBe(false);
  });
});
