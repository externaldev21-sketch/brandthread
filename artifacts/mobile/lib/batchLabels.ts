/**
 * Parcel weight for a bulk label: the items' stored weights when every item
 * has one, otherwise the saved box preset's weight. Never the old hard-coded
 * 1 lb, which under-quoted heavier parcels and left the carrier's re-weigh
 * charge for later.
 */
export type BatchParcelSuggestion = { weightLb: number; weightKnown: boolean } | null | undefined;

export function batchParcelWeightLb(suggestion: BatchParcelSuggestion, presetWeightOz: number): string {
  const lb = suggestion?.weightKnown && suggestion.weightLb > 0
    ? suggestion.weightLb
    : presetWeightOz / 16;
  return String(Math.max(0.1, Math.round(lb * 100) / 100));
}
