import { describe, expect, it } from "vitest";
import {
  MAX_MATRIX_VARIANTS, baseSkuFromName, buildSku, buildStockInfo, columnAxisFor, comboKey, decideSoldOutAction,
  generateCombos, matrixSize, normalizeAxes, optionCode, uniqueSku, validateBulkUpdates, validateStockRules,
} from "./variantMatrix";

const axes = [
  { name: "Size", values: ["S", "M"] },
  { name: "Colour", values: ["Black", "Off White"] },
  { name: "Fit", values: ["Slim", "Regular", "Relaxed"] },
];

describe("normalizeAxes", () => {
  it("trims, dedupes values case-insensitively and keeps order", () => {
    const r = normalizeAxes([{ name: "  Size ", values: ["S", "s", " M ", ""] }, { name: "Fit", values: ["Slim"] }]);
    expect(r).toEqual({ ok: true, axes: [{ name: "Size", values: ["S", "M"] }, { name: "Fit", values: ["Slim"] }] });
  });
  it("treats Colour and Color as the same axis", () => {
    expect(normalizeAxes([{ name: "Color", values: ["a"] }, { name: "Colour", values: ["b"] }]).ok).toBe(false);
  });
  it("rejects empty names, empty value lists and too many axes", () => {
    expect(normalizeAxes([{ name: "", values: ["a"] }]).ok).toBe(false);
    expect(normalizeAxes([{ name: "Size", values: [] }]).ok).toBe(false);
    expect(normalizeAxes(Array.from({ length: 6 }, (_, i) => ({ name: `A${i}`, values: ["x"] }))).ok).toBe(false);
    expect(normalizeAxes("nope").ok).toBe(false);
  });
});

describe("generateCombos", () => {
  it("builds size x colour x fit and routes size/colour to their columns", () => {
    const combos = generateCombos(axes);
    expect(combos).toHaveLength(12);
    expect(matrixSize(axes)).toBe(12);
    expect(combos[0]).toMatchObject({ size: "S", color: "Black", options: { Fit: "Slim" } });
    expect(combos[11]).toMatchObject({ size: "M", color: "Off White", options: { Fit: "Relaxed" } });
    expect(new Set(combos.map((c) => c.values.join("|"))).size).toBe(12);
  });
  it("returns nothing for no axes and flags matrices over the cap", () => {
    expect(generateCombos([])).toEqual([]);
    const big = [{ name: "A", values: Array.from({ length: 11 }, (_, i) => `a${i}`) }, { name: "B", values: Array.from({ length: 10 }, (_, i) => `b${i}`) }];
    expect(matrixSize(big)).toBeGreaterThan(MAX_MATRIX_VARIANTS);
  });
  it("comboKey is case/space insensitive", () => {
    const one = comboKey(axes, (n) => ({ Size: "S", Colour: " black", Fit: "SLIM" } as Record<string, string>)[n]);
    const two = comboKey(axes, (n) => ({ Size: "s", Colour: "Black", Fit: "Slim" } as Record<string, string>)[n]);
    expect(one).toBe(two);
  });
  it("columnAxisFor maps size/colour only", () => {
    expect(columnAxisFor("Size")).toBe("size");
    expect(columnAxisFor("colour")).toBe("color");
    expect(columnAxisFor("Fit")).toBeNull();
  });
});

describe("SKU building", () => {
  it("makes short option codes", () => {
    expect(optionCode("XL")).toBe("XL");
    expect(optionCode("Black")).toBe("BLC");
    expect(optionCode("Off White")).toBe("OW");
    expect(optionCode("!!!")).toBe("X");
  });
  it("derives a base from the product name", () => {
    expect(baseSkuFromName("Oversized Boxy Tee")).toBe("OVEBOXTE");
    expect(baseSkuFromName("Hoodie")).toBe("HOODIE");
    expect(baseSkuFromName("???")).toBe("SKU");
  });
  it("joins base and option codes", () => {
    expect(buildSku("tee", generateCombos(axes)[0])).toBe("TEE-S-BLC-SLM");
  });
  it("uniqueSku avoids taken values and records the pick", () => {
    const taken = new Set(["tee-s", "tee-s-2"]);
    expect(uniqueSku("TEE-S", taken)).toBe("TEE-S-3");
    expect(uniqueSku("TEE-S", taken)).toBe("TEE-S-4");
    expect(uniqueSku("TEE-M", taken)).toBe("TEE-M");
  });
});

const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";

