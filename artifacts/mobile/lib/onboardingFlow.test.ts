import { describe, expect, it } from 'vitest';
import {
  BUYER_STEPS,
  DRAFT_VERSION,
  SELLER_STEPS,
  isStepSkippable,
  nextStepId,
  prevStepId,
  progressFraction,
  restoreDraftStepId,
  stepsFor,
  type FlowContext,
} from './onboardingFlow';

const signedOutEmail: FlowContext = { accountReady: false, authMethod: 'email' };
const signedOutApple: FlowContext = { accountReady: false, authMethod: 'apple' };
const signedIn: FlowContext = { accountReady: true, authMethod: 'email' };

describe('step order', () => {
  it('asks buyer or seller first, right after the Welcome opener', () => {
    expect(BUYER_STEPS.slice(0, 2)).toEqual(['WELCOME', 'ACCOUNT_TYPE']);
    expect(SELLER_STEPS.slice(0, 2)).toEqual(['WELCOME', 'ACCOUNT_TYPE']);
  });

  it('buyer follows Instagram: email, code, password, birthday, terms, name, username, photo, welcome, then styles and brands', () => {
    expect(stepsFor('buyer', signedOutEmail)).toEqual([
      'WELCOME', 'ACCOUNT_TYPE', 'EMAIL', 'CODE', 'PASSWORD', 'BIRTHDAY', 'TERMS',
      'NAME', 'USERNAME', 'PHOTO', 'WELCOME_USER', 'STYLE', 'SIZES', 'BRANDS',
    ]);
  });

  it('buyer onboarding ends with picking styles and following brands', () => {
    expect(BUYER_STEPS.slice(-3)).toEqual(['STYLE', 'SIZES', 'BRANDS']);
  });

  it('seller follows Shopify: questions and location before the account, store preview last', () => {
    expect(stepsFor('seller', signedOutEmail)).toEqual([
      'WELCOME', 'ACCOUNT_TYPE', 'STAGE', 'GOALS', 'LOCATION',
      'EMAIL', 'CODE', 'PASSWORD', 'BIRTHDAY', 'TERMS',
      'NAME', 'BRAND_NAME', 'USERNAME', 'BUILDING',
    ]);
  });

  it('has no payout, plan or notification step during sign-up', () => {
    for (const id of [...BUYER_STEPS, ...SELLER_STEPS] as string[]) {
      expect(['PAYOUTS', 'PLAN', 'NOTIFICATIONS']).not.toContain(id);
    }
  });

  it('Apple/Google skip the code and password but still ask birthday and terms first', () => {
    const steps = stepsFor('buyer', signedOutApple);
    expect(steps).not.toContain('CODE');
    expect(steps).not.toContain('PASSWORD');
    expect(steps.indexOf('BIRTHDAY')).toBeLessThan(steps.indexOf('TERMS'));
    expect(steps.indexOf('TERMS')).toBeLessThan(steps.indexOf('NAME'));
  });

  it('a signed-in account sees no account steps at all', () => {
    for (const flow of ['buyer', 'seller'] as const) {
      const steps = stepsFor(flow, signedIn);
      for (const id of ['EMAIL', 'CODE', 'PASSWORD', 'BIRTHDAY', 'TERMS'] as const) expect(steps).not.toContain(id);
    }
  });
});

describe('navigation', () => {
  it('next and previous follow the visible steps', () => {
    expect(nextStepId('buyer', 'EMAIL', signedOutEmail)).toBe('CODE');
    expect(nextStepId('buyer', 'EMAIL', signedOutApple)).toBe('BIRTHDAY');
    expect(prevStepId('buyer', 'BIRTHDAY', signedOutEmail)).toBe('PASSWORD');
    expect(prevStepId('buyer', 'BIRTHDAY', signedOutApple)).toBe('EMAIL');
    expect(nextStepId('seller', 'LOCATION', signedOutEmail)).toBe('EMAIL');
    expect(nextStepId('seller', 'LOCATION', signedIn)).toBe('NAME');
    expect(nextStepId('buyer', 'BRANDS', signedIn)).toBeNull();
  });

  it('there is no way back into the account steps once the account exists', () => {
    expect(prevStepId('buyer', 'NAME', signedIn)).toBeNull();
    expect(prevStepId('seller', 'NAME', signedIn)).toBeNull();
    expect(prevStepId('seller', 'BRAND_NAME', signedIn)).toBe('NAME');
  });

  it('Welcome has no back', () => {
    expect(prevStepId('buyer', 'WELCOME', signedOutEmail)).toBeNull();
  });

  it('only the questions, photo and personalization steps can be skipped', () => {
    for (const id of ['STAGE', 'GOALS', 'PHOTO', 'STYLE', 'SIZES', 'BRANDS'] as const) expect(isStepSkippable(id)).toBe(true);
    for (const id of ['EMAIL', 'CODE', 'PASSWORD', 'BIRTHDAY', 'TERMS', 'NAME', 'USERNAME', 'BRAND_NAME'] as const) expect(isStepSkippable(id)).toBe(false);
  });

  it('progress grows step by step', () => {
    const a = progressFraction('seller', 'STAGE', signedOutEmail);
    const b = progressFraction('seller', 'GOALS', signedOutEmail);
    const c = progressFraction('seller', 'LOCATION', signedOutEmail);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(progressFraction('seller', 'BUILDING', signedOutEmail)).toBe(1);
  });
});

describe('draft migration', () => {
  it('v9 drafts keep their step id', () => {
    expect(restoreDraftStepId('buyer', { version: DRAFT_VERSION, stepId: 'PHOTO' })).toBe('PHOTO');
    expect(restoreDraftStepId('seller', { version: DRAFT_VERSION, stepId: 'LOCATION' })).toBe('LOCATION');
  });

  it('a v9 step id that does not exist in the flow falls back through the legacy path', () => {
    expect(restoreDraftStepId('buyer', { version: DRAFT_VERSION, stepId: 'BUILDING' })).toBe('ACCOUNT_TYPE');
  });

  it('v8 index drafts (always signed in) map onto the new ids', () => {
    // v8 buyer: 0 Welcome, 1 AccountType, 2 Auth, 3 Name, 4 Style, 5 Sizes, 6 Brands, 7 Loading, 8 Notifications, 9 Success
    expect(restoreDraftStepId('buyer', { version: 8, step: 2 })).toBe('NAME');
    expect(restoreDraftStepId('buyer', { version: 8, step: 4 })).toBe('STYLE');
    expect(restoreDraftStepId('buyer', { version: 8, step: 8 })).toBe('BRANDS');
    // v8 seller: 4 BrandName, 5 BrandStage, 6 Goals, 7 Plan … 10 Success
    expect(restoreDraftStepId('seller', { version: 8, step: 4 })).toBe('BRAND_NAME');
    expect(restoreDraftStepId('seller', { version: 8, step: 5 })).toBe('STAGE');
    expect(restoreDraftStepId('seller', { version: 8, step: 7 })).toBe('BUILDING');
  });

  it('v7 and older drafts still migrate (v7 buyer Brands was index 5)', () => {
    expect(restoreDraftStepId('buyer', { version: 7, step: 5 })).toBe('BRANDS');
    expect(restoreDraftStepId('seller', { version: 6, step: 3 })).toBe('BRAND_NAME');
  });

  it('garbage falls back to the buyer/seller question', () => {
    expect(restoreDraftStepId('buyer', {})).toBe('ACCOUNT_TYPE');
    expect(restoreDraftStepId('seller', { step: 'x' })).toBe('ACCOUNT_TYPE');
  });
});
