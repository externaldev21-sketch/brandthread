import { describe, expect, it } from "vitest";
import { normalizePlaceName, resolveCity } from "../gazetteer";

describe("live map gazetteer", () => {
  it("resolves a US city by (city, state, country)", () => {
    const p = resolveCity({ city: "Austin", region: "TX", country: "US" });
    expect(p).toMatchObject({ key: "US:TX:austin", city: "Austin", region: "TX", country: "US", precision: "city" });
    expect(p!.lat).toBeCloseTo(30.27, 1);
    expect(p!.lng).toBeCloseTo(-97.74, 1);
  });

  it("uses the state to disambiguate same-named US cities", () => {
    expect(resolveCity({ city: "Paris", region: "TN", country: "US" })?.key).toBe("US:TN:paris");
    expect(resolveCity({ city: "Paris", region: "Texas", country: "United States" })?.key).toBe("US:TX:paris");
  });

  it("matches loosely on case, accents and St./Saint", () => {
    expect(resolveCity({ city: "  new YORK ", region: "ny", country: "usa" })).toMatchObject({ city: "New York City", region: "NY", precision: "city" });
    expect(resolveCity({ city: "Saint Louis", region: "MO", country: "US" })?.precision).toBe("city");
    expect(resolveCity({ city: "St. Louis", region: "MO", country: "US" })?.key)
      .toBe(resolveCity({ city: "Saint Louis", region: "MO", country: "US" })?.key);
    expect(resolveCity({ city: "Zurich", region: "", country: "CH" })?.precision).toBe("city");
    expect(normalizePlaceName("Zürich")).toBe("zurich");
  });

  it("resolves non-US cities by country", () => {
    const berlin = resolveCity({ city: "Berlin", region: "", country: "DE" });
    expect(berlin).toMatchObject({ city: "Berlin", country: "DE", precision: "city" });
    expect(resolveCity({ city: "London", region: "England", country: "United Kingdom" })?.country).toBe("GB");
  });

  it("falls back to the US state centroid for an unknown city", () => {
    const p = resolveCity({ city: "Nowhereville Junction", region: "TX", country: "US" });
    expect(p).toMatchObject({ key: "US:TX:", city: "", region: "TX", country: "US", precision: "region" });
  });

  it("does not guess a US city whose state disagrees; falls back to that state", () => {
    // There is no Austin in Hawaii in the gazetteer.
    expect(resolveCity({ city: "Austin", region: "HI", country: "US" })?.key).toBe("US:HI:");
  });

  it("falls back to the country centroid when the city and region are unknown", () => {
    const p = resolveCity({ city: "Atlantis", region: "Nowhere", country: "FR" });
    expect(p).toMatchObject({ key: "FR::", city: "", region: "", country: "FR", precision: "country" });
  });

  it("drops what it can't place", () => {
    expect(resolveCity({ city: "Atlantis", region: "", country: "Narnia" })).toBeNull();
    expect(resolveCity({ city: "", region: "", country: "" })).toBeNull();
    expect(resolveCity({ city: null, region: null, country: null })).toBeNull();
  });
});
