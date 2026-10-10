/**
 * Size chart normalisation, unit conversion and starter presets. Pure, so the
 * template routes and the tests share one definition of a valid chart.
 */
export type SizeChart = {
  columns: string[];
  rows: { size: string; values: string[] }[];
  unit?: "inches" | "cm";
  notes?: string;
};

export const MAX_CHART_COLUMNS = 12;
export const MAX_CHART_ROWS = 24;
const CM_PER_INCH = 2.54;

type Result = { ok: true; chart: SizeChart } | { ok: false; error: string };

/** Validates untrusted input and returns a trimmed, rectangular chart. */
export function normalizeSizeChart(input: unknown): Result {
  if (!input || typeof input !== "object") return { ok: false, error: "chart is required" };
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) {
    return { ok: false, error: "chart needs columns and rows" };
  }
  const columns = raw.columns.map((c) => String(c ?? "").trim());
  if (columns.length === 0) return { ok: false, error: "Add at least one measurement column" };
  if (columns.length > MAX_CHART_COLUMNS) return { ok: false, error: `At most ${MAX_CHART_COLUMNS} columns` };
  if (columns.some((c) => !c || c.length > 40)) return { ok: false, error: "Column names must be 1-40 characters" };

  const seen = new Set<string>();
  const rows: SizeChart["rows"] = [];
  for (const r of raw.rows) {
    const row = r as { size?: unknown; values?: unknown };
    const size = String(row?.size ?? "").trim();
    if (!size) continue;
    if (size.length > 20) return { ok: false, error: "Size labels must be 20 characters or fewer" };
    const key = size.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `Size "${size}" appears twice` };
    seen.add(key);
    const values = Array.isArray(row.values) ? row.values : [];
    rows.push({
      size,
      values: columns.map((_, i) => String(values[i] ?? "").trim().slice(0, 20)),
    });
  }
  if (rows.length === 0) return { ok: false, error: "Add at least one size row" };
  if (rows.length > MAX_CHART_ROWS) return { ok: false, error: `At most ${MAX_CHART_ROWS} sizes` };

  const unit = raw.unit === "cm" ? "cm" : "inches";
  const notes = typeof raw.notes === "string" ? raw.notes.trim().slice(0, 500) : "";
  return { ok: true, chart: { columns, rows, unit, ...(notes ? { notes } : {}) } };
}

function convertCell(value: string, factor: number): string {
  // Only plain numbers and numeric ranges ("36-38") are converted; anything
  // else ("One size", "—") is left exactly as the seller typed it.
  const m = value.match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/);
  if (!m) return value;
  const fmt = (n: number) => String(Math.round(n * factor * 2) / 2);
  return m[2] ? `${fmt(Number(m[1]))}-${fmt(Number(m[2]))}` : fmt(Number(m[1]));
}

/** Converts every numeric cell between inches and cm (rounded to 0.5). */
export function convertSizeChartUnit(chart: SizeChart, to: "inches" | "cm"): SizeChart {
  const from = chart.unit === "cm" ? "cm" : "inches";
  if (from === to) return { ...chart, unit: to };
  const factor = to === "cm" ? CM_PER_INCH : 1 / CM_PER_INCH;
  return {
    ...chart,
    unit: to,
    rows: chart.rows.map((r) => ({ size: r.size, values: r.values.map((v) => convertCell(v, factor)) })),
  };
}

export type SizeChartPreset = { key: string; name: string; chart: SizeChart };

const sizes = (labels: string[], data: string[][]) => labels.map((size, i) => ({ size, values: data[i] }));

export const SIZE_CHART_PRESETS: SizeChartPreset[] = [
  {
    key: "tops",
    name: "Tops & tees",
    chart: {
      unit: "inches",
      columns: ["Chest", "Length", "Sleeve"],
      rows: sizes(["XS", "S", "M", "L", "XL", "XXL"], [
        ["32-34", "25", "7.5"], ["35-37", "26", "8"], ["38-40", "27", "8.5"],
        ["41-43", "28", "9"], ["44-46", "29", "9.5"], ["47-49", "30", "10"],
      ]),
    },
  },
  {
    key: "bottoms",
    name: "Pants & shorts",
    chart: {
      unit: "inches",
      columns: ["Waist", "Hip", "Inseam"],
      rows: sizes(["XS", "S", "M", "L", "XL", "XXL"], [
        ["26-28", "34-36", "30"], ["29-31", "37-39", "30"], ["32-34", "40-42", "31"],
        ["35-37", "43-45", "31"], ["38-40", "46-48", "32"], ["41-43", "49-51", "32"],
      ]),
    },
  },
  {
    key: "dresses",
    name: "Dresses",
    chart: {
      unit: "inches",
      columns: ["Bust", "Waist", "Hip", "Length"],
      rows: sizes(["XS", "S", "M", "L", "XL"], [
        ["32", "25", "35", "38"], ["34", "27", "37", "39"], ["36", "29", "39", "40"],
        ["38", "31", "41", "41"], ["41", "34", "44", "42"],
      ]),
    },
  },
  {
    key: "hats",
    name: "Hats & beanies",
    chart: {
      unit: "inches",
      columns: ["Head circumference"],
      rows: sizes(["S/M", "L/XL"], [["21-22"], ["22.5-24"]]),
    },
  },
];
