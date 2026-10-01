import { describe, expect, it } from "vitest";
import { normalizePlaceName, parsePlaceInput, placeDedupeKey } from "./places";

describe("normalizePlaceName", () => {
  it("lowercases, NFKC-normalises and collapses whitespace/punctuation", () => {
    expect(normalizePlaceName("  Café   de  Flore!! ")).toBe("café de flore");
    expect(normalizePlaceName("ＴＯＫＹＯ Station")).toBe("tokyo station");
    expect(normalizePlaceName("St. Mark's – Square")).toBe("st. mark's square");
  });
  it("returns empty for punctuation-only names", () => {
    expect(normalizePlaceName("!!!")).toBe("");
  });
});

describe("placeDedupeKey", () => {
  it("merges nearby coordinates (rounded to 2 decimals) and ignores casing", () => {
    const a = placeDedupeKey({ normalizedName: normalizePlaceName("Union Square"), lat: 40.7359, lng: -73.9911, region: null, country: null });
    const b = placeDedupeKey({ normalizedName: normalizePlaceName("UNION  square"), lat: 40.7361, lng: -73.9908, region: "NY", country: "US" });
    expect(a).toBe(b);
  });
  it("separates the same name in different cities", () => {
    const sf = placeDedupeKey({ normalizedName: "union square", lat: 37.788, lng: -122.407, region: null, country: null });
    const ny = placeDedupeKey({ normalizedName: "union square", lat: 40.736, lng: -73.991, region: null, country: null });
    expect(sf).not.toBe(ny);
  });
  it("falls back to region and country without coordinates", () => {
    expect(placeDedupeKey({ normalizedName: "x", lat: null, lng: null, region: "CA", country: "United States" })).toBe("x|ca|united states");
  });
});

describe("parsePlaceInput", () => {
  it("accepts a minimal place and a full one", () => {
    expect(parsePlaceInput({ name: "  Blue   Bottle " })).toMatchObject({ ok: true, value: { name: "Blue Bottle", lat: null, lng: null } });
    expect(parsePlaceInput({ name: "Pier 39", lat: 37.8087, lng: -122.4098, city: "San Francisco" }))
      .toMatchObject({ ok: true, value: { lat: 37.8087, lng: -122.4098, city: "San Francisco" } });
  });
  it("rejects bad shapes", () => {
    expect(parsePlaceInput(null)).toMatchObject({ ok: false, status: 400 });
    expect(parsePlaceInput({})).toMatchObject({ ok: false, status: 400 });
    expect(parsePlaceInput({ name: "" })).toMatchObject({ ok: false, status: 400 });
    expect(parsePlaceInput({ name: "a".repeat(101) })).toMatchObject({ ok: false, status: 400 });
    expect(parsePlaceInput({ name: "!!!" })).toMatchObject({ ok: false, status: 400 });
    expect(parsePlaceInput({ name: "Park", lat: 10 })).toMatchObject({ ok: false, status: 400 });
    expect(parsePlaceInput({ name: "Park", lat: 91, lng: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(parsePlaceInput({ name: "Park", lat: "x", lng: 0 })).toMatchObject({ ok: false, status: 400 });
  });
  it("moderates the name", () => {
    expect(parsePlaceInput({ name: "kill yourself plaza" })).toMatchObject({ ok: false, status: 422, code: "CONTENT_REJECTED" });
  });
});
