import { describe, expect, it } from "vitest";
import {
  MAX_PRODUCT_PAIRINGS, complementaryGroups, isAvailable, lowestPriceCents, outfitGroup, parsePairingInput, selectAutoPairings,
} from "./productPairings";
import { isSupportedProductVideo, productVideoDurationError } from "./productVideo";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("parsePairingInput", () => {
  it("accepts an ordered unique list", () => {
    expect(parsePairingInput(A, [C, B])).toEqual({ ok: true, ids: [C, B] });
    expect(parsePairingInput(A, [])).toEqual({ ok: true, ids: [] });
  });
  it("rejects self, duplicates, non-arrays and the cap", () => {
    expect(parsePairingInput(A, [A])).toMatchObject({ ok: false, code: "self_pairing" });
    expect(parsePairingInput(A, [B, B])).toMatchObject({ ok: false, code: "duplicate_pairing" });
    expect(parsePairingInput(A, "x")).toMatchObject({ ok: false, code: "invalid_body" });
    const many = Array.from({ length: MAX_PRODUCT_PAIRINGS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(parsePairingInput(A, many)).toMatchObject({ ok: false, code: "pairing_cap" });
  });
});

describe("price and availability", () => {
  it("uses the lowest variant price", () => {
    expect(lowestPriceCents([{ priceCents: 5000 }, { priceCents: 3500 }])).toBe(3500);
    expect(lowestPriceCents([])).toBe(0);
  });
  it("is available with stock or as a pre-order", () => {
    expect(isAvailable([{ stock: 0 }], false)).toBe(false);
    expect(isAvailable([{ stock: 2 }], false)).toBe(true);
    expect(isAvailable([{ stock: 0 }], true)).toBe(true);
  });
});

describe("product video rules", () => {
  it("sniffs container signatures", () => {
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(8)]);
    expect(isSupportedProductVideo("video/mp4", mp4)).toBe(true);
    expect(isSupportedProductVideo("image/png", mp4)).toBe(false);
    expect(isSupportedProductVideo("video/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]))).toBe(true);
    expect(isSupportedProductVideo("video/mp4", Buffer.from("plain text here!!"))).toBe(false);
  });
  it("limits duration to 60s", () => {
    expect(productVideoDurationError(60)).toBeNull();
    expect(productVideoDurationError(60.2)).toBeNull();
    expect(productVideoDurationError(61)).toMatch(/60 seconds/);
    expect(productVideoDurationError(0)).toMatch(/Could not read/);
  });
});

describe("selectAutoPairings (automatic Complete the fit)", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 0, n));
  const c = (id: string, slug: string | null, day: number, available = true) => ({ id, slug, available, createdAt: at(day) });

  it("maps taxonomy slugs to outfit slots and complements", () => {
    expect(outfitGroup("tees")).toBe("top");
    expect(outfitGroup("denim")).toBe("bottom");
    expect(outfitGroup(null)).toBeNull();
    expect(complementaryGroups("top")).toEqual(["bottom", "outerwear", "footwear", "accessory"]);
    expect(complementaryGroups(null)).toEqual([]);
  });

  it("for a top: bottoms, outerwear, shoes and accessories, interleaved, newest first", () => {
    const picked = selectAutoPairings({ id: "cur", slug: "tees" }, [
      c("jeans-old", "denim", 1),
      c("jeans-new", "denim", 5),
      c("hoodie", "hoodies", 9), // same slot as a tee → excluded
      c("jacket", "jackets", 2),
      c("boot", "footwear", 3),
      c("cap", "accessories", 4),
      c("pants", "pants", 6),
    ], { limit: 8 });
    expect(picked.map((p) => p.id)).toEqual(["pants", "jacket", "boot", "cap", "jeans-new", "jeans-old"]);
  });

  it("excludes the product itself, curated ids, sold-out and unclassified items", () => {
    const picked = selectAutoPairings({ id: "cur", slug: "tees" }, [
      c("cur", "denim", 9),
      c("curated", "denim", 8),
      c("soldout", "footwear", 7, false),
      c("mystery", null, 6),
      c("ok", "accessories", 5),
    ], { excludeIds: ["curated"], limit: 8 });
    expect(picked.map((p) => p.id)).toEqual(["ok"]);
  });

  it("caps at the limit and returns nothing for an unclassifiable product", () => {
    const many = Array.from({ length: 12 }, (_, i) => c(`p${i}`, "pants", i + 1));
    expect(selectAutoPairings({ id: "cur", slug: "tees" }, many, { limit: 8 })).toHaveLength(8);
    expect(selectAutoPairings({ id: "cur", slug: "tees" }, many, { limit: 0 })).toEqual([]);
    expect(selectAutoPairings({ id: "cur", slug: null }, many, { limit: 8 })).toEqual([]);
  });
});
