import { describe, expect, it } from "vitest";
import {
  absoluteImages, centsToDecimalString, clipText, parseNonNegativeInt, publicBrandName,
  publishedAtFor, schemaAvailability, summarizePrices,
} from "../seoPublic";

describe("seoPublic helpers", () => {
  it("keeps only absolute http(s) images, deduped and capped", () => {
    expect(absoluteImages(["/objects/x.jpg", "https://a.test/1.jpg", "https://a.test/1.jpg", "javascript:alert(1)", 4, "http://b.test/2.png"]))
      .toEqual(["https://a.test/1.jpg", "http://b.test/2.png"]);
    expect(absoluteImages(null)).toEqual([]);
    expect(absoluteImages(["https://a/1", "https://a/2"], 1)).toEqual(["https://a/1"]);
  });

  it("picks the published store name, then brand name, then display name", () => {
    expect(publicBrandName({ storeTitle: "Store", storePublished: true, brandName: "Brand", displayName: "Me" })).toBe("Store");
    expect(publicBrandName({ storeTitle: "Draft", storePublished: false, brandName: "Brand", displayName: "Me" })).toBe("Brand");
    expect(publicBrandName({ storeTitle: " ", storePublished: true, brandName: "", displayName: "Me" })).toBe("Me");
    expect(publicBrandName({})).toBeNull();
  });

  it("maps availability from real stock, pre-order, launch and vacation state", () => {
    const base = { live: true, vacation: false, isPreOrder: false, totalStock: 2 };
    expect(schemaAvailability(base)).toBe("InStock");
    expect(schemaAvailability({ ...base, totalStock: 0 })).toBe("OutOfStock");
    expect(schemaAvailability({ ...base, totalStock: 0, isPreOrder: true })).toBe("PreOrder");
    expect(schemaAvailability({ ...base, live: false })).toBe("OutOfStock");
    expect(schemaAvailability({ ...base, vacation: true, isPreOrder: true })).toBe("OutOfStock");
  });

  it("formats integer cents without float math", () => {
    expect(centsToDecimalString(4500)).toBe("45.00");
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(123456789)).toBe("1234567.89");
    expect(centsToDecimalString(-3)).toBe("0.00");
  });

  it("summarizes a price range and only keeps a real compare-at", () => {
    expect(summarizePrices([])).toBeNull();
    expect(summarizePrices([{ priceCents: 5000, compareAtPriceCents: 4000 }, { priceCents: 7000 }]))
      .toEqual({ lowCents: 5000, highCents: 7000, compareAtCents: null, offerCount: 2 });
    expect(summarizePrices([{ priceCents: 5000, compareAtPriceCents: 6500 }]))
      .toEqual({ lowCents: 5000, highCents: 5000, compareAtCents: 6500, offerCount: 1 });
  });

  it("uses the launch moment as the publish time for scheduled products", () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const launch = new Date("2026-02-01T00:00:00Z");
    const launched = new Date("2026-02-01T00:05:00Z");
    expect(publishedAtFor(created, null)).toBe(created);
    expect(publishedAtFor(created, { launchAt: launch, launchedAt: null })).toBe(launch);
    expect(publishedAtFor(created, { launchAt: launch, launchedAt: launched })).toBe(launched);
  });

  it("clips text and validates paging numbers", () => {
    expect(clipText("<p>a   b</p>", 10)).toBe("a b");
    expect(clipText("abcdefghij", 5)).toBe("abcd…");
    expect(clipText("  ", 5)).toBeNull();
    expect(parseNonNegativeInt(undefined, 48, 48)).toBe(48);
    expect(parseNonNegativeInt("100", 48, 48)).toBe(48);
    expect(parseNonNegativeInt("-1", 48, 48)).toBeNull();
    expect(parseNonNegativeInt(["1"], 48, 48)).toBeNull();
  });
});
