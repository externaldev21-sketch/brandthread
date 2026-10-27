import { describe, expect, it } from "vitest";
import { resolveHomeLocation } from "./seller-live-map";

describe("resolveHomeLocation (where the globe's order arcs land)", () => {
  it("reads 'City, ST' as a US city for a US store", () => {
    expect(resolveHomeLocation("Austin, TX", "US")).toMatchObject({ key: "US:TX:austin", city: "Austin" });
    expect(resolveHomeLocation("Brooklyn, New York", "US")).toMatchObject({ city: "Brooklyn", region: "NY" });
  });

  it("reads 'City, Country' as a country", () => {
    expect(resolveHomeLocation("Paris, France", "US")).toMatchObject({ city: "Paris", country: "FR" });
    expect(resolveHomeLocation("Toronto, Canada", "CA")).toMatchObject({ city: "Toronto", country: "CA" });
    expect(resolveHomeLocation("Berlin", "DE")).toMatchObject({ city: "Berlin", country: "DE" });
  });

  it("is null when the location can't be placed at city level", () => {
    expect(resolveHomeLocation(null, "US")).toBeNull();
    expect(resolveHomeLocation("", "US")).toBeNull();
    expect(resolveHomeLocation("Worldwide", "US")).toBeNull();
    expect(resolveHomeLocation("Texas", "US")).toBeNull();
  });
});
