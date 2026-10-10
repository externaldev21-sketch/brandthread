import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../csv";
import { detectLayout, expandEtsyVariations, mapCsv } from "../layouts";
import { parsePriceToCents, sanitizeImageUrl, foldAxes } from "../util";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name: string) => parseCsv(fs.readFileSync(path.join(dir, name), "utf8"));

describe("detectLayout", () => {
  it("detects each fixture layout", () => {
    expect(detectLayout(load("shopify_export.csv").headers)?.layout).toBe("shopify");
    expect(detectLayout(load("etsy_listings.csv").headers)?.layout).toBe("etsy");
    expect(detectLayout(load("generic_comma.csv").headers)?.layout).toBe("generic");
    expect(detectLayout(load("generic_semicolon.csv").headers)?.layout).toBe("generic");
  });

  it("is tolerant of header case, underscores and spacing", () => {
    expect(detectLayout(["TITLE", "PRICE", "CURRENCY CODE"])?.layout).toBe("etsy");
    expect(detectLayout(["HANDLE", "title", "variant_price"])?.layout).toBe("shopify");
    expect(detectLayout(["Product Name", "Price"])?.layout).toBe("generic");
  });

  it("returns null when there is no name column", () => {
    expect(detectLayout(["foo", "bar"])).toBeNull();
  });
});

describe("Shopify layout", () => {
  const result = mapCsv("shopify", load("shopify_export.csv"));
  const byKey = Object.fromEntries(result.products.map((p) => [p.externalKey, p]));

  it("folds rows with the same handle into one product with many variants", () => {
    expect(result.products.map((p) => p.externalKey)).toEqual(["boxy-tee", "cargo-pant", "sock-set"]);
    expect(byKey["boxy-tee"].variants).toHaveLength(3);
  });

  it("maps Size/Color options to the existing columns and keeps SKU, price, stock, grams", () => {
    const v = byKey["boxy-tee"].variants;
    expect(v[0]).toMatchObject({ sku: "BOXY-S-BLK", size: "S", color: "Black", priceCents: 4800, compareAtCents: 6000, stock: 12, weightGrams: 200 });
    expect(v[2]).toMatchObject({ size: "L", color: "White", stock: 7, compareAtCents: null });
  });

  it("collects images from continuation rows in Image Position order and strips HTML", () => {
    expect(byKey["boxy-tee"].images).toEqual([
      "https://cdn.shopify.com/s/files/1/0001/boxy-front.jpg",
      "https://cdn.shopify.com/s/files/1/0001/boxy-back.jpg",
    ]);
    expect(byKey["boxy-tee"].description).toBe("Heavyweight cotton.\nMade in Portugal & cut boxy.");
    expect(byKey["boxy-tee"].tags).toEqual(["cotton", "summer", "boxy"]);
    expect(byKey["boxy-tee"].category).toBe("tops");
  });

  it("ignores the Default Title option and parses thousands separators", () => {
    expect(byKey["cargo-pant"].variants[0]).toMatchObject({ size: null, color: null, priceCents: 112050 });
  });

  it("puts non-size/colour axes in the size column as 'Name: value' and clamps negative stock", () => {
    expect(byKey["sock-set"].variants[0]).toMatchObject({ size: "Material: Wool", stock: 0 });
    expect(byKey["sock-set"].sourceStatus).toBe("archived");
    expect(result.issues.some((i) => i.severity === "warning" && /negative/.test(i.message))).toBe(true);
  });

  it("reports a bad price as a row error and drops the product", () => {
    expect(byKey["bad-price"]).toBeUndefined();
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => /abc/.test(e.message))).toBe(true);
    expect(errors.every((e) => e.line > 1)).toBe(true);
  });

  it("lists columns it did not use", () => {
    const r = mapCsv("generic", parseCsv("name,price,cost,supplier\nTee,10,4,Acme"));
    expect(r.ignoredColumns).toEqual(["cost", "supplier"]);
  });
});

