/**
 * Brandthread Ad Campaign Service
 *
 * Focused service for the Create Ad flow. Does NOT touch designService.ts or
 * mockup-to-model files. Uses the existing api.ts client exclusively.
 *
 * 5-step flow validators:
 *   validateMediaStage       — Step 1
 *   validateDescriptionStage — Step 2
 *   validateCtaStage         — Step 3
 *   validateFormatStage      — Step 4
 *   validateBudgetStage      — Step 5
 *
 * Legacy aliases kept for backward compatibility:
 *   validateDetailsStage   → validateCtaStage (CTA + product selection)
 *   validatePlacementStage → validateBudgetStage (formats + budget + duration)
 *
 * Reach estimate formula (mirrors server):
 *   low  = floor(budgetCents / 100 * 35)   // ~35 impressions per $1
 *   high = floor(budgetCents / 100 * 65)   // ~65 impressions per $1
 *
 * This estimate is a planning aid. It is never reported as delivered impressions.
 * No OUTPUT_COUNT or VARIATION_COUNT is exposed by this service.
 */

import type {
  AdCampaign,
  AdCtaKind,
  AdCtaDestinationKind,
  AdFormatKind,
  AdMediaKind,
} from '@/lib/api';

// ─── Shared reach estimate (matches server formula exactly) ──────────────────

export function estimateReach(budgetCents: number): { low: number; high: number } {
  const dollars = budgetCents / 100;
  return {
    low:  Math.floor(dollars * 35),
    high: Math.floor(dollars * 65),
  };
}

// ─── Budget / Duration constraints ───────────────────────────────────────────

export const BUDGET_MIN_CENTS  = 500;      // $5
export const BUDGET_MAX_CENTS  = 100_000;  // $1000
export const DURATION_MIN_DAYS = 1;
export const DURATION_MAX_DAYS = 30;
export const MAX_PHOTOS        = 5;
export const MAX_VIDEO_DURATION_SECONDS = 60;

// Whole-dollar increments: $5, $10, $15, … up to $1000
// Generates an array of valid budget steps in cents
export function buildBudgetSteps(): number[] {
  const steps: number[] = [];
  // $5–$50 in $5 steps
  for (let d = 5; d <= 50; d += 5)  steps.push(d * 100);
  // $60–$200 in $10 steps
  for (let d = 60; d <= 200; d += 10) steps.push(d * 100);
  // $225–$500 in $25 steps
  for (let d = 225; d <= 500; d += 25) steps.push(d * 100);
  // $550–$1000 in $50 steps
  for (let d = 550; d <= 1000; d += 50) steps.push(d * 100);
  return steps;
}

export const BUDGET_STEPS = buildBudgetSteps();

/** Snap arbitrary cents to nearest valid step */
export function snapBudget(cents: number): number {
  let best = BUDGET_STEPS[0];
  let bestDist = Math.abs(cents - best);
  for (const s of BUDGET_STEPS) {
    const d = Math.abs(cents - s);
    if (d < bestDist) { best = s; bestDist = d; }
  }
  return best;
}

export function formatBudgetCents(cents: number): string {
  return `$${cents / 100}`;
}

// ─── CTA definitions ─────────────────────────────────────────────────────────

export interface CtaOption {
  kind: AdCtaKind;
  label: string;
  destinationKind: AdCtaDestinationKind;
  requiresProductSelection: boolean;
}

export const CTA_OPTIONS: CtaOption[] = [
  {
    kind: 'shop_now',
    label: 'Shop now',
    destinationKind: 'product',
    requiresProductSelection: true,
  },
  {
    kind: 'learn_more',
    label: 'Learn more',
    destinationKind: 'store',
    requiresProductSelection: false,
  },
  {
    kind: 'view_product',
    label: 'View product',
    destinationKind: 'product',
    requiresProductSelection: true,
  },
  {
    kind: 'sign_up',
    label: 'Sign up',
    destinationKind: 'profile',
    requiresProductSelection: false,
  },
  {
    kind: 'contact_us',
    label: 'Contact us',
    destinationKind: 'contact',
    requiresProductSelection: false,
  },
];

// ─── Ad format definitions ────────────────────────────────────────────────────

export interface AdFormatOption {
  kind: AdFormatKind;
  label: string;
  aspectRatio: string;
  /** Display aspect ratio as a numeric fraction (w/h) for silhouette sizing */
  ratioW: number;
  ratioH: number;
  dims: string;
  description: string;
}

export const AD_FORMAT_OPTIONS: AdFormatOption[] = [
  {
    kind: 'story_9x16',
    label: 'Vertical story',
    aspectRatio: '9:16',
    ratioW: 9,
    ratioH: 16,
    dims: '1080 × 1920',
    description: 'Stories & Reels — full-screen vertical',
  },
  {
    kind: 'square_1x1',
    label: 'Square feed',
    aspectRatio: '1:1',
    ratioW: 1,
    ratioH: 1,
    dims: '1080 × 1080',
    description: 'Feed posts — square format',
  },
  {
    kind: 'portrait_4x5',
    label: 'Portrait feed',
    aspectRatio: '4:5',
    ratioW: 4,
    ratioH: 5,
    dims: '1080 × 1350',
    description: 'Feed posts — portrait (most screen real estate)',
  },
  {
    kind: 'landscape_16x9',
    label: 'Landscape',
    aspectRatio: '16:9',
    ratioW: 16,
    ratioH: 9,
    dims: '1920 × 1080',
    description: 'Horizontal banner — wide display',
  },
];

// ─── Stage validation — 5-step contract ──────────────────────────────────────

export interface StageValidation {
  valid: boolean;
  errors: string[];
}

// ── Step 1: Media ─────────────────────────────────────────────────────────────

