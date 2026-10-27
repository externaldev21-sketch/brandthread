import type { AdCampaign, AdCtaKind, AdMediaKind } from '@/lib/api';

/** The editable fields of the campaign designer, derived from a saved campaign. */
export interface AdCampaignFormState {
  headline: string;
  description: string;
  ctaKind: AdCtaKind | null;
  ctaDestId: string | null;
  budgetCents: number | null;
  /** Daily budget; derived from the total (rounded to whole dollars) for total-only campaigns */
  dailyBudgetCents: number | null;
  durationDays: number | null;
  mediaKind: AdMediaKind;
  mediaPaths: string[];
  mediaMimes: string[];
  mediaUris: string[];
}

/**
 * Maps a campaign loaded from the server onto the designer's form state so an
 * existing campaign opens with its saved headline, CTA, budget and media
 * instead of an empty form. `budgetCents` / `dailyBudgetCents` / `durationDays`
 * are null when the server has no usable value so the caller keeps its defaults.
 */
export function adCampaignToFormState(c: Partial<AdCampaign> | null | undefined): AdCampaignFormState {
  const budgetCents = typeof c?.budgetCents === 'number' && c.budgetCents > 0 ? c.budgetCents : null;
  const durationDays = typeof c?.durationDays === 'number' && c.durationDays > 0 ? c.durationDays : null;
  const dailyBudgetCents = typeof c?.dailyBudgetCents === 'number' && c.dailyBudgetCents > 0
    ? c.dailyBudgetCents
    : budgetCents != null && durationDays != null ? Math.max(100, Math.round(budgetCents / durationDays / 100) * 100) : null;
  const paths = Array.isArray(c?.mediaObjectPaths) ? c!.mediaObjectPaths.filter((p) => typeof p === 'string') : [];
  const mimes = Array.isArray(c?.mediaMimeTypes) ? c!.mediaMimeTypes : [];
  const urls = Array.isArray(c?.mediaUrls) ? c!.mediaUrls : [];
  return {
    headline: c?.headline ?? '',
    description: c?.description ?? '',
    ctaKind: c?.ctaKind ?? null,
    ctaDestId: c?.ctaDestinationId ?? null,
    budgetCents,
    dailyBudgetCents,
    durationDays,
    mediaKind: c?.mediaKind === 'video' ? 'video' : 'photos',
    mediaPaths: paths,
    mediaMimes: paths.map((_, i) => mimes[i] ?? (c?.mediaKind === 'video' ? 'video/mp4' : 'image/jpeg')),
    mediaUris: paths.map((_, i) => urls[i] ?? ''),
  };
}
