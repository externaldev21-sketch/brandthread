/**
 * Size recommendation — pure helper (no React, no I/O).
 *
 * recommendSize(sizeChart, preferences, category) compares a buyer's saved
 * measurements (and saved size for the category) with a product's
 * `products.size_chart` JSON ({columns, rows:[{size, values}], unit, notes}).
 * Returns null when there is not enough data to say anything honest.
 */

export type SizeCategory = 'tops' | 'bottoms' | 'outerwear' | 'shoes';
export type SizeConfidence = 'high' | 'medium' | 'low';

export interface SizeChartRow { size: string; values: string[] }
export interface SizeChartLike {
  columns?: string[];
  rows?: SizeChartRow[];
  unit?: string;
  notes?: string;
}

export interface BuyerMeasurements {
  heightCm?: number; weightKg?: number; chestCm?: number; waistCm?: number; hipsCm?: number;
}
export interface BuyerSizePreferences {
  sizes?: Partial<Record<SizeCategory, string>> & { measurements?: BuyerMeasurements };
}

export interface SizeRecommendation {
  size: string;
  confidence: SizeConfidence;
  reason: string;
}

const CM_PER_IN = 2.54;
/** A measurement further than this (cm) from every row means the chart does not fit the buyer. */
const MAX_GAP_CM = 6;

type Dimension = 'chest' | 'waist' | 'hips' | 'height';

/** Which buyer measurements matter for each category. */
const DIMENSIONS: Record<SizeCategory, Dimension[]> = {
  tops: ['chest', 'waist', 'height'],
  outerwear: ['chest', 'waist', 'height'],
  bottoms: ['waist', 'hips'],
  shoes: [],
};

function dimensionForColumn(label: string): Dimension | null {
  const l = label.toLowerCase();
  if (/chest|bust|pit/.test(l)) return 'chest';
  if (/waist/.test(l)) return 'waist';
  if (/hip/.test(l)) return 'hips';
  if (/height/.test(l)) return 'height';
  return null;
}

/** "38", "38.5", "36-38", "36–38", "36 to 38", "36-38 in" -> [lo, hi] or null. */
export function parseRange(value: string | number | null | undefined): [number, number] | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(',', '.');
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const a = parseFloat(nums[0]);
  const b = nums.length > 1 ? parseFloat(nums[1]) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a <= b ? [a, b] : [b, a];
}

function unitFactorToCm(unit: string | undefined): number {
  return /^(in|inch)/i.test((unit ?? '').trim()) ? CM_PER_IN : 1;
}

function normalizeSize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '').replace(/^(\d+)\.0+$/, '$1');
}

