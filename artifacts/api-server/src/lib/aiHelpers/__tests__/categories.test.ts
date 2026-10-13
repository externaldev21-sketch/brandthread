import { describe, expect, it } from "vitest";
import { PRODUCT_CATEGORIES, pickCategory } from "../categories";

describe("pickCategory", () => {
  it("maps loose spellings onto the exact category", () => {
    expect(pickCategory("T-shirt")).toBe("T-shirt");
    expect(pickCategory(" t shirt ")).toBe("T-shirt");
    expect(pickCategory("HOODIE")).toBe("Hoodie");
  });
  it("drops anything outside the list", () => {
    expect(pickCategory("Spaceship")).toBeNull();
    expect(pickCategory("")).toBeNull();
    expect(pickCategory(42)).toBeNull();
    expect(pickCategory(undefined)).toBeNull();
  });
  it("matches the app's picker list", () => {
    expect(PRODUCT_CATEGORIES).toContain("Other");
    expect(PRODUCT_CATEGORIES).toHaveLength(14);
  });
});
