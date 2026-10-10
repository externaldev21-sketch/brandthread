import { describe, expect, it } from "vitest";
import { productReadAccess } from "./productPreviewAccess";

const product = (over: Partial<{ status: string; ownerId: string; deletedAt: Date | null }> = {}) => ({
  status: "active", ownerId: "user_owner", deletedAt: null, ...over,
});

describe("productReadAccess", () => {
  it("serves active products to everyone", () => {
    expect(productReadAccess(product(), null)).toBe("public");
    expect(productReadAccess(product(), "user_other")).toBe("public");
    expect(productReadAccess(product(), "user_owner")).toBe("public");
  });

  it("lets only the owner preview a draft or inactive product", () => {
    for (const status of ["draft", "inactive", "archived"]) {
      expect(productReadAccess(product({ status }), "user_owner")).toBe("owner_preview");
      expect(productReadAccess(product({ status }), "user_other")).toBe("hidden");
      expect(productReadAccess(product({ status }), null)).toBe("hidden");
    }
  });

  it("never serves deleted or missing products", () => {
    expect(productReadAccess(product({ deletedAt: new Date() }), "user_owner")).toBe("hidden");
    expect(productReadAccess(product({ status: "draft", deletedAt: new Date() }), "user_owner")).toBe("hidden");
    expect(productReadAccess(null, "user_owner")).toBe("hidden");
  });
});