function measurementFor(dim: Dimension, m: BuyerMeasurements | undefined): number | undefined {
  const v = dim === 'chest' ? m?.chestCm : dim === 'waist' ? m?.waistCm : dim === 'hips' ? m?.hipsCm : m?.heightCm;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

interface Used { dim: Dimension; col: number; cm: number }
interface RowScore { row: SizeChartRow; gap: number; inRange: number; bounds: Array<[number, number, number]> }

function savedSizeRow(rows: SizeChartRow[], saved: string | undefined): SizeChartRow | null {
  if (!saved) return null;
  const n = normalizeSize(saved);
  return rows.find((r) => normalizeSize(r.size) === n) ?? null;
}

export function recommendSize(
  sizeChart: SizeChartLike | null | undefined,
  preferences: BuyerSizePreferences | null | undefined,
  category: SizeCategory,
): SizeRecommendation | null {
  const rows = (sizeChart?.rows ?? []).filter((r) => r && typeof r.size === 'string' && r.size.trim());
  if (rows.length === 0) return null;

  const sizes = preferences?.sizes;
  const saved = sizes?.[category];
  const savedRow = savedSizeRow(rows, saved);

  // 1. Measurement-based match against the chart's own columns.
  const factor = unitFactorToCm(sizeChart?.unit);
  const columns = sizeChart?.columns ?? [];
  const used: Used[] = [];
  for (const dim of DIMENSIONS[category]) {
    const cm = measurementFor(dim, sizes?.measurements);
    const col = columns.findIndex((c) => dimensionForColumn(c) === dim);
    if (cm !== undefined && col >= 0) used.push({ dim, col, cm });
  }
  // Height only refines other measurements; it never drives a recommendation alone.
  const driving = used.filter((u) => u.dim !== 'height');

  if (driving.length > 0) {
    const scored: RowScore[] = [];
    for (const row of rows) {
      let gap = 0; let inRange = 0; let counted = 0;
      const bounds: Array<[number, number, number]> = [];
      for (const u of used) {
        const range = parseRange(row.values?.[u.col]);
        if (!range) continue;
        const lo = range[0] * factor; const hi = range[1] * factor;
        // A single chart value (no range) is a point: allow half an inch / 1 cm of tolerance.
        const tol = range[0] === range[1] ? (factor > 1 ? 0.5 * factor : 1) : 0;
        const d = u.cm < lo - tol ? lo - tol - u.cm : u.cm > hi + tol ? u.cm - (hi + tol) : 0;
        gap += d; counted += 1;
        if (d === 0) inRange += 1;
        bounds.push([lo, hi, u.cm]);
      }
      if (counted > 0) scored.push({ row, gap: gap / counted, inRange, bounds });
    }

    if (scored.length > 0) {
      const perfect = scored.filter((s) => s.gap === 0);
      if (perfect.length > 0) {
        // Fits every measured dimension. If several rows overlap, take the one whose midpoint is closest.
        const best = perfect.length === 1 ? perfect[0] : closestMidpoint(perfect);
        const dims = driving.map((u) => u.dim).join(' and ');
        const agrees = savedRow && normalizeSize(savedRow.size) === normalizeSize(best.row.size);
        return {
          size: best.row.size,
          confidence: driving.length >= 2 || agrees ? 'high' : 'medium',
          reason: agrees ? `Fits your ${dims} and matches your saved size` : `Fits your ${dims} measurements`,
        };
      }
      const nearest = [...scored].sort((a, b) => a.gap - b.gap);
      if (nearest[0].gap <= MAX_GAP_CM) {
        // Between two sizes: recommend the larger neighbour so nothing is too tight.
        const a = nearest[0]; const b = nearest[1];
        const pair = b && b.gap - a.gap < 1.5 ? [a.row, b.row] : null;
        if (pair) {
          const order = pair.map((r) => rows.indexOf(r)).sort((x, y) => x - y);
          const [small, large] = [rows[order[0]], rows[order[1]]];
          return { size: large.size, confidence: 'low', reason: `Between ${small.size} and ${large.size}` };
        }
        return { size: a.row.size, confidence: 'low', reason: `Closest to your measurements` };
      }
    }
  }

  // 2. Fall back to the saved size for this category, if the chart offers it.
  if (savedRow) {
    return { size: savedRow.size, confidence: 'medium', reason: 'Based on your saved size' };
  }
  return null;
}

function closestMidpoint(cands: RowScore[]): RowScore {
  let best = cands[0]; let bestDist = Infinity;
  for (const c of cands) {
    const dist = c.bounds.reduce((sum, [lo, hi, cm]) => sum + Math.abs((lo + hi) / 2 - cm), 0);
    if (dist < bestDist) { best = c; bestDist = dist; }
  }
  return best;
}

/** Best-effort mapping from a product's free-text category / name to a size category. */
export function sizeCategoryFor(text: string | null | undefined): SizeCategory | null {
  const t = (text ?? '').toLowerCase();
  if (!t) return null;
  if (/shoe|sneaker|boot|sandal|loafer|heel|footwear/.test(t)) return 'shoes';
  if (/jacket|coat|parka|puffer|outerwear|blazer|windbreaker/.test(t)) return 'outerwear';
  if (/pant|jean|trouser|short|skirt|legging|bottom|jogger|denim/.test(t)) return 'bottoms';
  if (/top|tee|t-shirt|shirt|hoodie|sweat|knit|sweater|dress|apparel|blouse|tank|crew/.test(t)) return 'tops';
  return null;
}
