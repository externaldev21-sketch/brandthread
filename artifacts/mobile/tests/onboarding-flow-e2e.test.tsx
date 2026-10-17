/**
 * Renders the real app/onboarding.tsx (and the real launch screens under
 * components/onboarding/launch/) with react-test-renderer and drives the
 * buyer and seller paths end to end, asserting the Clerk and API calls in
 * order. react-native, Clerk and the network are mocked with small in-memory
 * stand-ins (house pattern: tests/OtpCodeInput.test.tsx); the screen's own
 * state machine, validation and finish logic are not.
 */
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => {
  const ReactRef = require('react');
  const host = (name: string) => {
    function Host(props: Record<string, unknown>) {
      return ReactRef.createElement(name, props, props.children);
    }
    Host.displayName = name;
    return Host;
  };
  const calls: string[] = [];
  const clerk = {
    listeners: new Set<() => void>(),
    signedIn: false,
    existingEmails: new Set<string>(),
    missingFields: [] as string[],
    notify() { this.listeners.forEach((fn) => fn()); },
  };
  const signUp = {
    status: 'missing_requirements',
    missingFields: [] as string[],
    create: async ({ emailAddress }: { emailAddress: string }) => {
      calls.push(`clerk.signUp.create:${emailAddress}`);
      if (clerk.existingEmails.has(emailAddress)) return { error: { errors: [{ code: 'form_identifier_exists' }] } };
      return { error: null };
    },
    verifications: {
      sendEmailCode: async () => { calls.push('clerk.signUp.sendEmailCode'); return { error: null }; },
      verifyEmailCode: async ({ code }: { code: string }) => {
        calls.push('clerk.signUp.verifyEmailCode');
        if (code !== '000000') return { error: { errors: [{ code: 'form_code_incorrect' }] } };
        signUp.missingFields = [...clerk.missingFields];
        signUp.status = signUp.missingFields.length ? 'missing_requirements' : 'complete';
        return { error: null };
      },
    },
    password: async () => {
      calls.push('clerk.signUp.password');
      signUp.missingFields = signUp.missingFields.filter((f) => f !== 'password');
      signUp.status = signUp.missingFields.length ? 'missing_requirements' : 'complete';
      return { error: null };
    },
    update: async () => ({ error: null }),
    finalize: async () => { calls.push('clerk.signUp.finalize'); clerk.signedIn = true; clerk.notify(); return { error: null }; },
  };
  const signIn = {
    status: 'needs_first_factor',
    emailCode: {
      sendCode: async () => { calls.push('clerk.signIn.sendCode'); return { error: null }; },
      verifyCode: async () => { calls.push('clerk.signIn.verifyCode'); signIn.status = 'complete'; return { error: null }; },
    },
    finalize: async () => { calls.push('clerk.signIn.finalize'); clerk.signedIn = true; clerk.notify(); return { error: null }; },
  };
  const rec = (name: string, value: unknown = {}) => async (...args: unknown[]) => { calls.push(name); (rec as any).last ??= {}; (rec as any).last[name] = args; return value; };
  const api = {
    auth: {
      sync: vi.fn(async () => { calls.push('api.auth.sync'); return { clerkId: 'user_1' }; }),
      checkUsername: vi.fn(async (u: string) => (u === 'taken' ? { available: false, error: 'Username is already taken.' } : { available: true })),
      updateProfile: vi.fn(async (body: any) => { calls.push('api.auth.updateProfile'); return { name: body.name, displayName: body.displayName, username: body.username, bio: '' }; }),
      uploadAvatar: vi.fn(async () => { calls.push('api.auth.uploadAvatar'); return { profileImageUrl: 'https://cdn/avatar.jpg' }; }),
      onboarding: vi.fn(rec('api.auth.onboarding')),
      completeOnboarding: vi.fn(rec('api.auth.completeOnboarding')),
    },
    referrals: { apply: vi.fn(rec('api.referrals.apply')) },
    ai: { brandMemoryRebuild: vi.fn(async () => ({})) },
  };
  const storage = new Map<string, string>();
  const startSSOFlow = vi.fn(async ({ strategy }: { strategy: string }) => {
    calls.push(`clerk.sso:${strategy}`);
    return { createdSessionId: 'sess_1', setActive: async () => { clerk.signedIn = true; clerk.notify(); } };
  });
  return { host, calls, clerk, signUp, signIn, api, storage, startSSOFlow, router: { replace: vi.fn(), push: vi.fn(), back: vi.fn() } };
});

