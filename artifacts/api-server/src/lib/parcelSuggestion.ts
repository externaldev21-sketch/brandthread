/**
 * Suggested parcel for a label, from the variants' stored weights. Pure so it
 * is unit-testable; the route loads the rows. Product weights are grams;
 * carriers and saved package presets use ounces / pounds.
 */
export const GRAMS_PER_OUNCE = 28.349523125;

export type ParcelLine = { quantity: number; weightGrams: number | null };

export type ParcelSuggestion = {
  weightGrams: number;
  weightOz: number;
  weightLb: number;
  /** Line items (units) with no weight on file, so the total is a floor. */
  unweightedUnits: number;
  weightKnown: boolean;
};

export function suggestParcel(lines: ParcelLine[]): ParcelSuggestion {
  let grams = 0;
  let unweighted = 0;
  for (const line of lines) {
    const qty = Math.max(0, Math.trunc(line.quantity));
    if (!line.weightGrams || line.weightGrams <= 0) unweighted += qty;
    else grams += line.weightGrams * qty;
  }
  const oz = Math.round((grams / GRAMS_PER_OUNCE) * 10) / 10;
  return {
    weightGrams: Math.round(grams),
    weightOz: oz,
    weightLb: Math.round((grams / (GRAMS_PER_OUNCE * 16)) * 100) / 100,
    unweightedUnits: unweighted,
    weightKnown: grams > 0 && unweighted === 0,
  };
}

export type ParcelInput = { length: number; width: number; height: number; weight: number };

/** Validates a seller-entered parcel (inches / pounds). Returns an error message or null. */
export function parcelInputError(body: Partial<Record<keyof ParcelInput, unknown>>): string | null {
  for (const key of ["length", "width", "height", "weight"] as const) {
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value <= 0 || value > 1000) {
      return `${key} must be a positive number`;
    }
  }
  return null;
}
