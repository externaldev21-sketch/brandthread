/**
 * Size badge model — pure logic behind SizeRecommendationBadge.
 * Turns (product, saved preferences) into what the badge should show.
 */
import {
  recommendSize,
  sizeCategoryFor,
  type BuyerSizePreferences,
  type SizeCategory,
  type SizeChartLike,
  type SizeConfidence,
} from '@/lib/sizeRecommendation';

export interface SizeBadgeProduct {
  name?: string;
  category?: string | null;
  sizeChart?: SizeChartLike | null;
  options?: Array<{ name: string; values: Array<{ label: string }> }>;
}

export type SizeBadgeModel =
  | { kind: 'recommend'; size: string; title: string; reason: string; confidence: SizeConfidence; category: SizeCategory }
  | { kind: 'find' };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

export function hasSizeChart(chart: SizeChartLike | null | undefined): boolean {
  return !!chart && Array.isArray(chart.rows) && chart.rows.some((r) => r && typeof r.size === 'string' && r.size.trim());
}

/** The product's size chip labels (the option named "Size"), or null when it has none. */
export function productSizeLabels(product: SizeBadgeProduct | null | undefined): string[] | null {
  const opt = product?.options?.find((o) => o.name.toLowerCase() === 'size');
  return opt ? opt.values.map((v) => v.label) : null;
}

/** The chip label that matches a recommended size ("m" matches "M"), or null. */
export function matchSizeLabel(size: string, labels: string[] | null | undefined): string | null {
  if (!labels) return null;
  return labels.find((l) => norm(l) === norm(size)) ?? null;
}

export function buildSizeBadgeModel(
  product: SizeBadgeProduct | null | undefined,
  preferences: BuyerSizePreferences | null | undefined,
): SizeBadgeModel | null {
  if (!product || !hasSizeChart(product.sizeChart)) return null;
  const category = sizeCategoryFor(product.category) ?? sizeCategoryFor(product.name);
  if (!category) return null;
  const rec = recommendSize(product.sizeChart, preferences, category);
  if (!rec) return { kind: 'find' };
  // A recommendation for a size the product does not sell would only confuse.
  const labels = productSizeLabels(product);
  const chip = labels ? matchSizeLabel(rec.size, labels) : rec.size;
  if (!chip) return { kind: 'find' };
  const fromSaved = rec.reason === 'Based on your saved size';
  return {
    kind: 'recommend',
    size: chip,
    title: fromSaved ? `Your size: ${chip}` : `Recommended: ${chip}`,
    reason: fromSaved ? `Based on your saved ${category} size` : rec.reason,
    confidence: rec.confidence,
    category,
  };
}