vi.mock('react-native', () => ({
  View: h.host('View'),
  Text: h.host('Text'),
  TextInput: h.host('TextInput'),
  Pressable: h.host('Pressable'),
  ScrollView: h.host('ScrollView'),
  Image: h.host('Image'),
  Modal: h.host('Modal'),
  ActivityIndicator: h.host('ActivityIndicator'),
  Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@/components/KeyboardProviderCompat', () => ({ KeyboardAvoidingView: h.host('KeyboardAvoidingView') }));
vi.mock('@expo/vector-icons', () => ({ Feather: h.host('Feather'), Ionicons: h.host('Ionicons') }));
vi.mock('@/components/branding/GoogleGlyph', () => ({ default: h.host('GoogleGlyph') }));
vi.mock('expo-router', () => ({ useRouter: () => h.router, useLocalSearchParams: () => ({}) }));
vi.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'brandthread://' }));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: () => {} }));
vi.mock('expo-notifications', () => ({
  getPermissionsAsync: vi.fn(async () => ({ status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: vi.fn(async () => { h.calls.push('notifications.request'); return { status: 'granted' }; }),
}));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///me.jpg', mimeType: 'image/jpeg' }] })),
  launchCameraAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => { h.storage.set(k, v); },
    removeItem: async (k: string) => { h.storage.delete(k); },
    multiSet: async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => h.storage.set(k, v)); },
    multiRemove: async (keys: string[]) => { keys.forEach((k) => h.storage.delete(k)); },
    multiGet: async (keys: string[]) => keys.map((k) => [k, h.storage.get(k) ?? null]),
  },
}));
vi.mock('@clerk/expo', () => {
  const ReactRef = require('react');
  const useClerkTick = () => {
    const [, set] = ReactRef.useState(0);
    ReactRef.useEffect(() => {
      const fn = () => set((n: number) => n + 1);
      h.clerk.listeners.add(fn);
      return () => { h.clerk.listeners.delete(fn); };
    }, []);
  };
  return {
    useAuth: () => { useClerkTick(); return { isSignedIn: h.clerk.signedIn, isLoaded: true }; },
    useUser: () => { useClerkTick(); return { isLoaded: true, user: h.clerk.signedIn ? { id: 'user_1', firstName: 'Sam', lastName: 'Lee', primaryEmailAddress: { emailAddress: 'sam@example.com' } } : null }; },
    useSignUp: () => ({ signUp: h.signUp }),
    useSignIn: () => ({ signIn: h.signIn }),
    useSSO: () => ({ startSSOFlow: h.startSSOFlow }),
  };
});
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#FFFFFF', muted: '#C0C0C0', subtle: '#B0B0B0', border: '#333', background: '#000000', cardGlass: '#111', accent: '#FFFFFF', error: '#FFB4B4' } }),
}));
vi.mock('@/contexts/FeatureFlagContext', () => ({ useFeatureFlag: () => true }));
vi.mock('@/lib/api', () => ({ useApi: () => h.api }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn(async () => ({ clerkKeyInvalid: false })) }));
vi.mock('@/content/legal', () => ({ LEGAL_VERSION: 'test' }));
vi.mock('@/services/discoverService', () => ({
  discoverBrands: vi.fn(async () => [
    { id: 'b1', sellerId: 's1', name: 'Night Owl', brandType: null, logoUrl: null, verified: false },
    { id: 'b2', sellerId: 's2', name: 'Atelier Nine', brandType: null, logoUrl: null, verified: true },
  ]),
}));
vi.mock('@/services/socialService', () => ({
  setSellerFollowing: vi.fn(async (id: string) => { h.calls.push(`follow:${id}`); return { following: true }; }),
  hydrateMyProfileFromAccount: vi.fn(async () => ({})),
  socialKeysForUser: () => ({}),
}));
vi.mock('@/lib/buyerProfile', () => ({ DEFAULT_BUYER_PROFILE: {}, saveBuyerProfileForUser: vi.fn(async () => {}) }));
vi.mock('@/lib/contextualPushPermission', () => ({ registerGrantedPushToken: vi.fn(async () => {}) }));
vi.mock('@/lib/buyerOnboardingSync', () => ({
  queueBuyerOnboardingSync: vi.fn(async () => {}),
  syncBuyerOnboarding: vi.fn(async (_id: string, interests: string[]) => { h.calls.push(`api.syncBuyerOnboarding:${interests.join('|')}`); }),
  isRecoverableBuyerOnboardingSyncError: () => false,
}));
vi.mock('@/lib/onboardingSurvey', () => ({
  EMPTY_SURVEY: { sizes: {}, likedBrandIds: [] },
  SURVEY_SIZE_CATEGORIES: [
    { key: 'tops', label: 'Tops', options: ['S', 'M'] },
    { key: 'shoes', label: 'Shoes', options: ['9', '10'] },
  ],
  saveBuyerSurvey: vi.fn(async (_id: string, survey: any) => { h.calls.push(`api.saveBuyerSurvey:${JSON.stringify(survey)}`); return 'saved'; }),
}));
vi.mock('../app/_layout', () => ({ ONBOARDING_KEY: 'onboarding_complete', ONBOARDING_OWNER_KEY: 'onboarding_owner_id' }));

