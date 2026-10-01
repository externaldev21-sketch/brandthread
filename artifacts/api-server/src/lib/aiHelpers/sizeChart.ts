/**
 * Deterministic size chart arithmetic. The model never produces a number: it
 * only writes the fit note. Everything here is pure so it can be unit tested.
 */
import { z } from "zod";

export const MEASUREMENT_KEYS = ["chest", "waist", "hip", "shoulder", "sleeve", "length", "inseam", "rise"] as const;
export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

export const MEASUREMENT_LABELS: Record<MeasurementKey, string> = {
  chest: "Chest", waist: "Waist", hip: "Hip", shoulder: "Shoulder",
  sleeve: "Sleeve", length: "Length", inseam: "Inseam", rise: "Rise",
};

export const GARMENT_TYPES = ["tee", "hoodie", "jacket", "sweater", "dress", "shirt", "pants", "shorts", "skirt"] as const;
export const DEFAULT_SIZE_LADDER = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export const UNITS = ["cm", "in"] as const;
export type Unit = (typeof UNITS)[number];

/** Plausible garment measurement bounds per unit. */
const BOUNDS: Record<Unit, { min: number; max: number }> = {
  cm: { min: 5, max: 250 },
  in: { min: 2, max: 100 },
};

const sizeLabel = z.string().trim().min(1).max(8).regex(/^[A-Za-z0-9./ -]+$/, "Size labels use letters and numbers only");

/** Input mode A: one base size and a per-step grading rule. Mode B: explicit rows. */
export const sizeChartInputSchema = z
  .object({
    garmentType: z.enum(GARMENT_TYPES),
    unit: z.enum(UNITS),
    baseSize: sizeLabel.optional(),
    sizes: z.array(sizeLabel).min(2).max(10).optional(),
    base: z.record(z.string(), z.number().finite()).optional(),
    grading: z.record(z.string(), z.number().finite()).optional(),
    rows: z
      .array(z.object({ size: sizeLabel, measurements: z.record(z.string(), z.number().finite()) }).strict())
      .min(2)
      .max(10)
      .optional(),
  })
  .strict();

export type SizeChartInput = z.infer<typeof sizeChartInputSchema>;

export type SizeChartRowOut = { size: string } & Partial<Record<MeasurementKey, number>>;
export type SizeChartResult = {
  unit: Unit;
  columns: MeasurementKey[];
  rows: SizeChartRowOut[];
};

export class SizeChartInputError extends Error {}

function round(n: number, step = 0.5): number {
  return Math.round(n / step) * step;
}

function checkMeasurements(raw: Record<string, number>, unit: Unit, what: string): Partial<Record<MeasurementKey, number>> {
  const { min, max } = BOUNDS[unit];
  const out: Partial<Record<MeasurementKey, number>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(MEASUREMENT_KEYS as readonly string[]).includes(k)) throw new SizeChartInputError(`${what}: unknown measurement "${k}"`);
    if (!Number.isFinite(v) || v < min || v > max) {
      throw new SizeChartInputError(`${what}: ${k} must be between ${min} and ${max} ${unit}`);
    }
    out[k as MeasurementKey] = v;
  }
  return out;
}

function checkGrading(raw: Record<string, number>, keys: MeasurementKey[]): Partial<Record<MeasurementKey, number>> {
  const out: Partial<Record<MeasurementKey, number>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(MEASUREMENT_KEYS as readonly string[]).includes(k)) throw new SizeChartInputError(`grading: unknown measurement "${k}"`);
    if (!Number.isFinite(v) || v < 0 || v > 15) throw new SizeChartInputError(`grading: ${k} must be between 0 and 15 per size step`);
    if (!keys.includes(k as MeasurementKey)) throw new SizeChartInputError(`grading: "${k}" has no base measurement`);
    out[k as MeasurementKey] = v;
  }
  return out;
}

function orderKeys(keys: Iterable<string>): MeasurementKey[] {
  const set = new Set(keys);
  return MEASUREMENT_KEYS.filter((k) => set.has(k));
}

/** Explicit rows are listed smallest to largest; no measurement may shrink. */
function assertMonotonic(rows: SizeChartRowOut[], columns: MeasurementKey[]): void {
  for (const c of columns) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]![c]! < rows[i - 1]![c]!) {
        throw new SizeChartInputError(`${MEASUREMENT_LABELS[c]} decreases from ${rows[i - 1]!.size} to ${rows[i]!.size}; list sizes from smallest to largest`);
      }
    }
  }
}

