import { describe, expect, it } from "vitest";
import { goneProductBody } from "./goneProduct";

const owner = { clerkId: "user_seller", brandName: "Field Notes", displayName: "Sam", deletedAt: null };

describe("goneProductBody", () => {
  it("names the brand when the seller is still around", () => {
    expect(goneProductBody(owner)).toEqual({
      error: "Product not found",
      gone: { sellerId: "user_seller", sellerName: "Field Notes" },
    });
  });

  it("falls back to the display name", () => {
    expect(goneProductBody({ ...owner, brandName: "  " }).gone?.sellerName).toBe("Sam");
  });

  it("is a plain 404 when nothing is known", () => {
    expect(goneProductBody(null)).toEqual({ error: "Product not found" });
    expect(goneProductBody({ ...owner, brandName: null, displayName: null })).toEqual({ error: "Product not found" });
  });

  it("never points at a deleted seller", () => {
    expect(goneProductBody({ ...owner, deletedAt: new Date() })).toEqual({ error: "Product not found" });
  });
});
