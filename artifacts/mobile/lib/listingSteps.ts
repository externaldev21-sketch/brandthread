/**
 * The add-product form shown as four steps (Photos → Details → Price & sizes
 * → Publish). Each step's Next is enabled by the existing step validators in
 * lib/listingValidation.ts (the same rules handlePublish enforces), plus the
 * pre-order ship date, which lives with Sales model on Details.
 */
import {
  validateDetailsStep,
  validatePhotosStep,
  validatePricingStep,
  validateVariantsStep,
  type ListingValidationInput,
} from '@/lib/listingValidation';

export const LISTING_STEPS = ['Photos', 'Details', 'Price & sizes', 'Publish'] as const;
export type ListingStep = 0 | 1 | 2 | 3;
export const LAST_LISTING_STEP: ListingStep = 3;

export interface ListingStepInput extends ListingValidationInput {
  /** Pre-order ship date problem (lib/deliveryGuarantee preOrderShipDateError). */
  shipDateError?: string | null;
}

export function isListingStepValid(step: ListingStep, input: ListingStepInput): boolean {
  switch (step) {
    case 0: return validatePhotosStep(input).length === 0;
    case 1: return validateDetailsStep(input).length === 0 && !input.shipDateError;
    case 2: return validateVariantsStep(input).length === 0 && validatePricingStep(input).length === 0;
    case 3: return ([0, 1, 2] as const).every(s => isListingStepValid(s, input));
  }
}

/** First step that still needs something, or the last step when all are valid. */
export function firstIncompleteStep(input: ListingStepInput): ListingStep {
  for (const s of [0, 1, 2] as const) if (!isListingStepValid(s, input)) return s;
  return LAST_LISTING_STEP;
}

/**
 * Whether the indicator may jump to `target`: always backwards, and forwards
 * when editing an existing product or when every step before it is valid.
 */
export function canJumpToStep(target: ListingStep, current: ListingStep, input: ListingStepInput, editing: boolean): boolean {
  if (target <= current || editing) return true;
  for (let s = 0; s < target; s++) if (!isListingStepValid(s as ListingStep, input)) return false;
  return true;
}
