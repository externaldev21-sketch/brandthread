/**
 * Display units for My sizes measurements. Values are always stored metric
 * (cm / kg); lengths and weight each have their own display unit so switching
 * cm/in never changes the weight unit.
 */
const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

export type LengthUnit = 'cm' | 'in';
export type WeightUnit = 'kg' | 'lb';
export type Units = { length: LengthUnit; weight: WeightUnit };

/** Display unit for a measurement kind, e.g. 'in' for length or 'kg' for weight. */
export function unitFor(kind: 'length' | 'weight', units: Units): LengthUnit | WeightUnit {
  return kind === 'length' ? units.length : units.weight;
}

export function toDisplay(kind: 'length' | 'weight', metric: number | undefined, units: Units): string {
  if (metric === undefined) return '';
  const v = kind === 'length'
    ? (units.length === 'in' ? metric / CM_PER_IN : metric)
    : (units.weight === 'lb' ? metric / KG_PER_LB : metric);
  return String(Math.round(v * 10) / 10);
}
export function toMetric(kind: 'length' | 'weight', text: string, units: Units): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const metric = kind === 'length'
    ? (units.length === 'in' ? n * CM_PER_IN : n)
    : (units.weight === 'lb' ? n * KG_PER_LB : n);
  return Math.round(metric * 10) / 10;
}
