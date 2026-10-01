import { describe, expect, it } from "vitest";
import {
  SizeChartInputError,
  buildSizeChart,
  sizeChartInputSchema,
  storedSizeChartSchema,
  toStoredSizeChart,
} from "../sizeChart";

const parse = (v: unknown) => sizeChartInputSchema.parse(v);

describe("buildSizeChart grading", () => {
  it("grades every size from the base with the per-step rule", () => {
    const r = buildSizeChart(parse({
      garmentType: "tee", unit: "cm", baseSize: "M",
      base: { chest: 100, length: 70 },
      grading: { chest: 4, length: 1.5 },
    }));
    expect(r.columns).toEqual(["chest", "length"]);
    expect(r.rows.map((x) => [x.size, x.chest, x.length])).toEqual([
      ["XS", 92, 67],
      ["S", 96, 68.5],
      ["M", 100, 70],
      ["L", 104, 71.5],
      ["XL", 108, 73],
      ["XXL", 112, 74.5],
    ]);
  });

  it("supports a custom size list and base that is not M", () => {
    const r = buildSizeChart(parse({
      garmentType: "pants", unit: "in", sizes: ["28", "30", "32"], baseSize: "30",
      base: { waist: 30 }, grading: { waist: 2 },
    }));
    expect(r.rows.map((x) => x.waist)).toEqual([28, 30, 32]);
  });

  it("rounds to the nearest half unit", () => {
    const r = buildSizeChart(parse({
      garmentType: "tee", unit: "cm", sizes: ["S", "M"], baseSize: "S",
      base: { chest: 50 }, grading: { chest: 2.3 },
    }));
    expect(r.rows[1]!.chest).toBe(52.5);
  });

  it("rejects out of range, unknown and inconsistent input", () => {
    const bad = (v: unknown) => () => buildSizeChart(parse(v));
    expect(bad({ garmentType: "tee", unit: "cm", base: { chest: 4 }, grading: { chest: 4 } })).toThrow(SizeChartInputError);
    expect(bad({ garmentType: "tee", unit: "cm", base: { chest: 100, foo: 3 }, grading: {} })).toThrow(/unknown/);
    expect(bad({ garmentType: "tee", unit: "cm", base: { chest: 100 }, grading: { waist: 2 } })).toThrow(/no base/);
    expect(bad({ garmentType: "tee", unit: "cm", base: { chest: 100 }, grading: { chest: 40 } })).toThrow(SizeChartInputError);
    expect(bad({ garmentType: "tee", unit: "cm", baseSize: "Z", base: { chest: 100 }, grading: { chest: 4 } })).toThrow(/not in the size list/);
    expect(bad({ garmentType: "tee", unit: "cm", base: { chest: 100 } })).toThrow(SizeChartInputError);
    expect(bad({ garmentType: "tee", unit: "cm", base: { chest: 240 }, grading: { chest: 10 } })).toThrow(/outside/);
  });

  it("schema refuses NaN, strings and extra keys", () => {
    expect(() => parse({ garmentType: "tee", unit: "cm", base: { chest: "100" }, grading: {} })).toThrow();
    expect(() => parse({ garmentType: "tee", unit: "cm", base: { chest: NaN }, grading: {} })).toThrow();
    expect(() => parse({ garmentType: "tee", unit: "cm", extra: 1 })).toThrow();
    expect(() => parse({ garmentType: "cape", unit: "cm" })).toThrow();
  });
});

describe("explicit rows", () => {
  it("passes validated rows through unchanged", () => {
    const r = buildSizeChart(parse({
      garmentType: "hoodie", unit: "in",
      rows: [{ size: "S", measurements: { chest: 40, length: 26 } }, { size: "M", measurements: { chest: 42, length: 27 } }],
    }));
    expect(r.rows).toEqual([{ size: "S", chest: 40, length: 26 }, { size: "M", chest: 42, length: 27 }]);
  });
  it("rejects missing values, duplicates and shrinking sizes", () => {
    const bad = (rows: unknown) => () => buildSizeChart(parse({ garmentType: "tee", unit: "in", rows }));
    expect(bad([{ size: "S", measurements: { chest: 40 } }, { size: "M", measurements: { chest: 42, waist: 30 } }])).toThrow(/missing/);
    expect(bad([{ size: "S", measurements: { chest: 40 } }, { size: "s", measurements: { chest: 42 } }])).toThrow(/Duplicate/);
    expect(bad([{ size: "S", measurements: { chest: 44 } }, { size: "M", measurements: { chest: 42 } }])).toThrow(/decreases/);
    expect(bad([{ size: "S", measurements: {} }, { size: "M", measurements: { chest: 42 } }])).toThrow(/at least one/);
  });
});

describe("stored shape", () => {
  it("matches the format the product size chart screen saves", () => {
    const r = buildSizeChart(parse({
      garmentType: "tee", unit: "in", sizes: ["S", "M"], baseSize: "S",
      base: { chest: 38, waist: 30 }, grading: { chest: 2, waist: 1.5 },
    }));
    const stored = toStoredSizeChart(r, " Relaxed fit. ");
    expect(stored).toEqual({
      columns: ["Chest", "Waist"],
      rows: [{ size: "S", values: ["38", "30"] }, { size: "M", values: ["40", "31.5"] }],
      unit: "inches",
      notes: "Relaxed fit.",
    });
    expect(storedSizeChartSchema.safeParse(stored).success).toBe(true);
  });
  it("rejects malformed charts sent to save", () => {
    expect(storedSizeChartSchema.safeParse({ columns: ["Chest"], rows: [{ size: "S", values: ["a"] }], unit: "cm" }).success).toBe(false);
    expect(storedSizeChartSchema.safeParse({ columns: ["Chest"], rows: [{ size: "S", values: ["1", "2"] }], unit: "cm" }).success).toBe(false);
    expect(storedSizeChartSchema.safeParse({ columns: ["Chest"], rows: [{ size: "S", values: ["1"] }], unit: "cm", x: 1 }).success).toBe(false);
  });
});
