import type { SizeChartData } from '@/lib/sizeChartTypes';

const CM_PER_INCH = 2.54;

function convertCell(value: string, factor: number): string {
  // Plain numbers and numeric ranges ("36-38") convert; text stays as typed.
  const m = value.match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/);
  if (!m) return value;
  const fmt = (n: number) => String(Math.round(n * factor * 2) / 2);
  return m[2] ? `${fmt(Number(m[1]))}-${fmt(Number(m[2]))}` : fmt(Number(m[1]));
}

/** Mirrors api-server lib/sizeChart.ts#convertSizeChartUnit (0.5 rounding). */
export function convertSizeChartUnit(chart: SizeChartData, to: 'inches' | 'cm'): SizeChartData {
  const from = chart.unit === 'cm' ? 'cm' : 'inches';
  if (from === to) return { ...chart, unit: to };
  const factor = to === 'cm' ? CM_PER_INCH : 1 / CM_PER_INCH;
  return {
    ...chart,
    unit: to,
    rows: chart.rows.map((r) => ({ size: r.size, values: r.values.map((v) => convertCell(v, factor)) })),
  };
}

export function chartSummary(chart: SizeChartData): string {
  const sizes = chart.rows.length;
  const cols = chart.columns.length;
  return `${sizes} size${sizes === 1 ? '' : 's'} · ${cols} measurement${cols === 1 ? '' : 's'}`;
}