describe("validateBulkUpdates", () => {
  it("accepts a valid batch", () => {
    const r = validateBulkUpdates([{ variantId: id1, priceCents: 2500, stock: 4, sku: "A-1", lowStockThreshold: 2 }, { variantId: id2, stock: 0 }]);
    expect(r.ok).toBe(true);
  });
  it("rejects bad numbers, bad SKUs, duplicates and empties", () => {
    expect(validateBulkUpdates([]).ok).toBe(false);
    expect(validateBulkUpdates([{ variantId: "x" }]).ok).toBe(false);
    expect(validateBulkUpdates([{ variantId: id1, priceCents: 0 }]).ok).toBe(false);
    expect(validateBulkUpdates([{ variantId: id1, priceCents: 12.5 }]).ok).toBe(false);
    expect(validateBulkUpdates([{ variantId: id1, stock: -1 }]).ok).toBe(false);
    expect(validateBulkUpdates([{ variantId: id1, lowStockThreshold: 1.5 }]).ok).toBe(false);
    expect(validateBulkUpdates([{ variantId: id1, sku: "bad sku!" }]).ok).toBe(false);
    expect(validateBulkUpdates([{ variantId: id1 }, { variantId: id1 }]).ok).toBe(false);
    expect(validateBulkUpdates([{ variantId: id1, sku: "A" }, { variantId: id2, sku: "a" }]).ok).toBe(false);
    expect(validateBulkUpdates(Array.from({ length: 201 }, () => ({ variantId: id1 }))).ok).toBe(false);
  });
});

describe("validateStockRules", () => {
  it("defaults to show with nothing enabled", () => {
    const r = validateStockRules({});
    expect(r).toMatchObject({ ok: true, rules: { soldOutBehavior: "show", limitedQuantityEnabled: false, showRemainingCounter: false } });
  });
  it("requires an edition size for limited quantity and validates behaviour", () => {
    expect(validateStockRules({ limitedQuantityEnabled: true }).ok).toBe(false);
    expect(validateStockRules({ soldOutBehavior: "delete" }).ok).toBe(false);
    expect(validateStockRules({ lowStockThresholdDefault: -2 }).ok).toBe(false);
    expect(validateStockRules({ limitedQuantityEnabled: true, limitedQuantityTotal: 50, showRemainingCounter: true })).toMatchObject({
      ok: true, rules: { limitedQuantityTotal: 50, counterThreshold: 5 },
    });
  });
});

describe("decideSoldOutAction", () => {
  const base = { totalStock: 0, variantCount: 3, behavior: "hide" as const, status: "active", isPreOrder: false, inDrop: false, autoHidden: false };
  it("hides / archives / leaves listed", () => {
    expect(decideSoldOutAction(base)).toBe("hide");
    expect(decideSoldOutAction({ ...base, behavior: "archive" })).toBe("archive");
    expect(decideSoldOutAction({ ...base, behavior: "show" })).toBe("none");
  });
  it("restores only what it hid", () => {
    expect(decideSoldOutAction({ ...base, totalStock: 5, status: "draft", autoHidden: true })).toBe("restore");
    expect(decideSoldOutAction({ ...base, totalStock: 5, status: "draft", autoHidden: false })).toBe("none");
    expect(decideSoldOutAction({ ...base, behavior: "show", status: "draft", autoHidden: true })).toBe("restore");
  });
  it("exempts pre-orders, drops, empty products and non-active ones", () => {
    expect(decideSoldOutAction({ ...base, isPreOrder: true })).toBe("none");
    expect(decideSoldOutAction({ ...base, inDrop: true })).toBe("none");
    expect(decideSoldOutAction({ ...base, variantCount: 0 })).toBe("none");
    expect(decideSoldOutAction({ ...base, status: "draft" })).toBe("none");
  });
});

describe("buildStockInfo", () => {
  const off = { limitedQuantityEnabled: false, limitedQuantityTotal: null, showRemainingCounter: false, counterThreshold: null };
  it("never reveals remaining unless the seller opted in", () => {
    expect(buildStockInfo({ totalStock: 3, variantCount: 2, rules: off })).toEqual({ soldOut: false, limited: false, editionSize: null, remaining: null });
    expect(buildStockInfo({ totalStock: 3, variantCount: 2, rules: null }).remaining).toBeNull();
  });
  it("shows the counter only at or under the threshold", () => {
    const rules = { ...off, showRemainingCounter: true, counterThreshold: 5 };
    expect(buildStockInfo({ totalStock: 5, variantCount: 2, rules }).remaining).toBe(5);
    expect(buildStockInfo({ totalStock: 6, variantCount: 2, rules }).remaining).toBeNull();
  });
  it("limited edition shows edition size and remaining", () => {
    const rules = { ...off, limitedQuantityEnabled: true, limitedQuantityTotal: 50 };
    expect(buildStockInfo({ totalStock: 12, variantCount: 2, rules })).toEqual({ soldOut: false, limited: true, editionSize: 50, remaining: 12 });
  });
  it("sold out hides remaining", () => {
    const rules = { ...off, limitedQuantityEnabled: true, limitedQuantityTotal: 50 };
    expect(buildStockInfo({ totalStock: 0, variantCount: 2, rules })).toMatchObject({ soldOut: true, remaining: null });
    expect(buildStockInfo({ totalStock: 0, variantCount: 0, rules }).soldOut).toBe(false);
  });
});
