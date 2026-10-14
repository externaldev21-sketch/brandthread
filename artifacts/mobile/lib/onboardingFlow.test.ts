import { describe, expect, it } from 'vitest';
import {
  BUYER_FLOW_STEPS,
  BUYER_STEP_INDEX,
  DRAFT_VERSION,
  SELLER_FLOW_STEPS,
  SELLER_STEP_INDEX,
  canGoBack,
  clampStep,
  isStepSkippable,
  nextStepIndex,
  prevStepIndex,
  restoreDraftStep,
  stepCounterFor,
  totalStepsFor,
} from './onboardingFlow';

describe('step sequencing', () => {
  it('starts both flows on one Sign up screen, then Profile', () => {
    expect(BUYER_STEP_INDEX.SIGN_UP).toBe(0);
    expect(BUYER_STEP_INDEX.PROFILE).toBe(1);
    expect(SELLER_STEP_INDEX.SIGN_UP).toBe(0);
    expect(SELLER_STEP_INDEX.STORE).toBe(1);
  });

  it('buyer: Brands, then Sizes, then Notifications', () => {
    expect(BUYER_STEP_INDEX.BRANDS).toBe(2);
    expect(BUYER_STEP_INDEX.SIZES).toBe(3);
    expect(BUYER_STEP_INDEX.NOTIFICATIONS).toBe(4);
  });

  it('seller: Store, What do you sell, First product, Payouts', () => {
    expect(SELLER_STEP_INDEX.CATEGORIES).toBe(2);
    expect(SELLER_STEP_INDEX.PRODUCT).toBe(3);
    expect(SELLER_STEP_INDEX.PAYOUTS).toBe(4);
  });

  it('every step id in each flow is unique and total counts match the arrays', () => {
    expect(new Set(BUYER_FLOW_STEPS.map((s) => s.id)).size).toBe(BUYER_FLOW_STEPS.length);
    expect(new Set(SELLER_FLOW_STEPS.map((s) => s.id)).size).toBe(SELLER_FLOW_STEPS.length);
    expect(totalStepsFor('buyer')).toBe(BUYER_FLOW_STEPS.length);
    expect(totalStepsFor('seller')).toBe(SELLER_FLOW_STEPS.length);
  });

  it('counts steps after Sign up as "01 / NN" and shows no counter on Sign up', () => {
    expect(stepCounterFor('buyer', 0)).toBeNull();
    expect(stepCounterFor('buyer', BUYER_STEP_INDEX.PROFILE)).toEqual({ current: 1, total: 4 });
    expect(stepCounterFor('buyer', BUYER_STEP_INDEX.NOTIFICATIONS)).toEqual({ current: 4, total: 4 });
    expect(stepCounterFor('seller', SELLER_STEP_INDEX.PAYOUTS)).toEqual({ current: 4, total: 4 });
  });
});

describe('skip rules', () => {
  it('account creation and identity are not skippable', () => {
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.SIGN_UP)).toBe(false);
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.PROFILE)).toBe(false);
    expect(isStepSkippable('seller', SELLER_STEP_INDEX.STORE)).toBe(false);
  });

  it('everything after the account and its name is skippable', () => {
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.BRANDS)).toBe(true);
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.SIZES)).toBe(true);
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.NOTIFICATIONS)).toBe(true);
    expect(isStepSkippable('seller', SELLER_STEP_INDEX.CATEGORIES)).toBe(true);
    expect(isStepSkippable('seller', SELLER_STEP_INDEX.PRODUCT)).toBe(true);
    expect(isStepSkippable('seller', SELLER_STEP_INDEX.PAYOUTS)).toBe(true);
  });

  it('out-of-range indices are treated as not skippable', () => {
    expect(isStepSkippable('buyer', 999)).toBe(false);
    expect(isStepSkippable('buyer', -1)).toBe(false);
  });
});

describe('back navigation and clamping', () => {
  it('canGoBack is false only at the first step', () => {
    expect(canGoBack(0)).toBe(false);
    expect(canGoBack(1)).toBe(true);
  });

  it('prevStepIndex never goes below 0', () => {
    expect(prevStepIndex('buyer', 0)).toBe(0);
    expect(prevStepIndex('buyer', 1)).toBe(0);
  });

  it('nextStepIndex never exceeds the last step', () => {
    const last = totalStepsFor('seller') - 1;
    expect(nextStepIndex('seller', last)).toBe(last);
    expect(nextStepIndex('seller', last - 1)).toBe(last);
  });

  it('clampStep clamps both directions', () => {
    expect(clampStep('buyer', -5)).toBe(0);
    expect(clampStep('buyer', 999)).toBe(totalStepsFor('buyer') - 1);
  });
});

