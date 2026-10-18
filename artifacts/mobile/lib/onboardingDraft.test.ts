import { describe, expect, it } from 'vitest';
import { parseDraft, resolveResumeStep, sanitizeDraftForStorage, userDraftKey, type OnboardingDraft } from './onboardingDraft';
import { DRAFT_VERSION } from './onboardingFlow';

const base: OnboardingDraft = {
  version: DRAFT_VERSION, flow: 'buyer', stepId: 'BIRTHDAY', authMethod: 'email', accountCreated: false, ownerId: null,
  email: 'mila@x.co', firstName: '', lastName: '', username: '', dob: '1995-01-01', referralCode: '', photoUri: null,
  styleInterests: [], survey: null, brandName: '', brandStage: '', goals: [], country: 'US', selectedThemeId: 'monochrome',
};

describe('sanitizeDraftForStorage', () => {
  it('drops secrets even if a caller passes them', () => {
    const clean = sanitizeDraftForStorage({ ...base, password: 'hunter22', code: '123456' } as OnboardingDraft);
    const json = JSON.stringify(clean);
    expect(json).not.toContain('hunter22');
    expect(json).not.toContain('123456');
  });
  it('keeps the birthday through account activation until the age request succeeds', () => {
    expect(sanitizeDraftForStorage({ ...base, dob: '1995-01-01' }).dob).toBe('1995-01-01');
    expect(sanitizeDraftForStorage({ ...base, dob: '1995-01-01', accountCreated: true }).dob).toBe('1995-01-01');
    expect(sanitizeDraftForStorage({ ...base, dob: null, accountCreated: true }).dob).toBeNull();
  });
});

describe('parseDraft', () => {
  it('rejects junk', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft('{oops')).toBeNull();
    expect(parseDraft(JSON.stringify({ flow: 'admin' }))).toBeNull();
  });
  it('reads a current draft', () => {
    const d = parseDraft(JSON.stringify({ ...base, stepId: 'CODE' }))!;
    expect(d.stepId).toBe('CODE');
    expect(d.email).toBe('mila@x.co');
    expect(d.accountCreated).toBe(false);
  });
  it('treats an old (v8) per-user draft as belonging to an existing account', () => {
    const d = parseDraft(JSON.stringify({ version: 8, flow: 'seller', step: 4, brandName: 'Noir', ownerId: 'u1' }))!;
    expect(d.stepId).toBe('USERNAME');
    expect(d.accountCreated).toBe(true);
    expect(d.brandName).toBe('Noir');
  });
  it('ignores a malformed birthday', () => {
    expect(parseDraft(JSON.stringify({ ...base, dob: '01/01/1995' }))!.dob).toBeNull();
  });
});

describe('resolveResumeStep', () => {
  const pending = { accountReady: false, signUpPending: true, emailVerified: false };

  it('returns to the same question before the account steps', () => {
    expect(resolveResumeStep({ ...base, stepId: 'BIRTHDAY' }, pending)).toBe('BIRTHDAY');
  });
  it('returns to the code screen while the sign-up is still open in Clerk', () => {
    expect(resolveResumeStep({ ...base, stepId: 'CODE' }, pending)).toBe('CODE');
  });
  it('restarts at email when Clerk no longer has the sign-up', () => {
    expect(resolveResumeStep({ ...base, stepId: 'CODE' }, { ...pending, signUpPending: false })).toBe('EMAIL');
  });
  it('resumes verified signup at required details without restoring a password', () => {
    expect(resolveResumeStep({ ...base, stepId: 'DETAILS' }, { ...pending, emailVerified: true })).toBe('DETAILS');
    expect(resolveResumeStep({ ...base, stepId: 'CODE' }, { ...pending, emailVerified: true })).toBe('DETAILS');
  });
  it('Apple/Google resume required details only with a birthday on file', () => {
    const apple = { ...base, authMethod: 'apple' as const };
    expect(resolveResumeStep({ ...apple, stepId: 'DETAILS', dob: '1990-02-02' }, pending)).toBe('DETAILS');
    expect(resolveResumeStep({ ...apple, stepId: 'DETAILS', dob: null }, pending)).toBe('BIRTHDAY');
  });
  it('with a session, skips account steps and keeps profile steps', () => {
    const ready = { accountReady: true, signUpPending: false, emailVerified: false };
    expect(resolveResumeStep({ ...base, stepId: 'DETAILS' }, ready)).toBe('USERNAME');
    expect(resolveResumeStep({ ...base, stepId: 'PHOTO' }, ready)).toBe('PHOTO');
  });
  it('profile steps without a session go back to email', () => {
    expect(resolveResumeStep({ ...base, stepId: 'USERNAME' }, pending)).toBe('EMAIL');
  });
});

describe('userDraftKey', () => {
  it('needs a user id', () => {
    expect(userDraftKey(null)).toBeNull();
    expect(userDraftKey('user_1')).toBe('onboarding_draft:user_1');
  });
});