export function validateMediaStage(campaign: Partial<AdCampaign>): StageValidation {
  const errors: string[] = [];
  const paths = campaign.mediaObjectPaths ?? [];
  const kind = campaign.mediaKind;

  if (paths.length === 0) {
    errors.push('Upload at least one photo or one video');
  } else if (kind === 'video' && paths.length > 1) {
    errors.push('Video campaigns support exactly one video');
  } else if (kind === 'photos' && paths.length > MAX_PHOTOS) {
    errors.push(`Photo campaigns support at most ${MAX_PHOTOS} photos`);
  }

  return { valid: errors.length === 0, errors };
}

// ── Step 2: Description (headline + optional description) ─────────────────────

export function validateDescriptionStage(campaign: Partial<AdCampaign>): StageValidation {
  const errors: string[] = [];

  if (!campaign.headline?.trim()) {
    errors.push('Enter a headline');
  }

  return { valid: errors.length === 0, errors };
}

// ── Step 3: CTA (call-to-action + optional product destination) ───────────────

export function validateCtaStage(campaign: Partial<AdCampaign>): StageValidation {
  const errors: string[] = [];

  if (!campaign.ctaKind) {
    errors.push('Choose a call-to-action');
  }
  if (campaign.ctaKind && ['shop_now', 'view_product'].includes(campaign.ctaKind)) {
    if (!campaign.ctaDestinationId) {
      errors.push('Select a product for this call-to-action');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Step 4: Output format ─────────────────────────────────────────────────────

export function validateFormatStage(campaign: Partial<AdCampaign>): StageValidation {
  const errors: string[] = [];
  const formats = campaign.formats ?? [];

  if (formats.length === 0) {
    errors.push('Select at least one ad format');
  }

  return { valid: errors.length === 0, errors };
}

// ── Step 5: Budget & duration ─────────────────────────────────────────────────

export function validateBudgetStage(campaign: Partial<AdCampaign>): StageValidation {
  const errors: string[] = [];

  if (!campaign.budgetCents || campaign.budgetCents < BUDGET_MIN_CENTS) {
    errors.push('Set a valid budget');
  }
  if (!campaign.durationDays || campaign.durationDays < DURATION_MIN_DAYS) {
    errors.push('Set a valid duration');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Legacy aliases (kept for backward-compatible tests) ─────────────────────

/**
 * @deprecated Use validateCtaStage. This alias validates CTA + product destination
 * (the old "Details" stage merged CTA into it).
 */
export function validateDetailsStage(campaign: Partial<AdCampaign>): StageValidation {
  // Legacy: headline was part of this; keep headline check for existing tests.
  const errors: string[] = [];

  if (!campaign.headline?.trim()) {
    errors.push('Enter a headline');
  }
  if (!campaign.ctaKind) {
    errors.push('Choose a call-to-action');
  }
  if (campaign.ctaKind && ['shop_now', 'view_product'].includes(campaign.ctaKind)) {
    if (!campaign.ctaDestinationId) {
      errors.push('Select a product for this call-to-action');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @deprecated Use validateFormatStage + validateBudgetStage. This alias
 * validates formats + budget + duration as the old "Placement" stage did.
 */
export function validatePlacementStage(campaign: Partial<AdCampaign>): StageValidation {
  const errors: string[] = [];
  const formats = campaign.formats ?? [];

  if (formats.length === 0) {
    errors.push('Select at least one ad format');
  }
  if (!campaign.budgetCents || campaign.budgetCents < BUDGET_MIN_CENTS) {
    errors.push('Set a valid budget');
  }
  if (!campaign.durationDays || campaign.durationDays < DURATION_MIN_DAYS) {
    errors.push('Set a valid duration');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Checkout return URL ──────────────────────────────────────────────────────
// Matches isAllowedBrandthreadCallbackUrl(value, "ad_campaign_checkout"):
//   brandthread://design-campaign/?id=<uuid>&paymentReturn=1   (native/Expo)
//   https://<origin>/design-campaign?id=<uuid>&paymentReturn=1 (web)

export function buildAdCampaignReturnUrl(campaignId: string, webOrigin?: string): string {
  const params = `id=${encodeURIComponent(campaignId)}&paymentReturn=1`;
  if (webOrigin) {
    return `${webOrigin}/design-campaign?${params}`;
  }
  return `brandthread://design-campaign/?${params}`;
}

// ─── Media file validation (client-side pre-check) ───────────────────────────

export interface MediaValidationResult {
  valid: boolean;
  error?: string;
}

export function validateImageFile(
  mimeType: string,
  sizeBytes: number,
): MediaValidationResult {
  const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']);
  if (!allowed.has(mimeType.toLowerCase())) {
    return { valid: false, error: 'Photos must be JPEG, PNG, WebP, or HEIC' };
  }
  const maxMB = 20;
  if (sizeBytes > maxMB * 1024 * 1024) {
    return { valid: false, error: `Photo must be smaller than ${maxMB} MB` };
  }
  return { valid: true };
}

export function validateVideoFile(
  mimeType: string,
  sizeBytes: number,
  durationSeconds?: number,
): MediaValidationResult {
  const allowed = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo']);
  if (!allowed.has(mimeType.toLowerCase())) {
    return { valid: false, error: 'Videos must be MP4 or MOV format' };
  }
  const maxMB = 500;
  if (sizeBytes > maxMB * 1024 * 1024) {
    return { valid: false, error: `Video must be smaller than ${maxMB} MB` };
  }
  if (durationSeconds !== undefined && durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    return { valid: false, error: `Video must be ${MAX_VIDEO_DURATION_SECONDS} seconds or shorter` };
  }
  return { valid: true };
}