describe('draft migration / resumption', () => {
  it('is a no-op for the current draft version', () => {
    expect(DRAFT_VERSION).toBe(10);
    expect(restoreDraftStep('buyer', BUYER_STEP_INDEX.SIZES, DRAFT_VERSION)).toBe(BUYER_STEP_INDEX.SIZES);
    expect(restoreDraftStep('seller', SELLER_STEP_INDEX.PRODUCT, DRAFT_VERSION)).toBe(SELLER_STEP_INDEX.PRODUCT);
  });

  it('migrates a v8 buyer draft onto the nearest surviving step', () => {
    // v8: 0=Welcome 1=AccountType 2=Auth 3=Name 4=Style 5=Sizes 6=Brands 7=Loading 8=Notifications 9=Success
    expect(restoreDraftStep('buyer', 0, 8)).toBe(BUYER_STEP_INDEX.SIGN_UP);
    expect(restoreDraftStep('buyer', 2, 8)).toBe(BUYER_STEP_INDEX.SIGN_UP);
    expect(restoreDraftStep('buyer', 3, 8)).toBe(BUYER_STEP_INDEX.PROFILE);
    expect(restoreDraftStep('buyer', 4, 8)).toBe(BUYER_STEP_INDEX.BRANDS);
    expect(restoreDraftStep('buyer', 5, 8)).toBe(BUYER_STEP_INDEX.SIZES);
    expect(restoreDraftStep('buyer', 6, 8)).toBe(BUYER_STEP_INDEX.BRANDS);
    expect(restoreDraftStep('buyer', 7, 8)).toBe(BUYER_STEP_INDEX.NOTIFICATIONS);
    expect(restoreDraftStep('buyer', 9, 8)).toBe(BUYER_STEP_INDEX.NOTIFICATIONS);
  });

  it('migrates a v9 seller draft: Profile and store name become Store, Notifications resumes on Categories', () => {
    // v9 seller: 0=SignUp 1=Profile 2=BrandName 3=Notifications
    expect(restoreDraftStep('seller', 0, 9)).toBe(SELLER_STEP_INDEX.SIGN_UP);
    expect(restoreDraftStep('seller', 1, 9)).toBe(SELLER_STEP_INDEX.STORE);
    expect(restoreDraftStep('seller', 2, 9)).toBe(SELLER_STEP_INDEX.STORE);
    expect(restoreDraftStep('seller', 3, 9)).toBe(SELLER_STEP_INDEX.CATEGORIES);
    expect(restoreDraftStep('buyer', 3, 9)).toBe(BUYER_STEP_INDEX.SIZES);
  });

  it('migrates a v8 seller draft', () => {
    // v8: 3=Name 4=BrandName 5=BrandStage 6=Goals 7=Plan 8=Loading 9=Notifications 10=Success
    expect(restoreDraftStep('seller', 1, 8)).toBe(SELLER_STEP_INDEX.SIGN_UP);
    expect(restoreDraftStep('seller', 3, 8)).toBe(SELLER_STEP_INDEX.STORE);
    expect(restoreDraftStep('seller', 4, 8)).toBe(SELLER_STEP_INDEX.STORE);
    expect(restoreDraftStep('seller', 6, 8)).toBe(SELLER_STEP_INDEX.CATEGORIES);
    expect(restoreDraftStep('seller', 10, 8)).toBe(SELLER_STEP_INDEX.CATEGORIES);
  });

  it('migrates v7 drafts through v8', () => {
    // v7 buyer: 3=Name 4=Style 5=Brands 6=Loading
    expect(restoreDraftStep('buyer', 3, 7)).toBe(BUYER_STEP_INDEX.PROFILE);
    expect(restoreDraftStep('buyer', 5, 7)).toBe(BUYER_STEP_INDEX.BRANDS);
    expect(restoreDraftStep('buyer', 6, 7)).toBe(BUYER_STEP_INDEX.NOTIFICATIONS);
    expect(restoreDraftStep('seller', 4, 7)).toBe(SELLER_STEP_INDEX.STORE);
  });

  it('migrates v6 and v5 drafts all the way through', () => {
    // v6 buyer: AccountType=0, Auth=1, Name=2, Style=3
    expect(restoreDraftStep('buyer', 0, 6)).toBe(BUYER_STEP_INDEX.SIGN_UP);
    expect(restoreDraftStep('buyer', 2, 6)).toBe(BUYER_STEP_INDEX.PROFILE);
    expect(restoreDraftStep('buyer', 3, 6)).toBe(BUYER_STEP_INDEX.BRANDS);
    expect(restoreDraftStep('seller', 3, 6)).toBe(SELLER_STEP_INDEX.STORE);
    // v5 buyer: 0=Auth, 1=AccountType, 2=Name
    expect(restoreDraftStep('buyer', 0, 5)).toBe(BUYER_STEP_INDEX.SIGN_UP);
    expect(restoreDraftStep('buyer', 2, 5)).toBe(BUYER_STEP_INDEX.PROFILE);
  });

  it('falls back to Sign up for an unrecognized legacy step', () => {
    expect(restoreDraftStep('buyer', 999, 5)).toBe(BUYER_STEP_INDEX.SIGN_UP);
    expect(restoreDraftStep('seller', 999, undefined)).toBe(SELLER_STEP_INDEX.SIGN_UP);
  });

  it('treats a missing version as the oldest legacy shape without throwing', () => {
    expect(() => restoreDraftStep('buyer', 0, undefined)).not.toThrow();
    expect(() => restoreDraftStep('seller', 0, undefined)).not.toThrow();
  });
});
