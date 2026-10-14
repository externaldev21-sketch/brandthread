import { describe, expect, it } from "vitest";
import { brandProductsBySeller, photoBrandsFirst } from "../discoverBrandProducts";

describe("brandProductsBySeller", () => {
  const rows = [
    { ownerId: "u1", images: ["/objects/p1", "/objects/p1b"] },
    { ownerId: "u2", images: ["https://cdn.example.com/e1.jpg"] },
    { ownerId: "u1", images: [] },
    { ownerId: "u1", images: ["/objects/p2"] },
    { ownerId: "u1", images: ["/objects/p1"] },
    { ownerId: "u1", images: ["/objects/p3"] },
    { ownerId: "u1", images: ["/objects/p4"] },
    { ownerId: "u3", images: null },
    { ownerId: "stranger", images: ["/objects/x"] },
  ];

  it("takes the first photo of each newest product, de-duplicated, at most three", () => {
    const out = brandProductsBySeller(["u1", "u2", "u3"], rows, new Map([["u1", 12], ["u2", 1]]));
    expect(out.get("u1")).toEqual({ productCount: 12, productImages: ["/objects/p1", "/objects/p2", "/objects/p3"] });
    expect(out.get("u2")).toEqual({ productCount: 1, productImages: ["https://cdn.example.com/e1.jpg"] });
  });

  it("reports zero for a brand with no live products and ignores sellers not asked for", () => {
    const out = brandProductsBySeller(["u1", "u3"], rows, new Map());
    expect(out.get("u3")).toEqual({ productCount: 0, productImages: [] });
    expect(out.has("stranger")).toBe(false);
  });
});

describe("photoBrandsFirst", () => {
  it("moves brands with photos ahead, keeping order inside each group", () => {
    const brands = [
      { id: "a", productImages: [] },
      { id: "b", productImages: ["x"] },
      { id: "c", productImages: [] },
      { id: "d", productImages: ["y"] },
    ];
    expect(photoBrandsFirst(brands).map((b) => b.id)).toEqual(["b", "d", "a", "c"]);
  });
});
