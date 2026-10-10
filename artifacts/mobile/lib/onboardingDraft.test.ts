import { describe, expect, it } from 'vitest';
import { parseDraft, resolveResumeStep, sanitizeDraftForStorage, userDraftKey, type OnboardingDraft } from './onboardingDraft';

const base: OnboardingDraft = {
  version: 9, flow: 'buyer', stepId: 'BIRTHDAY', authMethod: 'email', accountCreated: false, ownerId: null,
  email: 'mila@x.co', firstName: '', lastName: '', username: '', dob: null, referralCode: '', photoUri: null,
  styleInterests: [], survey: null, brandName: '', brandStage: '', goals: [], country: 'US', selectedThemeId: 'monochrome',
};

describe('sanitizeDraftForStorage', () => {
  it('drops secrets even if a caller passes them', () => {
    const clean = sanitizeDraftForStorage({ ...base, password: 'hunter22', code: '123456' } as OnboardingDraft);
    const json = JSON.stringify(clean);
    expect(json).not.toContain('hunter22');
    expect(json).not.toContain('123456');
  });
  it('keeps the birthday only until the account exists', () => {
    expect(sanitizeDraftForStorage({ ...base, dob: '1995-01-01' }).dob).toBe('1995-01-01');
    expect(sanitizeDraftForStorage({ ...base, dob: '1995-01-01', accountCreated: true }).dob).toBeNull();
  });
});

describe('parseDraft', () => {
  it('rejects junk', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft('{oops')).toBeNull();
    expect(parseDraft(JSON.stringify({ flow: 'admin' }))).toBeNull();
  });
  it('reads a v9 draft', () => {
    const d = parseDraft(JSON.stringify({ ...base, stepId: 'CODE' }))!;
    expect(d.stepId).toBe('CODE');
    expect(d.email).toBe('mila@x.co');
    expect(d.accountCreated).toBe(false);
  });
  it('treats an old (v8) per-user draft as belonging to an existing account', () => {
    const d = parseDraft(JSON.stringify({ version: 8, flow: 'seller', step: 4, brandName: 'Noir', ownerId: 'u1' }))!;
    expect(d.stepId).toBe('BRAND_NAME');
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
    expect(resolveResumeStep({ ...base, stepId: 'GOALS' }, pending)).toBe('GOALS');
  });
  it('returns to the code screen while the sign-up is still open in Clerk', () => {
    expect(resolveResumeStep({ ...base, stepId: 'CODE' }, pending)).toBe('CODE');
  });
  it('restarts at email when Clerk no longer has the sign-up', () => {
    expect(resolveResumeStep({ ...base, stepId: 'CODE' }, { ...pending, signUpPending: false })).toBe('EMAIL');
  });
  it('asks for the password again after it, because it is never stored', () => {
    expect(resolveResumeStep({ ...base, stepId: 'TERMS' }, { ...pending, emailVerified: true })).toBe('PASSWORD');
    expect(resolveResumeStep({ ...base, stepId: 'BIRTHDAY' }, { ...pending, emailVerified: true })).toBe('PASSWORD');
  });
  it('Apple/Google resume at terms only with a birthday on file', () => {
    const apple = { ...base, authMethod: 'apple' as const };
    expect(resolveResumeStep({ ...apple, stepId: 'TERMS', dob: '1990-02-02' }, pending)).toBe('TERMS');
    expect(resolveResumeStep({ ...apple, stepId: 'TERMS' }, pending)).toBe('BIRTHDAY');
  });
  it('with a session, skips account steps and keeps profile steps', () => {
    const ready = { accountReady: true, signUpPending: false, emailVerified: false };
    expect(resolveResumeStep({ ...base, stepId: 'TERMS' }, ready)).toBe('NAME');
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
