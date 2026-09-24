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
  totalStepsFor,
} from './onboardingFlow';

describe('step sequencing', () => {
  it('starts both flows at Welcome, then AccountType, then Auth, then Name', () => {
    expect(BUYER_STEP_INDEX.WELCOME).toBe(0);
    expect(BUYER_STEP_INDEX.ACCOUNT_TYPE).toBe(1);
    expect(BUYER_STEP_INDEX.AUTH).toBe(2);
    expect(BUYER_STEP_INDEX.NAME).toBe(3);
    expect(SELLER_STEP_INDEX.WELCOME).toBe(0);
    expect(SELLER_STEP_INDEX.ACCOUNT_TYPE).toBe(1);
    expect(SELLER_STEP_INDEX.AUTH).toBe(2);
    expect(SELLER_STEP_INDEX.NAME).toBe(3);
  });

  it('buyer flow inserts Brands-to-follow after Style, before Loading', () => {
    expect(BUYER_STEP_INDEX.STYLE).toBe(4);
    expect(BUYER_STEP_INDEX.BRANDS).toBe(5);
    expect(BUYER_STEP_INDEX.LOADING).toBe(6);
    expect(BUYER_STEP_INDEX.NOTIFICATIONS).toBe(7);
    expect(BUYER_STEP_INDEX.SUCCESS).toBe(8);
  });

  it('seller flow keeps BrandName/BrandStage/Goals/Plan order after Name', () => {
    expect(SELLER_STEP_INDEX.BRAND_NAME).toBe(4);
    expect(SELLER_STEP_INDEX.BRAND_STAGE).toBe(5);
    expect(SELLER_STEP_INDEX.GOALS).toBe(6);
    expect(SELLER_STEP_INDEX.PLAN).toBe(7);
    expect(SELLER_STEP_INDEX.LOADING).toBe(8);
    expect(SELLER_STEP_INDEX.NOTIFICATIONS).toBe(9);
    expect(SELLER_STEP_INDEX.SUCCESS).toBe(10);
  });

  it('every step id in each flow is unique and total counts match the arrays', () => {
    expect(new Set(BUYER_FLOW_STEPS.map((s) => s.id)).size).toBe(BUYER_FLOW_STEPS.length);
    expect(new Set(SELLER_FLOW_STEPS.map((s) => s.id)).size).toBe(SELLER_FLOW_STEPS.length);
    expect(totalStepsFor('buyer')).toBe(BUYER_FLOW_STEPS.length);
    expect(totalStepsFor('seller')).toBe(SELLER_FLOW_STEPS.length);
  });
});

describe('skip rules', () => {
  it('marks identity/account/legal-adjacent steps as not skippable', () => {
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.WELCOME)).toBe(false);
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.ACCOUNT_TYPE)).toBe(false);
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.AUTH)).toBe(false);
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.NAME)).toBe(false);
    expect(isStepSkippable('seller', SELLER_STEP_INDEX.BRAND_NAME)).toBe(false);
  });

  it('marks style picks and brand-follow as skippable', () => {
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.STYLE)).toBe(true);
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.BRANDS)).toBe(true);
  });

  it('marks notifications priming as skippable for both flows', () => {
    expect(isStepSkippable('buyer', BUYER_STEP_INDEX.NOTIFICATIONS)).toBe(true);
    expect(isStepSkippable('seller', SELLER_STEP_INDEX.NOTIFICATIONS)).toBe(true);
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
    expect(restoreDraftStep('buyer', BUYER_STEP_INDEX.STYLE, DRAFT_VERSION)).toBe(BUYER_STEP_INDEX.STYLE);
    expect(restoreDraftStep('seller', SELLER_STEP_INDEX.GOALS, DRAFT_VERSION)).toBe(SELLER_STEP_INDEX.GOALS);
  });

  it('migrates a v6 buyer draft (no Welcome/Brands) into v7 indices', () => {
    // v6: AccountType=0, Auth=1, Name=2, Style=3, Loading=4, Notifications=5, Success=6
    expect(restoreDraftStep('buyer', 0, 6)).toBe(BUYER_STEP_INDEX.ACCOUNT_TYPE);
    expect(restoreDraftStep('buyer', 1, 6)).toBe(BUYER_STEP_INDEX.AUTH);
    expect(restoreDraftStep('buyer', 3, 6)).toBe(BUYER_STEP_INDEX.STYLE);
    expect(restoreDraftStep('buyer', 4, 6)).toBe(BUYER_STEP_INDEX.LOADING);
    expect(restoreDraftStep('buyer', 6, 6)).toBe(BUYER_STEP_INDEX.SUCCESS);
  });

  it('migrates a v6 seller draft into v7 indices', () => {
    expect(restoreDraftStep('seller', 3, 6)).toBe(SELLER_STEP_INDEX.BRAND_NAME);
    expect(restoreDraftStep('seller', 6, 6)).toBe(SELLER_STEP_INDEX.PLAN);
    expect(restoreDraftStep('seller', 9, 6)).toBe(SELLER_STEP_INDEX.SUCCESS);
  });

  it('migrates a v5 draft (Auth before AccountType) through v6 into v7', () => {
    // v5 buyer: 0=Auth, 1=AccountType, 2=Name
    expect(restoreDraftStep('buyer', 0, 5)).toBe(BUYER_STEP_INDEX.AUTH);
    expect(restoreDraftStep('buyer', 1, 5)).toBe(BUYER_STEP_INDEX.ACCOUNT_TYPE);
    expect(restoreDraftStep('buyer', 2, 5)).toBe(BUYER_STEP_INDEX.NAME);
  });

  it('falls back to AccountType for an unrecognized legacy step', () => {
    expect(restoreDraftStep('buyer', 999, 5)).toBe(BUYER_STEP_INDEX.ACCOUNT_TYPE);
    expect(restoreDraftStep('seller', 999, undefined)).toBe(SELLER_STEP_INDEX.ACCOUNT_TYPE);
  });

  it('treats a missing version as the oldest legacy shape without throwing', () => {
    expect(() => restoreDraftStep('buyer', 0, undefined)).not.toThrow();
    expect(() => restoreDraftStep('seller', 0, undefined)).not.toThrow();
  });
});
