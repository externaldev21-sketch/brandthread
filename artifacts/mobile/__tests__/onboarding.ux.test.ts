/** Contracts updated for the approved shared, role-last launch flow. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AUTH_STEPS, DRAFT_VERSION, FIRST_PROFILE_STEP, isStepSkippable,
  profileStepsFor, restoreDraftStep, usernameSuggestions, USERNAME_RE,
} from '../lib/onboardingFlow';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const source = read('app/onboarding.tsx');
const profile = read('components/onboarding/launch/ProfileScreens.tsx');
const auth = read('components/onboarding/launch/AuthScreens.tsx');
const kit = read('components/onboarding/launch/kit.tsx');
const client = read('lib/api.ts');
const ids = (role: 'buyer' | 'seller') => profileStepsFor(role).map(s => s.id);

describe('launch onboarding order and choices', () => {
  it('keeps separate buyer and seller completion paths', () => {
    expect(ids('buyer').at(-1)).toBe('ROLE');
    expect(ids('seller').slice(-2)).toEqual(['STORE', 'STAGE']);
    expect(source).toContain("accountType: 'buyer', expectedClerkId:");
    expect(source).toContain("accountType: 'seller', expectedClerkId:");
  });
  it('collects birthday before email and account verification', () => {
    expect(AUTH_STEPS.slice(0, 4)).toEqual(['WELCOME', 'BIRTHDAY', 'EMAIL', 'CODE']);
  });
  it('asks one signed-in question per step, with no duplicates', () => {
    expect(new Set(ids('seller')).size).toBe(ids('seller').length);
    expect(source).toContain("case 'USERNAME':");
    expect(source).toContain("case 'ROLE':");
  });
  it('asks role after editable interests, brands and sizes', () => {
    expect(ids('buyer')).toEqual(['USERNAME', 'PHOTO', 'INTEREST', 'BRANDS', 'SIZES', 'NOTIFICATIONS', 'ROLE']);
  });
  it('keeps identity and seller store questions required', () => {
    for (const step of ['USERNAME', 'ROLE', 'STORE', 'STAGE'] as const) expect(isStepSkippable(step)).toBe(false);
  });
  it('offers a skip on optional personalization questions', () => {
    for (const step of ['PHOTO', 'INTEREST', 'BRANDS', 'SIZES', 'NOTIFICATIONS'] as const) expect(isStepSkippable(step)).toBe(true);
  });
  it('loads real brand choices instead of demo fixtures', () => {
    expect(profile).toContain('discoverBrands(60)');
    expect(profile).not.toMatch(/DEMO_BRANDS|demoBrands/);
  });
  it('only suggests usernames the backend format accepts', () => {
    const suggestions = usernameSuggestions({ firstName: 'A', lastName: "O'Neil", email: 'a@example.test' }, '1234');
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) expect(USERNAME_RE.test(suggestion)).toBe(true);
  });
});

describe('launch identity, persistence and completion', () => {
  it('restores only the current signed-in draft schema', () => {
    expect(restoreDraftStep({ version: DRAFT_VERSION, step: 'PHOTO' }, true)).toBe('PHOTO');
    expect(restoreDraftStep({ version: DRAFT_VERSION - 1, step: 'PHOTO' }, true)).toBe(FIRST_PROFILE_STEP);
  });
  it('never resumes a signed-in draft without a session', () => {
    expect(restoreDraftStep({ version: DRAFT_VERSION, step: 'ROLE' }, false)).toBe('WELCOME');
  });
  it('checks draft ownership before restoring answers', () => {
    expect(source).toContain('draft && draft.ownerId === user.id');
    expect(source).toContain('ownerId: user!.id');
  });
  it('supports additional fields only when Clerk requires them', () => {
    expect(source).toContain("missing.includes('password')");
    expect(source).toContain('needsPassword={needs.password}');
    expect(auth).not.toContain('Confirm password');
  });
  it('keeps Google and Apple authentication available', () => {
    expect(source).toContain('APPLE_OAUTH_STRATEGY');
    expect(source).toContain("'oauth_google'");
  });
  it('submits pending age before completing either role', () => {
    const buyer = source.slice(source.indexOf('async function finishBuyer'), source.indexOf('async function finishSeller'));
    const seller = source.slice(source.indexOf('async function finishSeller'), source.indexOf('async function markComplete'));
    expect(buyer.indexOf('await submitPendingAge(api)')).toBeLessThan(buyer.indexOf('await api.auth.updateProfile'));
    expect(seller.indexOf('await submitPendingAge(api)')).toBeLessThan(seller.indexOf('await api.auth.completeOnboarding'));
  });
  it('keeps referral attribution bound to the synced account', () => {
    expect(source).toContain('api.referrals.apply(referralCode, profile.clerkId)');
  });
  it('saves buyer preferences then opens the Threads explainer', () => {
    expect(source).toContain('await syncBuyerOnboarding(profile.clerkId, styleInterests, api)');
    expect(source).toContain("router.replace('/thread-explainer' as never)");
  });
  it('finishes the seller account before opening store setup, without charging a plan', () => {
    expect(source).toContain("await api.auth.completeOnboarding('seller')");
    expect(source).toContain("router.push('/store-setup-brand' as never)");
    expect(source).not.toContain('trial.start(');
  });
  it('requests notifications only through the optional explicit action', () => {
    expect(source).toContain('onTurnOn={() => { void turnOnNotifications(); }}');
    expect(source).toContain("onSkip={() => advance('NOTIFICATIONS')}");
  });
});

describe('shared app capabilities retained alongside the new first-run UI', () => {
  it('retains the server-budgeted logo sample and logo persistence APIs', () => {
    expect(client).toContain('onboardingSample: (brandName: string, style: string, deviceId?: string)');
    expect(client).toContain('uploadLogo: (image:');
  });
  it('keeps system fonts, keyboard clearance and plain action labels', () => {
    expect(kit).toContain('<KeyboardAvoidingView');
    expect(kit).not.toContain('Inter_');
    expect([kit, auth, profile].join('\n')).not.toContain('Build my workspace');
  });
});
