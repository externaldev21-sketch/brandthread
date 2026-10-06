/**
 * Buyer onboarding survey — pure state + persistence helpers (no React).
 *
 * The survey is the optional Sizes step plus the brands the buyer picked in
 * the Brands step. It is saved into buyer_preferences through the foundation
 * API (api.buyer.preferences.update) AFTER auth, as a best-effort write that
 * never blocks onboarding completion (completion stays server-authoritative
 * via syncBuyerOnboarding). A failed write is queued per Clerk user and
 * flushed on the next launch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BuyerPreferencesPatch } from '@/lib/api';
import type { SizeCategory } from '@/lib/sizeRecommendation';

export interface OnboardingSurvey {
  sizes: Partial<Record<SizeCategory, string>>;
  likedBrandIds: string[];
}

export const EMPTY_SURVEY: OnboardingSurvey = { sizes: {}, likedBrandIds: [] };

export const SURVEY_SIZE_CATEGORIES: { key: SizeCategory; label: string; options: string[] }[] = [
  { key: 'tops', label: 'Tops', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { key: 'bottoms', label: 'Bottoms', options: ['28', '30', '32', '34', '36', '38'] },
  { key: 'outerwear', label: 'Outerwear', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { key: 'shoes', label: 'Shoes', options: ['7', '8', '9', '10', '11', '12'] },
];

/** Tap a size to pick it, tap it again to clear it. */
export function toggleSize(
  sizes: OnboardingSurvey['sizes'],
  key: SizeCategory,
  value: string,
): OnboardingSurvey['sizes'] {
  const next = { ...sizes };
  if (next[key] === value) delete next[key];
  else next[key] = value;
  return next;
}

export function setLikedBrand(ids: string[], brandId: string, liked: boolean): string[] {
  const has = ids.includes(brandId);
  if (liked) return has ? ids : [...ids, brandId];
  return has ? ids.filter((id) => id !== brandId) : ids;
}

export function hasSurveyAnswers(survey: OnboardingSurvey): boolean {
  return Object.keys(survey.sizes).length > 0 || survey.likedBrandIds.length > 0;
}

/**
 * The buyer_preferences patch for a finished survey, or null when the buyer
 * skipped everything. Only answered fields are included so an existing saved
 * value is never cleared by a skipped step.
 */
export function buildSurveyPatch(
  survey: OnboardingSurvey,
  styleInterests: string[],
): BuyerPreferencesPatch | null {
  if (!hasSurveyAnswers(survey)) return null;
  const patch: BuyerPreferencesPatch = { surveyCompleted: true };
  if (Object.keys(survey.sizes).length > 0) patch.sizes = { ...survey.sizes };
  if (survey.likedBrandIds.length > 0) patch.likedBrandIds = [...survey.likedBrandIds];
  if (styleInterests.length > 0) patch.styleInterests = [...styleInterests];
  return patch;
}

/** Defensive parse of a persisted draft value (older drafts have no survey). */
export function sanitizeDraftSurvey(raw: unknown): OnboardingSurvey {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<OnboardingSurvey>;
  const sizes: OnboardingSurvey['sizes'] = {};
  for (const { key, options } of SURVEY_SIZE_CATEGORIES) {
    const v = value.sizes?.[key];
    if (typeof v === 'string' && options.includes(v)) sizes[key] = v;
  }
  const likedBrandIds = Array.isArray(value.likedBrandIds)
    ? [...new Set(value.likedBrandIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 200)
    : [];
  return { sizes, likedBrandIds };
}

// ─── Best-effort save with a per-user retry queue ───────────────────────────

type SurveyApi = { buyer: { preferences: { update: (patch: BuyerPreferencesPatch) => Promise<unknown> } } };

const KEY_PREFIX = 'bt:onboarding:buyer-survey-pending:v1:';
export const pendingSurveyKey = (userId: string) => `${KEY_PREFIX}${userId}`;

/** Writes the survey; on failure queues it for the next launch. Never throws. */
export async function saveBuyerSurvey(
  userId: string,
  survey: OnboardingSurvey,
  styleInterests: string[],
  api: SurveyApi,
): Promise<'saved' | 'skipped' | 'queued'> {
  const patch = buildSurveyPatch(survey, styleInterests);
  if (!patch) return 'skipped';
  try {
    await api.buyer.preferences.update(patch);
    await AsyncStorage.removeItem(pendingSurveyKey(userId)).catch(() => {});
    return 'saved';
  } catch {
    try {
      await AsyncStorage.setItem(pendingSurveyKey(userId), JSON.stringify(patch));
    } catch { /* storage unavailable — the survey is optional */ }
    return 'queued';
  }
}

/** Retries a queued survey write. Returns true when one was flushed. Never throws. */
export async function flushPendingBuyerSurvey(userId: string, api: SurveyApi): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(pendingSurveyKey(userId));
    if (!raw) return false;
    await api.buyer.preferences.update(JSON.parse(raw) as BuyerPreferencesPatch);
    await AsyncStorage.removeItem(pendingSurveyKey(userId));
    return true;
  } catch {
    return false;
  }
}