import OnboardingScreen from '../app/onboarding';

let tree: ReactTestRenderer;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const byId = (id: string): ReactTestInstance => tree.root.find((n) => n.props.testID === id && typeof n.type === 'string');
const has = (id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type === 'string').length > 0;
const press = async (id: string) => { await act(async () => { await byId(id).props.onPress(); }); await flush(); };
const type = async (id: string, text: string) => { await act(async () => { byId(id).props.onChangeText(text); }); await flush(); };
/** OtpCodeInput puts its testID on the wrapper; the real TextInput is inside. */
const enterCode = async (code: string) => {
  const input = byId('onboarding-code-input').find((n) => (n.type as unknown) === 'TextInput');
  await act(async () => { input.props.onChangeText(code); });
  await flush();
};

async function render() {
  await act(async () => { tree = create(<OnboardingScreen />); });
  await flush();
}

async function signUpWithEmail(email = 'sam@example.com') {
  expect(has('onboarding-welcome')).toBe(true);
  await press('onboarding-use-email');
  await type('onboarding-dob', '01152000');
  await press('onboarding-dob-continue');
  await type('onboarding-email-input', email);
  await press('onboarding-email-continue');
  expect(has('onboarding-code')).toBe(true);
  await enterCode('000000');
}

async function pickUsername(name = 'sam_lee') {
  expect(has('onboarding-username')).toBe(true);
  await type('onboarding-username-input', name);
  await wait(450); // live availability check (debounced)
  await press('onboarding-username-continue');
}

