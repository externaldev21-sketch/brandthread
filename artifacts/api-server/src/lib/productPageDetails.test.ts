import { describe, expect, it } from "vitest";
import {
  inPriceBand, parseProductPageDetails, productPageDetailsOf, publicInBagCount,
} from "./productPageDetails";

const images = ["https://cdn.example.com/ember.jpg", "https://cdn.example.com/bone.jpg"];

describe("parseProductPageDetails", () => {
  it("returns only the keys that were sent", () => {
    const r = parseProductPageDetails({ fabric: "  100% cotton,   480 gsm " }, images);
    expect(r).toEqual({ ok: true, value: { fabric: "100% cotton, 480 gsm" } });
  });

  it("clears with null and turns blank text into null", () => {
    const r = parseProductPageDetails({ care: null, origin: "   ", modelHeightCm: null }, images);
    expect(r).toEqual({ ok: true, value: { care: null, origin: null, modelHeightCm: null } });
  });

  it("accepts a model line", () => {
    const r = parseProductPageDetails({ modelHeightCm: 185, modelSizeWorn: "L" }, images);
    expect(r).toEqual({ ok: true, value: { modelHeightCm: 185, modelSizeWorn: "L" } });
  });

  it("rejects heights out of range or not whole centimetres", () => {
    for (const modelHeightCm of [119, 231, 180.5, "185"]) {
      expect(parseProductPageDetails({ modelHeightCm }, images).ok).toBe(false);
    }
  });

  it("rejects text that is too long or not text", () => {
    expect(parseProductPageDetails({ fabric: "x".repeat(301) }, images).ok).toBe(false);
    expect(parseProductPageDetails({ modelSizeWorn: "x".repeat(13) }, images).ok).toBe(false);
    expect(parseProductPageDetails({ care: 4 }, images).ok).toBe(false);
  });

  it("rejects bodies that are not objects", () => {
    for (const body of [null, "x", [], 1]) expect(parseProductPageDetails(body, images).ok).toBe(false);
  });

  it("keeps colour photos that are the product's own photos", () => {
    const r = parseProductPageDetails({ colorImages: { " Ember ": images[0], Bone: images[1], Graphite: null, Moss: "" } }, images);
    expect(r).toEqual({ ok: true, value: { colorImages: { Ember: images[0], Bone: images[1] } } });
  });

  it("rejects a colour photo from outside the product's gallery", () => {
    const r = parseProductPageDetails({ colorImages: { Ember: "https://evil.example.com/x.jpg" } }, images);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Ember");
  });

  it("rejects bad colour names and shapes", () => {
    expect(parseProductPageDetails({ colorImages: { "": images[0] } }, images).ok).toBe(false);
    expect(parseProductPageDetails({ colorImages: { ["x".repeat(41)]: images[0] } }, images).ok).toBe(false);
    expect(parseProductPageDetails({ colorImages: [images[0]] }, images).ok).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`c${i}`, images[0]]));
    expect(parseProductPageDetails({ colorImages: many }, images).ok).toBe(false);
  });

  it("null colour photos clears them all", () => {
    expect(parseProductPageDetails({ colorImages: null }, images)).toEqual({ ok: true, value: { colorImages: {} } });
  });
});

describe("productPageDetailsOf", () => {
  it("fills missing columns with empty values", () => {
    expect(productPageDetailsOf(null)).toEqual({
      modelHeightCm: null, modelSizeWorn: null, fabric: null, care: null, origin: null, colorImages: {},
    });
  });
  it("drops non-string colour photo values", () => {
    expect(productPageDetailsOf({ colorImages: { A: "u", B: 3 as unknown as string } }).colorImages).toEqual({ A: "u" });
  });
});

describe("publicInBagCount", () => {
  it("hides counts below three", () => {
    expect(publicInBagCount(0)).toBeNull();
    expect(publicInBagCount(2)).toBeNull();
    expect(publicInBagCount(3)).toBe(3);
    expect(publicInBagCount(41)).toBe(41);
  });
});

describe("inPriceBand", () => {
  it("is within ±40% of the current price", () => {
    expect(inPriceBand(10000, 6000)).toBe(true);
    expect(inPriceBand(10000, 14000)).toBe(true);
    expect(inPriceBand(10000, 5999)).toBe(false);
    expect(inPriceBand(10000, 14001)).toBe(false);
  });
  it("is false without prices", () => {
    expect(inPriceBand(null, 5000)).toBe(false);
    expect(inPriceBand(5000, 0)).toBe(false);
  });
});
