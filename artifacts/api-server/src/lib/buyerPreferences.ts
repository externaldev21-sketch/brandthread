import { z } from "@workspace/api-zod";

/**
 * Buyer saved sizes / preferences — validation + merge (pure, unit-tested).
 *
 * Stable API shape (GET returns it, PUT/PATCH accept a partial of it):
 *   {
 *     sizes: { tops?, bottoms?, outerwear?, shoes?, measurements?: { heightCm?, weightKg?, chestCm?, waistCm?, hipsCm? } },
 *     likedBrandIds: string[], styleInterests: string[],
 *     surveyCompletedAt: string | null, updatedAt: string | null
 *   }
 * In a PATCH body: a size/measurement set to `null` clears it; arrays replace;
 * `surveyCompleted: true` stamps surveyCompletedAt (false clears it).
 */
export const SIZE_KEYS = ["tops", "bottoms", "outerwear", "shoes"] as const;
export const MEASUREMENT_RANGES = {
  heightCm: [50, 260],
  weightKg: [20, 400],
  chestCm: [30, 250],
  waistCm: [30, 250],
  hipsCm: [30, 250],
} as const;
export type MeasurementKey = keyof typeof MEASUREMENT_RANGES;

const sizeValue = z.string().trim().min(1).max(16).nullable();
const measurement = (key: MeasurementKey) =>
  z.number().finite().min(MEASUREMENT_RANGES[key][0]).max(MEASUREMENT_RANGES[key][1]).nullable();

export const buyerPreferencesPatchSchema = z.object({
  sizes: z.object({
    tops: sizeValue.optional(),
    bottoms: sizeValue.optional(),
    outerwear: sizeValue.optional(),
    shoes: sizeValue.optional(),
    measurements: z.object({
      heightCm: measurement("heightCm").optional(),
      weightKg: measurement("weightKg").optional(),
      chestCm: measurement("chestCm").optional(),
      waistCm: measurement("waistCm").optional(),
      hipsCm: measurement("hipsCm").optional(),
    }).strict().optional(),
  }).strict().optional(),
  likedBrandIds: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
  styleInterests: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  surveyCompleted: z.boolean().optional(),
}).strict();

export type BuyerPreferencesPatch = z.infer<typeof buyerPreferencesPatchSchema>;

export interface StoredSizes {
  tops?: string; bottoms?: string; outerwear?: string; shoes?: string;
  measurements?: Partial<Record<MeasurementKey, number>>;
}

export interface BuyerPreferencesDto {
  sizes: StoredSizes;
  likedBrandIds: string[];
  styleInterests: string[];
  surveyCompletedAt: string | null;
  updatedAt: string | null;
}

export const DEFAULT_BUYER_PREFERENCES: BuyerPreferencesDto = {
  sizes: {}, likedBrandIds: [], styleInterests: [], surveyCompletedAt: null, updatedAt: null,
};

const uniq = (xs: string[]) => Array.from(new Set(xs));

/** Applies a validated patch to stored sizes. null removes a key; omitted keys are untouched. */
export function mergeSizes(current: StoredSizes | null | undefined, patch: NonNullable<BuyerPreferencesPatch["sizes"]>): StoredSizes {
  const next: StoredSizes = { ...(current ?? {}) };
  for (const key of SIZE_KEYS) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v === null) delete next[key]; else next[key] = v;
  }
  if (patch.measurements) {
    const m: Partial<Record<MeasurementKey, number>> = { ...(next.measurements ?? {}) };
    for (const key of Object.keys(MEASUREMENT_RANGES) as MeasurementKey[]) {
      const v = patch.measurements[key];
      if (v === undefined) continue;
      if (v === null) delete m[key]; else m[key] = v;
    }
    if (Object.keys(m).length) next.measurements = m; else delete next.measurements;
  }
  return next;
}

export interface StoredPreferences {
  sizes: StoredSizes; likedBrandIds: string[]; styleInterests: string[]; surveyCompletedAt: Date | null;
}

/** Columns to write for a patch on top of the existing row (or none). */
export function applyPatch(existing: StoredPreferences | null, patch: BuyerPreferencesPatch, now: Date = new Date()) {
  return {
    sizes: patch.sizes ? mergeSizes(existing?.sizes, patch.sizes) : (existing?.sizes ?? {}),
    likedBrandIds: patch.likedBrandIds ? uniq(patch.likedBrandIds) : (existing?.likedBrandIds ?? []),
    styleInterests: patch.styleInterests ? uniq(patch.styleInterests) : (existing?.styleInterests ?? []),
    surveyCompletedAt:
      patch.surveyCompleted === undefined ? (existing?.surveyCompletedAt ?? null)
      : patch.surveyCompleted ? (existing?.surveyCompletedAt ?? now) : null,
    updatedAt: now,
  };
}

export function toDto(row: (StoredPreferences & { updatedAt: Date }) | null | undefined): BuyerPreferencesDto {
  if (!row) return { ...DEFAULT_BUYER_PREFERENCES, sizes: {} };
  return {
    sizes: row.sizes ?? {},
    likedBrandIds: row.likedBrandIds ?? [],
    styleInterests: row.styleInterests ?? [],
    surveyCompletedAt: row.surveyCompletedAt ? row.surveyCompletedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