describe('launch onboarding (real screen, mocked Clerk + API)', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.storage.clear();
    h.clerk.signedIn = false;
    h.clerk.existingEmails.clear();
    h.clerk.missingFields = [];
    h.signUp.status = 'missing_requirements';
    h.signIn.status = 'needs_first_factor';
    h.router.replace.mockClear();
    h.router.push.mockClear();
  });
  afterEach(() => { act(() => tree?.unmount()); });

  it('buyer: email sign-up → username → photo → interest → brands → sizes → notifications → Shop', async () => {
    await render();
    await signUpWithEmail();
    expect(h.calls.slice(0, 4)).toEqual([
      'clerk.signUp.create:sam@example.com', 'clerk.signUp.sendEmailCode', 'clerk.signUp.verifyEmailCode', 'clerk.signUp.finalize',
    ]);

    await pickUsername();
    expect(has('onboarding-progress')).toBe(true);

    await press('onboarding-photo-add');
    expect(has('onboarding-photo-preview')).toBe(false); // sheet first (native)
    await press('onboarding-photo-library');
    await press('onboarding-photo-continue');
    expect(h.calls).toContain('api.auth.uploadAvatar');

    await press('onboarding-interest-Womenswear');

    await press('onboarding-brand-s2');
    await press('onboarding-brands-next');
    expect(h.calls).toContain('follow:s2');

    await press('onboarding-size-tops');
    await press('onboarding-size-tops-M');
    await press('onboarding-sizes-ok');

    await press('onboarding-notifications-continue');
    expect(h.calls).toContain('notifications.request');

    await press('account-type-buyer');
    await press('onboarding-role-continue');

    const finish = h.calls.slice(h.calls.lastIndexOf('api.auth.updateProfile') - 1);
    expect(finish[0]).toBe('api.auth.sync');
    expect(finish).toContain('api.syncBuyerOnboarding:Womenswear');
    expect(finish.find((c) => c.startsWith('api.saveBuyerSurvey'))).toBe('api.saveBuyerSurvey:{"sizes":{"tops":"M"},"likedBrandIds":["s2"]}');
    expect(h.api.auth.updateProfile).toHaveBeenLastCalledWith(expect.objectContaining({ accountType: 'buyer', username: 'sam_lee', name: 'Sam Lee' }));
    expect(h.storage.get('onboarding_complete')).toBe('true');
    expect(h.storage.get('onboarding_owner_id')).toBe('user_1');
    expect(h.router.replace).toHaveBeenLastCalledWith('/thread-explainer');
  });

  it('seller: skips every optional step, then Sell → store name → stage → store setup', async () => {
    await render();
    await signUpWithEmail();
    await pickUsername('night_owl');
    await press('onboarding-photo-skip');
    await press('onboarding-interest-skip');
    await press('onboarding-brands-skip');
    await press('onboarding-sizes-skip');
    await press('onboarding-notifications-skip');
    await press('account-type-seller');
    await press('onboarding-role-continue');
    await type('onboarding-store-name', 'Night Owl Studio');
    await press('onboarding-store-continue');
    await press('onboarding-stage-build');
    await press('onboarding-stage-continue');

    const order = ['api.auth.sync', 'api.auth.onboarding', 'api.auth.updateProfile', 'api.auth.completeOnboarding'];
    const idx = order.map((c) => h.calls.indexOf(c));
    expect(idx.every((i, n) => i > -1 && (n === 0 || i > idx[n - 1]))).toBe(true);
    expect(h.api.auth.onboarding).toHaveBeenCalledWith({ brandName: 'Night Owl Studio', brandStage: 'build', username: 'night_owl' });
    expect(h.calls).not.toContain('notifications.request');
    expect(h.router.replace).toHaveBeenLastCalledWith('/(tabs)/');
    expect(h.router.push).toHaveBeenLastCalledWith('/store-setup-brand');
  });

  it('offers Continue with Apple first and signs up through Clerk oauth_apple after the birthday', async () => {
    await render();
    const options = tree.root.findAll((n) => typeof n.type === 'string' && ['onboarding-apple', 'onboarding-use-email', 'onboarding-google'].includes(n.props.testID));
    expect(options.map((n) => n.props.testID)).toEqual(['onboarding-apple', 'onboarding-use-email', 'onboarding-google']);

    await press('onboarding-apple');
    expect(has('onboarding-birthday')).toBe(true);
    expect(h.calls).toEqual([]);
    await type('onboarding-dob', '01152000');
    await press('onboarding-dob-continue');
    expect(h.calls).toEqual(['clerk.sso:oauth_apple']);
    expect(has('onboarding-username')).toBe(true);
  });

  it('an email that already has an account logs in with a code instead (Depop: one field for both)', async () => {
    h.clerk.existingEmails.add('back@example.com');
    await render();
    await signUpWithEmail('back@example.com');
    expect(h.calls).toEqual([
      'clerk.signUp.create:back@example.com', 'clerk.signIn.sendCode', 'clerk.signIn.verifyCode', 'clerk.signIn.finalize',
    ]);
  });

  it('asks for a password only when this Clerk instance requires one', async () => {
    h.clerk.missingFields = ['password'];
    await render();
    await signUpWithEmail();
    expect(has('onboarding-details')).toBe(true);
    await type('onboarding-password', 'longenough1');
    await press('onboarding-details-continue');
    expect(h.calls.slice(-2)).toEqual(['clerk.signUp.password', 'clerk.signUp.finalize']);
    expect(has('onboarding-username')).toBe(true);
  });

  it('shows real inline errors: wrong code, under-13 birthday, taken username', async () => {
    await render();
    await press('onboarding-use-email');
    await type('onboarding-dob', '01012020');
    await press('onboarding-dob-continue');
    expect(byId('onboarding-dob-error').props.children).toBe('You must be at least 13 to create an account.');

    await type('onboarding-dob', '01012000');
    await press('onboarding-dob-continue');
    await type('onboarding-email-input', 'sam@example.com');
    await press('onboarding-email-continue');
    await enterCode('123456');
    expect(byId('onboarding-code-error').props.children).toBe('That code isn’t right. Check your email and try again.');

    await enterCode('');
    await enterCode('000000');
    await type('onboarding-username-input', 'taken');
    await wait(450);
    expect(byId('onboarding-username-error').props.children).toBe('Username is already taken.');
    expect(byId('onboarding-username-continue').props.disabled).toBe(true);
  });
});
