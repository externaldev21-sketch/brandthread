import { describe, expect, it } from "vitest";
import { findRowStockCell, parseDefaultStock, resolveRowStock } from "../bulkRows";

describe("findRowStockCell", () => {
  it("accepts the common quantity header names, case-insensitively", () => {
    expect(findRowStockCell({ name: "Tee", stock: "4" })).toBe("4");
    expect(findRowStockCell({ name: "Tee", Quantity: 7 })).toBe(7);
    expect(findRowStockCell({ name: "Tee", QTY: "2" })).toBe("2");
    expect(findRowStockCell({ name: "Tee", Inventory: "9" })).toBe("9");
    expect(findRowStockCell({ name: "Tee", inventory_qty: "3" })).toBe("3");
    expect(findRowStockCell({ name: "Tee", "Variant Inventory Qty": "5" })).toBe("5");
  });

  it("ignores blank cells and rows without a quantity column", () => {
    expect(findRowStockCell({ name: "Tee", stock: "  " })).toBeUndefined();
    expect(findRowStockCell({ name: "Tee", price: "10" })).toBeUndefined();
    expect(findRowStockCell(null)).toBeUndefined();
  });

  it("prefers 'stock' when several aliases are present", () => {
    expect(findRowStockCell({ quantity: "1", stock: "8" })).toBe("8");
  });
});

describe("parseDefaultStock", () => {
  it("returns null when the seller gave no default", () => {
    expect(parseDefaultStock(undefined)).toBeNull();
    expect(parseDefaultStock("")).toBeNull();
    expect(parseDefaultStock(null)).toBeNull();
  });

  it("parses whole numbers and rejects junk", () => {
    expect(parseDefaultStock("12")).toBe(12);
    expect(parseDefaultStock(3)).toBe(3);
    expect(parseDefaultStock("abc")).toBeNull();
    expect(parseDefaultStock("-4")).toBeNull();
  });
});

describe("resolveRowStock", () => {
  it("uses the row's quantity first", () => {
    expect(resolveRowStock({ qty: "6" }, 10)).toBe(6);
  });

  it("falls back to the request default, then 0", () => {
    expect(resolveRowStock({ name: "Tee" }, 10)).toBe(10);
    expect(resolveRowStock({ name: "Tee" }, null)).toBe(0);
  });

  it("falls back when the row's quantity is not a number", () => {
    expect(resolveRowStock({ stock: "lots" }, 5)).toBe(5);
    expect(resolveRowStock({ stock: "-1" }, null)).toBe(0);
  });

  it("floors decimals and strips thousands separators", () => {
    expect(resolveRowStock({ stock: "2.9" }, null)).toBe(2);
    expect(resolveRowStock({ stock: "1,200" }, null)).toBe(1200);
  });

  it("keeps an explicit 0 in the row over the default", () => {
    expect(resolveRowStock({ stock: "0" }, 10)).toBe(0);
  });
});
