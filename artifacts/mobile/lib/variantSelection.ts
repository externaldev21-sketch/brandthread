/**
 * Selection + bulk edit logic for the Variants & stock screen's Select mode
 * (app/product-variants.tsx). Modelled on Shopify admin's variant bulk select:
 * select All / None or every variant with one option value ("Size S",
 * "Colour Black"), then apply one price, stock or compare-at price to the
 * selected rows. Pure functions so they can be unit-tested.
 */

export interface VariantAxis { name: string; values: string[] }
export interface SelectableVariant {
  id: string;
  size: string | null;
  color: string | null;
  options: Record<string, string>;
  priceCents: number;
  stock: number;
  compareAtCents?: number | null;
}

export type BulkField = 'price' | 'stock' | 'compareAt';

export interface BulkVariantUpdate {
  variantId: string;
  priceCents?: number;
  stock?: number;
  compareAtCents?: number | null;
}

export interface QuickSelect {
  key: string;
  label: string;
  ids: string[];
}

const axisKey = (name: string) => {
  const key = name.trim().toLowerCase();
  return key === 'color' ? 'colour' : key;
};

/** The variant's value for each axis, in axis order (size + colour live on columns). */
export function variantValues(v: SelectableVariant, axes: VariantAxis[]): string[] {
  if (axes.length === 0) return [v.size, v.color, ...Object.values(v.options)].filter(Boolean) as string[];
  return axes.map((a) => valueForAxis(v, a.name));
}

export function valueForAxis(v: SelectableVariant, axisName: string): string {
  const key = axisKey(axisName);
  if (key === 'size') return v.size ?? '';
  if (key === 'colour') return v.color ?? '';
  return v.options[axisName] ?? '';
}

/**
 * "Size S", "Colour Black", … for every option value at least one variant
 * has, in the order the seller set the axes and values.
 */
export function quickSelects(axes: VariantAxis[], variants: SelectableVariant[]): QuickSelect[] {
  const out: QuickSelect[] = [];
  for (const axis of axes) {
    for (const value of axis.values) {
      const ids = variants.filter((v) => valueForAxis(v, axis.name) === value).map((v) => v.id);
      if (ids.length > 0) out.push({ key: `${axisKey(axis.name)}:${value}`, label: `${axis.name} ${value}`, ids });
    }
  }
  return out;
}

export function allSelected(selected: ReadonlySet<string>, ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => selected.has(id));
}

/** Tapping a value selects every variant with it; tapping it again (all already selected) deselects them. */
export function toggleIds(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(selected);
  if (allSelected(selected, ids)) ids.forEach((id) => next.delete(id));
  else ids.forEach((id) => next.add(id));
  return next;
}

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** Drops ids that no longer exist (after a reload or regenerate). */
export function pruneSelection(selected: ReadonlySet<string>, variants: SelectableVariant[]): Set<string> {
  const live = new Set(variants.map((v) => v.id));
  return new Set([...selected].filter((id) => live.has(id)));
}

const MAX_PRICE_CENTS = 100_000_000;
const MAX_STOCK = 1_000_000;

export function parseCents(text: string): number | null {
  const clean = text.trim().replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(clean) && !/^\.\d{1,2}$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 && cents <= MAX_PRICE_CENTS ? cents : null;
}

export function parseStock(text: string): number | null {
  const clean = text.trim();
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return n <= MAX_STOCK ? n : null;
}

export type BulkBuild =
  | { ok: true; updates: BulkVariantUpdate[] }
  | { ok: false; error: string };

/**
 * One value applied to every selected variant. Rows that already hold the
 * value are left out, so an unchanged batch sends nothing. For compare-at, an
 * empty value (or `clear`) removes it.
 */
export function buildBulkUpdates(
  field: BulkField,
  text: string,
  selectedIds: readonly string[],
  variants: SelectableVariant[],
  opts: { clear?: boolean } = {},
): BulkBuild {
  const rows = variants.filter((v) => selectedIds.includes(v.id));
  if (rows.length === 0) return { ok: false, error: 'Select at least one variant.' };

  if (field === 'stock') {
    const stock = parseStock(text);
    if (stock === null) return { ok: false, error: 'Enter a whole number of 0 or more.' };
    return { ok: true, updates: rows.filter((v) => v.stock !== stock).map((v) => ({ variantId: v.id, stock })) };
  }

  if (field === 'price') {
    const priceCents = parseCents(text);
    if (priceCents === null) return { ok: false, error: 'Enter a price above 0.' };
    const blocked = rows.find((v) => v.compareAtCents != null && v.compareAtCents <= priceCents);
    if (blocked) return { ok: false, error: 'Price must stay below each compare-at price. Change the compare-at price first.' };
    return { ok: true, updates: rows.filter((v) => v.priceCents !== priceCents).map((v) => ({ variantId: v.id, priceCents })) };
  }

  if (opts.clear || text.trim() === '') {
    return { ok: true, updates: rows.filter((v) => v.compareAtCents != null).map((v) => ({ variantId: v.id, compareAtCents: null })) };
  }
  const compareAtCents = parseCents(text);
  if (compareAtCents === null) return { ok: false, error: 'Enter a compare-at price above 0.' };
  if (rows.some((v) => compareAtCents <= v.priceCents)) {
    return { ok: false, error: 'Compare-at price must be higher than the price of every selected variant.' };
  }
  return { ok: true, updates: rows.filter((v) => v.compareAtCents !== compareAtCents).map((v) => ({ variantId: v.id, compareAtCents })) };
}

/** Prefill for the edit sheet: the shared value when every selected row has it, else empty. */
export function sharedValue(field: BulkField, selectedIds: readonly string[], variants: SelectableVariant[]): string {
  const rows = variants.filter((v) => selectedIds.includes(v.id));
  if (rows.length === 0) return '';
  const pick = (v: SelectableVariant): number | null =>
    field === 'price' ? v.priceCents : field === 'stock' ? v.stock : (v.compareAtCents ?? null);
  const first = pick(rows[0]);
  if (first === null || rows.some((v) => pick(v) !== first)) return '';
  return field === 'stock' ? String(first) : (first / 100).toFixed(2);
}
