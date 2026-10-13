import { describe, expect, it } from "vitest";
import { barcodeCandidates, normalizeScanCode, stockStatus } from "./inventoryLookup";
import { PLATFORM_LOW_STOCK_THRESHOLD, parseLowStockThreshold, resolveLowStockThreshold } from "./lowStockThreshold";
import { shouldAlertLowStock } from "./stockNotifications";
import { parseBarcode, validateBulkUpdates } from "./variantMatrix";
import { parseCsv } from "./productImport/csv";
import { importBarcode, mapCsv } from "./productImport/layouts";

describe("resolveLowStockThreshold", () => {
  it("uses the first level that is set: variant, product, store, then 5", () => {
    expect(resolveLowStockThreshold({ variant: 3, product: 8, store: 12 })).toBe(3);
    expect(resolveLowStockThreshold({ variant: null, product: 8, store: 12 })).toBe(8);
    expect(resolveLowStockThreshold({ product: null, store: 12 })).toBe(12);
    expect(resolveLowStockThreshold({})).toBe(5);
    expect(PLATFORM_LOW_STOCK_THRESHOLD).toBe(5);
  });

  it("treats 0 as a real level (alert only at sold out)", () => {
    expect(resolveLowStockThreshold({ variant: 0, store: 12 })).toBe(0);
    expect(resolveLowStockThreshold({ store: 0 })).toBe(0);
  });

  it("validates seller input", () => {
    expect(parseLowStockThreshold(0)).toBe(0);
    expect(parseLowStockThreshold(25)).toBe(25);
    for (const bad of [-1, 1.5, "5", null, undefined, Number.NaN, 1_000_001]) expect(parseLowStockThreshold(bad)).toBeNull();
  });
});

describe("low-stock alert crossing with a store level", () => {
  const level = resolveLowStockThreshold({ store: 8 });
  it("alerts when stock first drops to the store level, not above it or again inside the band", () => {
    expect(shouldAlertLowStock({ previousStock: 10, newStock: 9, lowStockThreshold: level })).toBe(false);
    expect(shouldAlertLowStock({ previousStock: 9, newStock: 8, lowStockThreshold: level })).toBe(true);
    expect(shouldAlertLowStock({ previousStock: 8, newStock: 6, lowStockThreshold: level })).toBe(false);
    expect(shouldAlertLowStock({ previousStock: 6, newStock: 0, lowStockThreshold: level })).toBe(true);
  });
  it("matches the scanner's stock status", () => {
    expect(stockStatus(9, level)).toBe("in_stock");
    expect(stockStatus(8, level)).toBe("low_stock");
    expect(stockStatus(0, level)).toBe("out_of_stock");
  });
});

describe("scan codes", () => {
  it("normalises what the camera or keyboard sends", () => {
    expect(normalizeScanCode("  036000291452 ")).toBe("036000291452");
    expect(normalizeScanCode("")).toBeNull();
    expect(normalizeScanCode("   ")).toBeNull();
    expect(normalizeScanCode(["a"])).toBeNull();
    expect(normalizeScanCode("x".repeat(65))).toBeNull();
    expect(normalizeScanCode("ab\ncd")).toBeNull();
  });

  it("tries the UPC-A and EAN-13 forms of the same code", () => {
    expect(barcodeCandidates("036000291452").sort()).toEqual(["0036000291452", "036000291452"]);
    expect(barcodeCandidates("0036000291452").sort()).toEqual(["0036000291452", "036000291452"]);
    expect(barcodeCandidates("4006381333931")).toEqual(["4006381333931"]);
    expect(barcodeCandidates("TEE-BLK-M")).toEqual(["TEE-BLK-M"]);
  });
});

describe("variant barcode field", () => {
  it("accepts printable codes, clears on empty, rejects spaces", () => {
    expect(parseBarcode(" 036000291452 ")).toEqual({ ok: true, value: "036000291452" });
    expect(parseBarcode("")).toEqual({ ok: true, value: null });
    expect(parseBarcode(null)).toEqual({ ok: true, value: null });
    expect(parseBarcode("has space")).toEqual({ ok: false });
    expect(parseBarcode(12345)).toEqual({ ok: false });
  });

  it("is part of the bulk variant save", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(validateBulkUpdates([{ variantId: id, barcode: "ABC-123" }])).toEqual({ ok: true, updates: [{ variantId: id, barcode: "ABC-123" }] });
    expect(validateBulkUpdates([{ variantId: id, barcode: "" }])).toEqual({ ok: true, updates: [{ variantId: id, barcode: null }] });
    expect(validateBulkUpdates([{ variantId: id, barcode: "a b" }]).ok).toBe(false);
  });
});

describe("CSV import keeps barcodes", () => {
  it("reads Shopify's Variant Barcode instead of dropping it", () => {
    const csv = parseCsv([
      "Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty,Variant Barcode",
      "cap,Classic cap,Color,Black,CAP-BLK,25.00,4,'036000291452",
      "cap,,,White,CAP-WHT,25.00,2,",
    ].join("\n"));
    const result = mapCsv("shopify", csv);
    expect(result.products[0].variants.map((v) => v.barcode)).toEqual(["036000291452", null]);
    expect(result.ignoredColumns).not.toContain("Variant Barcode");
  });

  it("reads the Brandthread template's barcode column", () => {
    const csv = parseCsv("name,price,sku,barcode,stock\nTote,30,TOTE-1,4006381333931,5\n");
    const result = mapCsv("generic", csv);
    expect(result.products[0].variants[0]).toMatchObject({ sku: "TOTE-1", barcode: "4006381333931", stock: 5 });
    expect(result.ignoredColumns).toEqual([]);
  });

  it("drops values that can't be a barcode", () => {
    expect(importBarcode("  ")).toBeNull();
    expect(importBarcode("not a code")).toBeNull();
    expect(importBarcode("'00123")).toBe("00123");
  });
});