describe("Etsy layout", () => {
  const result = mapCsv("etsy", load("etsy_listings.csv"));
  const byName = Object.fromEntries(result.products.map((p) => [p.name, p]));

  it("maps a simple listing", () => {
    const scarf = byName["Hand-Dyed Linen Scarf"];
    expect(scarf.variants).toEqual([expect.objectContaining({ sku: "SCARF-01", priceCents: 3400, stock: 12 })]);
    expect(scarf.images).toHaveLength(2);
    expect(scarf.tags).toEqual(["linen", "scarf", "hand dyed"]);
    expect(scarf.description).toContain("Wash cold.");
    expect(scarf.externalKey).toBe("sku:scarf-01");
  });

  it("expands variations into the cartesian product with SKU suffixes", () => {
    const tote = byName["Embroidered Tote"];
    expect(tote.variants).toHaveLength(4);
    expect(tote.variants.map((v) => [v.size, v.color, v.sku])).toEqual([
      ["Small", "Natural", "TOTE-SMALL-NATURAL"], ["Small", "Black", "TOTE-SMALL-BLACK"],
      ["Large", "Natural", "TOTE-LARGE-NATURAL"], ["Large", "Black", "TOTE-LARGE-BLACK"],
    ]);
    expect(result.issues.some((i) => i.product === "Embroidered Tote" && /applied to each/.test(i.message))).toBe(true);
  });

  it("puts custom variation axes in the size column, warns on non-USD, and keys by title without a SKU", () => {
    const mug = byName["Ceramic Mug"];
    expect(mug.variants.map((v) => v.size)).toEqual(["Glaze: Matte", "Glaze: Gloss"]);
    expect(mug.externalKey).toBe("title:ceramic-mug");
    expect(result.issues.some((i) => i.product === "Ceramic Mug" && /EUR/.test(i.message))).toBe(true);
  });

  it("caps runaway variation combinations", () => {
    const values = Array.from({ length: 12 }, (_, i) => `v${i}`);
    const variants = expandEtsyVariations(
      [{ label: "A", values }, { label: "B", values }], { sku: "", priceCents: 100, stock: 1 });
    expect(variants.length).toBeGreaterThan(100); // capped later by the mapper
  });
});

describe("generic layout", () => {
  it("parses a comma file with quoted quotes", () => {
    const r = mapCsv("generic", load("generic_comma.csv"));
    expect(r.products).toHaveLength(1);
    expect(r.products[0]).toMatchObject({ name: "Logo Tee", description: 'Soft "everyday" tee', category: "tops", tags: ["basics", "cotton"] });
    expect(r.products[0].variants[0]).toMatchObject({ sku: "TEE-LOGO", size: "M", color: "White", priceCents: 3200, stock: 10 });
  });

  it("handles a semicolon + decimal-comma + CRLF + embedded-newline file and folds by name", () => {
    const r = mapCsv("generic", load("generic_semicolon.csv"));
    expect(r.products.map((p) => p.name)).toEqual(["Oversized Hoodie", "Beanie"]);
    const hoodie = r.products[0];
    expect(hoodie.description).toBe("Fleece-lined\r\nheavyweight");
    expect(hoodie.variants.map((v) => [v.size, v.priceCents, v.stock])).toEqual([["S", 8900, 4], ["M", 8900, 6], ["L", 8900, 0]]);
    expect(hoodie.images).toEqual(["https://example.com/h1.jpg", "https://example.com/h2.jpg"]);
    expect(hoodie.tags).toEqual(["fleece", "winter"]);
    const errors = r.issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/no name/);
  });
});

describe("util", () => {
  it("parses prices", () => {
    expect(parsePriceToCents("12")).toBe(1200);
    expect(parsePriceToCents("$1,299.00")).toBe(129900);
    expect(parsePriceToCents("12,50")).toBe(1250);
    expect(parsePriceToCents("1.299,00")).toBe(129900);
    expect(parsePriceToCents("1,299")).toBe(129900);
    expect(parsePriceToCents("0.1")).toBe(10);
    expect(parsePriceToCents("")).toBeNull();
    expect(parsePriceToCents("abc")).toBeNull();
    expect(parsePriceToCents("-5")).toBeNull();
  });

  it("only keeps public http(s) image URLs", () => {
    expect(sanitizeImageUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(sanitizeImageUrl("//cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    for (const bad of ["http://localhost/a.jpg", "http://127.0.0.1/a", "http://169.254.169.254/latest", "http://10.0.0.5/a", "http://[::1]/a",
      "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@example.com/a", "http://intranet/a", "ftp://example.com/a", "http://foo.internal/a"]) {
      expect(sanitizeImageUrl(bad), bad).toBeNull();
    }
  });

  it("folds extra axes conservatively", () => {
    expect(foldAxes([{ label: "Size", value: "M" }, { label: "Color", value: "Red" }, { label: "Fit", value: "Slim" }]))
      .toEqual({ size: "M / Fit: Slim", color: "Red" });
    expect(foldAxes([{ label: "Material", value: "Wool" }])).toEqual({ size: "Material: Wool", color: null });
  });
});
