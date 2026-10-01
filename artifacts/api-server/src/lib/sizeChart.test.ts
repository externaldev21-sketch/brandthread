import { describe, expect, it } from "vitest";
import { MAX_CHART_COLUMNS, SIZE_CHART_PRESETS, convertSizeChartUnit, normalizeSizeChart } from "./sizeChart";

describe("normalizeSizeChart", () => {
  it("trims, pads short rows and defaults the unit to inches", () => {
    const r = normalizeSizeChart({ columns: [" Chest ", "Waist"], rows: [{ size: " M ", values: ["38"] }] });
    expect(r).toEqual({ ok: true, chart: { columns: ["Chest", "Waist"], rows: [{ size: "M", values: ["38", ""] }], unit: "inches" } });
  });
  it("drops blank-size rows and rejects duplicates case-insensitively", () => {
    expect(normalizeSizeChart({ columns: ["A"], rows: [{ size: "", values: ["1"] }, { size: "S", values: ["1"] }] }))
      .toMatchObject({ ok: true });
    expect(normalizeSizeChart({ columns: ["A"], rows: [{ size: "S", values: [] }, { size: "s", values: [] }] }))
      .toMatchObject({ ok: false });
  });
  it("rejects empty, oversized and malformed charts", () => {
    expect(normalizeSizeChart(null)).toMatchObject({ ok: false });
    expect(normalizeSizeChart({ columns: [], rows: [{ size: "S", values: [] }] })).toMatchObject({ ok: false });
    expect(normalizeSizeChart({ columns: ["A"], rows: [] })).toMatchObject({ ok: false });
    const many = Array.from({ length: MAX_CHART_COLUMNS + 1 }, (_, i) => `c${i}`);
    expect(normalizeSizeChart({ columns: many, rows: [{ size: "S", values: [] }] })).toMatchObject({ ok: false });
    expect(normalizeSizeChart({ columns: [""], rows: [{ size: "S", values: [] }] })).toMatchObject({ ok: false });
  });
  it("keeps cm and notes", () => {
    const r = normalizeSizeChart({ columns: ["A"], rows: [{ size: "S", values: ["1"] }], unit: "cm", notes: " flat " });
    expect(r).toMatchObject({ ok: true, chart: { unit: "cm", notes: "flat" } });
  });
});

describe("convertSizeChartUnit", () => {
  const chart = { unit: "inches" as const, columns: ["Chest", "Fit"], rows: [{ size: "M", values: ["38-40", "Relaxed"] }, { size: "L", values: ["42", "—"] }] };
  it("converts numbers and ranges to cm rounded to 0.5, leaves text alone", () => {
    const cm = convertSizeChartUnit(chart, "cm");
    expect(cm.unit).toBe("cm");
    expect(cm.rows[0].values).toEqual(["96.5-101.5", "Relaxed"]);
    expect(cm.rows[1].values).toEqual(["106.5", "—"]);
  });
  it("is a no-op for the same unit and round-trips approximately", () => {
    expect(convertSizeChartUnit(chart, "inches").rows).toEqual(chart.rows);
    expect(convertSizeChartUnit(convertSizeChartUnit(chart, "cm"), "inches").rows[1].values[0]).toBe("42");
  });
});

describe("presets", () => {
  it("are all valid charts", () => {
    for (const p of SIZE_CHART_PRESETS) expect(normalizeSizeChart(p.chart).ok, p.key).toBe(true);
  });
});