/** Builds the chart. Throws SizeChartInputError on anything it cannot compute. */
export function buildSizeChart(input: SizeChartInput): SizeChartResult {
  const unit = input.unit;

  if (input.rows) {
    if (input.base || input.grading || input.sizes || input.baseSize) {
      throw new SizeChartInputError("Send either explicit rows or a base size with grading, not both");
    }
    const seen = new Set<string>();
    const keys = new Set<string>();
    const rows: SizeChartRowOut[] = input.rows.map((r) => {
      const label = r.size.trim();
      if (seen.has(label.toUpperCase())) throw new SizeChartInputError(`Duplicate size "${label}"`);
      seen.add(label.toUpperCase());
      const m = checkMeasurements(r.measurements, unit, `size ${label}`);
      if (Object.keys(m).length === 0) throw new SizeChartInputError(`size ${label}: add at least one measurement`);
      Object.keys(m).forEach((k) => keys.add(k));
      return { size: label, ...m };
    });
    const columns = orderKeys(keys);
    for (const r of rows) {
      for (const c of columns) if (r[c] === undefined) throw new SizeChartInputError(`size ${r.size}: missing ${c}`);
    }
    assertMonotonic(rows, columns);
    return { unit, columns, rows };
  }

  if (!input.base || !input.grading) {
    throw new SizeChartInputError("Send a base size with its measurements and a grading rule, or explicit rows");
  }
  const base = checkMeasurements(input.base, unit, "base");
  const columns = orderKeys(Object.keys(base));
  if (columns.length === 0) throw new SizeChartInputError("base: add at least one measurement");
  const grading = checkGrading(input.grading, columns);

  const sizes = (input.sizes ?? [...DEFAULT_SIZE_LADDER]).map((s) => s.trim());
  if (new Set(sizes.map((s) => s.toUpperCase())).size !== sizes.length) throw new SizeChartInputError("Duplicate size labels");
  const baseLabel = (input.baseSize ?? (sizes.includes("M") ? "M" : sizes[Math.floor((sizes.length - 1) / 2)]!)).trim();
  const baseIdx = sizes.findIndex((s) => s.toUpperCase() === baseLabel.toUpperCase());
  if (baseIdx < 0) throw new SizeChartInputError(`Base size "${baseLabel}" is not in the size list`);

  const { min, max } = BOUNDS[unit];
  const rows: SizeChartRowOut[] = sizes.map((size, idx) => {
    const row: SizeChartRowOut = { size };
    for (const c of columns) {
      const v = round(base[c]! + (idx - baseIdx) * (grading[c] ?? 0));
      if (v < min || v > max) throw new SizeChartInputError(`${MEASUREMENT_LABELS[c]} for ${size} falls outside ${min}-${max} ${unit}`);
      row[c] = v;
    }
    return row;
  });
  return { unit, columns, rows };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Shape stored in products.size_chart and read by app/product-size-chart.tsx. */
export type StoredSizeChart = {
  columns: string[];
  rows: { size: string; values: string[] }[];
  unit: "inches" | "cm";
  notes?: string;
};

export function toStoredSizeChart(result: SizeChartResult, notes?: string): StoredSizeChart {
  const out: StoredSizeChart = {
    columns: result.columns.map((c) => MEASUREMENT_LABELS[c]),
    rows: result.rows.map((r) => ({ size: r.size, values: result.columns.map((c) => fmt(r[c]!)) })),
    unit: result.unit === "in" ? "inches" : "cm",
  };
  if (notes && notes.trim()) out.notes = notes.trim();
  return out;
}

/** Strict validation for the chart sent to /save (it must be the stored shape). */
export const storedSizeChartSchema = z
  .object({
    columns: z.array(z.string().trim().min(1).max(24)).min(1).max(12),
    rows: z
      .array(z.object({ size: z.string().trim().min(1).max(12), values: z.array(z.string().trim().max(12)).max(12) }).strict())
      .min(1)
      .max(14),
    unit: z.enum(["inches", "cm"]),
    notes: z.string().trim().max(400).optional(),
  })
  .strict()
  .superRefine((chart, ctx) => {
    chart.rows.forEach((r, i) => {
      if (r.values.length !== chart.columns.length) {
        ctx.addIssue({ code: "custom", path: ["rows", i, "values"], message: "Each row needs one value per column" });
      }
      r.values.forEach((v, j) => {
        if (!/^\d{1,3}(\.\d)?$/.test(v)) ctx.addIssue({ code: "custom", path: ["rows", i, "values", j], message: "Values must be numbers" });
      });
    });
  });
