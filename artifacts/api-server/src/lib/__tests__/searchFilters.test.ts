import { describe, expect, it } from "vitest";
import { buildFacets, compareSizes, multiQueryValues, parseSearchFilters, type FacetRow } from "../searchFilters";

describe("multiQueryValues", () => {
  it("accepts single and repeated params, trims and dedupes case-insensitively", () => {
    expect(multiQueryValues(undefined)).toEqual([]);
    expect(multiQueryValues("M")).toEqual(["M"]);
    expect(multiQueryValues([" M ", "m", "L"])).toEqual(["M", "L"]);
  });
  it("rejects non-strings and caps the list", () => {
    expect(multiQueryValues([{ a: 1 }])).toBeNull();
    expect(multiQueryValues(Array.from({ length: 50 }, (_, i) => `v${i}`))).toHaveLength(20);
  });
});

describe("parseSearchFilters", () => {
  it("parses every facet and in-stock", () => {
    expect(parseSearchFilters({ size: ["M", "L"], color: "Black", category: "apparel", brand: "b1", inStock: "1" }))
      .toEqual({ sizes: ["M", "L"], colors: ["Black"], categories: ["apparel"], brands: ["b1"], inStock: true });
  });
  it("defaults to no filters", () => {
    expect(parseSearchFilters({})).toEqual({ sizes: [], colors: [], categories: [], brands: [], inStock: false });
  });
  it("rejects malformed values", () => {
    expect(parseSearchFilters({ inStock: "maybe" })).toBeNull();
    expect(parseSearchFilters({ size: [["x"]] })).toBeNull();
  });
});

describe("compareSizes", () => {
  it("orders letter sizes, then numbers, then text", () => {
    expect(["XL", "S", "42", "M", "38", "One size", "XS"].sort(compareSizes))
      .toEqual(["XS", "S", "M", "XL", "38", "42", "One size"]);
  });
});

describe("buildFacets", () => {
  const rows: FacetRow[] = [
    { productId: "p1", category: "apparel", ownerId: "o1", brandName: "Noir", size: "M", color: "Black", priceCents: 2000, stock: 3 },
    { productId: "p1", category: "apparel", ownerId: "o1", brandName: "Noir", size: "L", color: "black", priceCents: 2500, stock: 0 },
    { productId: "p2", category: "shoes", ownerId: "o2", brandName: "Atelier", size: "M", color: "White", priceCents: 9000, stock: 0 },
  ];
  it("counts distinct products, folds case, and reports price range", () => {
    const f = buildFacets(rows);
    expect(f.sizes).toEqual([{ value: "M", count: 2 }, { value: "L", count: 1 }]);
    expect(f.colors).toEqual([{ value: "Black", count: 1 }, { value: "White", count: 1 }]);
    expect(f.categories.map((c) => c.value).sort()).toEqual(["apparel", "shoes"]);
    expect(f.brands).toEqual([{ id: "o2", name: "Atelier", count: 1 }, { id: "o1", name: "Noir", count: 1 }]);
    expect(f.price).toEqual({ minCents: 2000, maxCents: 9000 });
    expect(f.inStockCount).toBe(1);
  });
  it("handles no rows", () => {
    expect(buildFacets([]).price).toBeNull();
  });
});
