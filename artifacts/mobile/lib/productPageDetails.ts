/**
 * Product page details (polish 81, 85, 87, 88, 93, 94, 105): pure helpers
 * behind the buyer product page. Everything here comes from what the seller
 * set (GET /api/public/products/:id returns the columns from migration 270);
 * nothing is invented when a field is empty.
 */

export interface ProductPageDetails {
  modelHeightCm: number | null;
  modelSizeWorn: string | null;
  fabric: string | null;
  care: string | null;
  origin: string | null;
  /** Colour name → one of the product's own photos. */
  colorImages: Record<string, string>;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Reads the product page fields off a public product row. */
export function readProductPageDetails(row: unknown): ProductPageDetails {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  const rawColors = r.colorImages && typeof r.colorImages === 'object' && !Array.isArray(r.colorImages)
    ? r.colorImages as Record<string, unknown>
    : {};
  const colorImages: Record<string, string> = {};
  for (const [name, url] of Object.entries(rawColors)) {
    if (typeof url === 'string' && url && name.trim()) colorImages[name.trim()] = url;
  }
  const height = typeof r.modelHeightCm === 'number' && Number.isFinite(r.modelHeightCm) && r.modelHeightCm > 0
    ? Math.round(r.modelHeightCm)
    : null;
  return {
    modelHeightCm: height,
    modelSizeWorn: str(r.modelSizeWorn),
    fabric: str(r.fabric),
    care: str(r.care),
    origin: str(r.origin),
    colorImages,
  };
}

/** The photo the seller picked for a colour (case-insensitive), if any. */
export function colorImageFor(colorImages: Record<string, string>, colorLabel: string): string | undefined {
  const want = colorLabel.trim().toLowerCase();
  for (const [name, url] of Object.entries(colorImages)) {
    if (name.toLowerCase() === want) return url;
  }
  return undefined;
}

// Regions that state a person's height in feet and inches.
const IMPERIAL_HEIGHT_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

export function usesImperialHeight(locale: string | undefined): boolean {
  const region = (locale ?? '').split(/[-_]/)[1]?.toUpperCase();
  return region ? IMPERIAL_HEIGHT_REGIONS.has(region) : true;
}

export function formatHeight(cm: number, locale?: string): string {
  if (!usesImperialHeight(locale)) return `${Math.round(cm)} cm`;
  const totalInches = Math.round(cm / 2.54);
  return `${Math.floor(totalInches / 12)}'${totalInches % 12}"`;
}

/**
 * lululemon's model line, word for word: "Model is 5'10" and wears a size S".
 * Without a height: "Model wears a size S". Without a size: nothing (a bare
 * height says nothing about fit).
 */
export function formatModelLine(details: Pick<ProductPageDetails, 'modelHeightCm' | 'modelSizeWorn'>, locale?: string): string | null {
  if (!details.modelSizeWorn) return null;
  return details.modelHeightCm
    ? `Model is ${formatHeight(details.modelHeightCm, locale)} and wears a size ${details.modelSizeWorn}`
    : `Model wears a size ${details.modelSizeWorn}`;
}

/** The rows under the description, in lululemon's order; empty fields are left out. */
export function detailRows(details: ProductPageDetails): { key: 'fabric' | 'care' | 'origin'; title: string; body: string }[] {
  const rows: { key: 'fabric' | 'care' | 'origin'; title: string; body: string }[] = [];
  if (details.fabric) rows.push({ key: 'fabric', title: 'Fabric', body: details.fabric });
  if (details.care) rows.push({ key: 'care', title: 'Care', body: details.care });
  if (details.origin) rows.push({ key: 'origin', title: 'Origin', body: details.origin });
  return rows;
}

/** Whole-number percent off, or null when there is no real discount. */
export function percentOff(priceCents: number, compareAtCents: number | null | undefined): number | null {
  if (!compareAtCents || compareAtCents <= priceCents || priceCents < 0) return null;
  const pct = Math.round(((compareAtCents - priceCents) / compareAtCents) * 100);
  return pct >= 1 ? pct : null;
}

// ─── Size chart units (polish 85) ────────────────────────────────────────────

export type ChartUnit = 'in' | 'cm';

export function chartUnitOf(unit: unknown): ChartUnit | null {
  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  if (['in', 'inch', 'inches', '"'].includes(u)) return 'in';
  if (['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'].includes(u)) return 'cm';
  return null;
}

function trimNumber(n: number): string {
  // Round half up on the tenth; the epsilon keeps 57.15 (22.5in) from
  // landing on 57.1 through binary floating point.
  return String(Math.round(n * 10 + 1e-9) / 10);
}

/**
 * Converts one size-chart cell between inches and centimetres. Handles plain
 * numbers ("22.5") and ranges ("21-22", "21 – 22"); anything else (a size
 * label, "One size") comes back unchanged.
 */
export function convertChartValue(value: string, from: ChartUnit, to: ChartUnit): string {
  if (from === to) return value;
  const factor = from === 'in' ? 2.54 : 1 / 2.54;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(\s*[-–]\s*(\d+(?:\.\d+)?))?$/);
  if (!match) return value;
  const a = trimNumber(Number(match[1]) * factor);
  if (!match[3]) return a;
  return `${a}–${trimNumber(Number(match[3]) * factor)}`;
}

/** Gallery count label: "3/8". Null for a single photo. */
export function galleryCountLabel(index: number, total: number): string | null {
  if (total <= 1) return null;
  const current = Math.min(Math.max(index, 0), total - 1) + 1;
  return `${current}/${total}`;
}
