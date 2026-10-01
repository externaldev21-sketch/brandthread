import { describe, expect, it } from "vitest";
import { MAX_PRODUCT_PAIRINGS, isAvailable, lowestPriceCents, parsePairingInput } from "./productPairings";
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
