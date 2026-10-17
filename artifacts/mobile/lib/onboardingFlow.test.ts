import { describe, expect, it } from 'vitest';
import {
  AUTH_STEPS,
  DRAFT_VERSION,
  FIRST_PROFILE_STEP,
  isAuthStep,
  isStepSkippable,
  nextProfileStep,
  normalizeUsernameInput,
  prevProfileStep,
  profileStepsFor,
  progressFor,
  restoreDraftStep,
  usernameFormatError,
  usernameSuggestions,
} from './onboardingFlow';

describe('launch onboarding step order', () => {
  it('asks Shop or Sell last, and only sellers get the store steps', () => {
    expect(profileStepsFor('buyer').map((s) => s.id)).toEqual([
      'USERNAME', 'PHOTO', 'INTEREST', 'BRANDS', 'SIZES', 'NOTIFICATIONS', 'ROLE',
    ]);
    expect(profileStepsFor(null)).toEqual(profileStepsFor('buyer'));
    expect(profileStepsFor('seller').map((s) => s.id).slice(-3)).toEqual(['ROLE', 'STORE', 'STAGE']);
  });

  it('lets the optional steps be skipped and nothing else', () => {
    expect(['PHOTO', 'INTEREST', 'BRANDS', 'SIZES', 'NOTIFICATIONS'].every((id) => isStepSkippable(id as never))).toBe(true);
    expect(['USERNAME', 'ROLE', 'STORE', 'STAGE', 'WELCOME', 'EMAIL'].some((id) => isStepSkippable(id as never))).toBe(false);
  });

  it('walks forward and back without leaving the signed-in part', () => {
    expect(nextProfileStep('USERNAME', null)).toBe('PHOTO');
    expect(nextProfileStep('ROLE', 'buyer')).toBeNull();
    expect(nextProfileStep('ROLE', 'seller')).toBe('STORE');
    expect(nextProfileStep('STAGE', 'seller')).toBeNull();
    expect(prevProfileStep('USERNAME', null)).toBeNull();
    expect(prevProfileStep('PHOTO', null)).toBe('USERNAME');
  });

  it('keeps sign-up screens out of the progress bar', () => {
    for (const id of AUTH_STEPS) {
      expect(isAuthStep(id)).toBe(true);
      expect(progressFor(id, null)).toBeUndefined();
    }
    expect(progressFor('USERNAME', 'buyer')).toBeCloseTo(1 / 7);
    expect(progressFor('ROLE', 'buyer')).toBe(1);
    expect(progressFor('STAGE', 'seller')).toBe(1);
  });
});

describe('draft restore', () => {
  it('signed-out users always start at Welcome', () => {
    expect(restoreDraftStep({ version: DRAFT_VERSION, step: 'BRANDS' }, false)).toBe('WELCOME');
  });

  it('resumes a v9 draft at its step', () => {
    expect(restoreDraftStep({ version: DRAFT_VERSION, step: 'SIZES' }, true)).toBe('SIZES');
    expect(restoreDraftStep({ version: DRAFT_VERSION, step: 'STAGE' }, true)).toBe('STAGE');
  });

  it('starts older or broken drafts again at Username (the account already exists)', () => {
    expect(restoreDraftStep({ version: 8, step: 4 }, true)).toBe(FIRST_PROFILE_STEP);
    expect(restoreDraftStep({ version: DRAFT_VERSION, step: 'EMAIL' }, true)).toBe(FIRST_PROFILE_STEP);
    expect(restoreDraftStep(null, true)).toBe(FIRST_PROFILE_STEP);
  });
});

describe('usernames', () => {
  it('normalizes typing the way the server stores it', () => {
    expect(normalizeUsernameInput('Sam Lee!')).toBe('sam_lee');
    expect(normalizeUsernameInput('x'.repeat(40))).toHaveLength(30);
  });

  it('explains format problems inline (Depop copy)', () => {
    expect(usernameFormatError('')).toBe('');
    expect(usernameFormatError('ab')).toBe('Username must be at least 3 characters.');
    expect(usernameFormatError('sam_lee')).toBe('');
  });

  it('suggests valid handles from name and email, no duplicates', () => {
    const list = usernameSuggestions({ firstName: 'Sam', lastName: 'Lee', email: 'sam.lee@example.com' }, '42');
    expect(list).toEqual(['samlee', 'sam_lee', 'samlee42', 'sam42']);
    expect(usernameSuggestions({ email: 'a@b.co' }, '42')).toEqual(['a42']);
    expect(usernameSuggestions({}, '42')).toEqual([]);
  });
});
