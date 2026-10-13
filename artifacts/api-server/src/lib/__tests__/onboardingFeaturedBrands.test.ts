import { describe, expect, it } from "vitest";
import { parseFeaturedHandles, shapeFeaturedBrands, type FeaturedSellerRow } from "../onboardingFeaturedBrands";

const seller = (clerkId: string, username: string, extra: Partial<FeaturedSellerRow> = {}): FeaturedSellerRow => ({
  clerkId, username, displayName: null, brandName: null, profileImageUrl: null, avatarUrl: null, verified: false, ...extra,
});

describe("parseFeaturedHandles", () => {
  it("is empty when unset", () => {
    expect(parseFeaturedHandles(undefined)).toEqual([]);
    expect(parseFeaturedHandles("  ")).toEqual([]);
  });
  it("trims, drops @, lower-cases, de-duplicates and keeps order", () => {
    expect(parseFeaturedHandles(" @NorthlineStudio, emberandash ,northlinestudio,quiet.hours")).toEqual(["northlinestudio", "emberandash", "quiet.hours"]);
  });
  it("caps at three brands and ignores junk", () => {
    expect(parseFeaturedHandles("a,b c,d,e,f")).toEqual(["a", "d", "e"]);
  });
});

describe("shapeFeaturedBrands", () => {
  const sellers = [
    seller("u1", "northline", { brandName: "Northline Studio", verified: true, profileImageUrl: "/objects/logo1" }),
    seller("u2", "Ember", { displayName: "Ember & Ash" }),
    seller("u3", "quiet"),
  ];
  const products = [
    { ownerId: "u1", images: ["/objects/p1", "/objects/p1b"] },
    { ownerId: "u2", images: ["https://cdn.shopify.com/e1.jpg"] },
    { ownerId: "u1", images: [] },
    { ownerId: "u1", images: ["/objects/p2"] },
    { ownerId: "u1", images: ["/objects/p3"] },
    { ownerId: "u1", images: ["/objects/p4"] },
    { ownerId: "u3", images: null },
  ];
  it("keeps the configured order, one photo per product, at most three", () => {
    const out = shapeFeaturedBrands(["ember", "northline", "quiet"], sellers, products, new Map([["u1", 12]]));
    expect(out.map((b) => b.handle)).toEqual(["Ember", "northline"]);
    expect(out[1]).toMatchObject({ sellerId: "u1", name: "Northline Studio", verified: true, logoUrl: "/objects/logo1", productCount: 12, productImages: ["/objects/p1", "/objects/p2", "/objects/p3"] });
    expect(out[0]).toMatchObject({ name: "Ember & Ash", productCount: 1, productImages: ["https://cdn.shopify.com/e1.jpg"] });
  });
  it("leaves out unknown handles and brands with no product photo", () => {
    expect(shapeFeaturedBrands(["nobody", "quiet"], sellers, products, new Map())).toEqual([]);
  });
});
