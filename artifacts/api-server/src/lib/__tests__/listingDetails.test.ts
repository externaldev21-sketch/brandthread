import { describe, expect, it } from "vitest";
import { parseListingDetails } from "../listingDetails";

describe("parseListingDetails", () => {
  it("keeps known fields, trims text and drops unknown keys", () => {
    const res = parseListingDetails({
      department: "Women", category: "Tops", subcategory: " T-shirts ", brand: "Carhartt",
      condition: "very_good", colors: [" Black ", "White"], material: "Cotton",
      parcelSize: "small", shippingPayer: "buyer", junk: "x",
    });
    expect(res).toEqual({ value: {
      department: "Women", category: "Tops", subcategory: "T-shirts", brand: "Carhartt",
      condition: "very_good", colors: ["Black", "White"], material: "Cotton",
      parcelSize: "small", shippingPayer: "buyer",
    } });
  });

  it("null clears and an empty object stores nothing", () => {
    expect(parseListingDetails(null)).toEqual({ value: null });
    expect(parseListingDetails({})).toEqual({ value: null });
  });

  it("rejects bad enums, too many colours and non-objects", () => {
    expect(parseListingDetails({ condition: "mint" })).toHaveProperty("error");
    expect(parseListingDetails({ parcelSize: "xl" })).toHaveProperty("error");
    expect(parseListingDetails({ shippingPayer: "nobody" })).toHaveProperty("error");
    expect(parseListingDetails({ colors: ["a", "b", "c"] })).toHaveProperty("error");
    expect(parseListingDetails({ brand: "x".repeat(81) })).toHaveProperty("error");
    expect(parseListingDetails("nope")).toHaveProperty("error");
    expect(parseListingDetails([])).toHaveProperty("error");
  });
});
