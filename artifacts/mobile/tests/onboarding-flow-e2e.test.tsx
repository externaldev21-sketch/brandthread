/**
 * Fast, CI-friendly complement to
 * scripts/onboarding-walkthrough/capture.mjs's real-browser walkthrough:
 * renders the actual app/onboarding.tsx screen with react-test-renderer and
 * drives BOTH the buyer and the seller path through to `finishBuyer()` /
 * `finishSeller()`, asserting the right API calls fired (in order) and the
 * screen ends on the right landing route.
 *
 * Following this repo's house pattern (see tests/add-product.test.tsx):
 * react-native, its native-module friends and every other onboarding
 * component onboarding.tsx imports are mocked with minimal, testID/label
 * carrying stand-ins; onboarding.tsx itself — the thing under test — is
 * never mocked, so its real state machine, validation and
 * finishBuyer/finishSeller logic run.
 *
 * @clerk/expo is mocked with a small in-memory fake sign-up (any 6-digit
 * code — '000000' — is accepted once a code has been "sent"), mirroring
 * scripts/onboarding-walkthrough/clerk-onboarding-stub.mjs's browser stub
 * but as plain React state instead of a window.Clerk shim. Like real Clerk,
 * create() starts a sign-up with just the email, the code verifies it, and
 * password() on the existing sign-up completes it (Instagram's order).
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// app/onboarding.tsx's own transitionTo() (real, unmocked — it's the state
// machine under test) schedules its step-transition animation via a raw
// requestAnimationFrame, which the node test environment doesn't provide.
(globalThis as { requestAnimationFrame?: (cb: FrameRequestCallback) => number }).requestAnimationFrame ??=
  (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;

const {
  routerReplaceMock,
  routerPushMock,
  apiCalls,
  api,
  clerkStore,
  searchParams,
} = vi.hoisted(() => {
  const searchParams: Record<string, string | undefined> = {};
  const apiCalls: { name: string; args: unknown[] }[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    apiCalls.push({ name, args });
    return Promise.resolve();
  };

  const api = {
    auth: {
      sync: vi.fn(async (body?: { name?: string }) => {
        apiCalls.push({ name: 'auth.sync', args: [body] });
        return { clerkId: 'user_test_clerk_id', displayName: body?.name ?? '', name: body?.name ?? '', username: null, bio: '' };
      }),
      updateProfile: vi.fn(async (body: Record<string, unknown>) => {
        apiCalls.push({ name: 'auth.updateProfile', args: [body] });
        return { displayName: body.displayName ?? body.name ?? '', name: body.name ?? '', username: body.username ?? null, bio: '' };
      }),
      onboarding: vi.fn(record('auth.onboarding')),
      saveBuyerPreferences: vi.fn(record('auth.saveBuyerPreferences')),
      completeOnboarding: vi.fn(record('auth.completeOnboarding')),
    },
    referrals: {
      apply: vi.fn(record('referrals.apply')),
    },
    buyer: {
      updatePreferences: vi.fn(record('buyer.updatePreferences')),
    },
    seller: {
      saveOnboardingData: vi.fn(record('seller.saveOnboardingData')),
    },
    ai: {
      brandMemoryRebuild: vi.fn(async () => ({ fields: {} })),
    },
    logo: {
      onboardingSample: vi.fn(async () => ({ b64_json: 'stub' })),
    },
    shippingZones: {
      updateSettings: vi.fn(record('shippingZones.updateSettings')),
    },
    ageGate: {
      submit: vi.fn(record('ageGate.submit')),
    },
  };

  // ── A tiny fake Clerk sign-up state machine, close to
  // clerk-onboarding-stub.mjs's browser version but expressed as plain
  // mutable state the mocked hooks below read/re-render from. ──
  const clerkStore = {
    listeners: new Set<() => void>(),
    isSignedIn: false,
    userId: null as string | null,
    /** Emails that already have a Clerk account (create fails for these). */
    existingEmails: new Set<string>(),
    /** One-shot error for the next signUp.create call. */
    createErrorOnce: null as null | { errors: Array<{ code: string; message: string; meta?: { paramName?: string } }> },
    createCalls: [] as string[],
    signUp: {
      id: null as string | null,
      status: 'missing_requirements' as string,
      emailAddress: null as string | null,
      pendingCode: null as string | null,
      emailVerified: false,
      hasPassword: false,
      finalized: false,
    },
    notify() { this.listeners.forEach((fn) => fn()); },
  };

  return { routerReplaceMock: vi.fn(), routerPushMock: vi.fn(), apiCalls, api, clerkStore, searchParams };
});

// ── react-native and friends: minimal host-element stand-ins ───────────────
vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const host = (name: string) => {
    function Host(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    Host.displayName = name;
    return Host;
  };
  class FakeAnimatedValue {
    value: number;
    constructor(v: number) { this.value = v; }
    setValue(v: number) { this.value = v; }
    stopAnimation() {}
    interpolate() { return this.value; }
  }
  const timing = () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }) });
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Alert: { alert: vi.fn() },
    Animated: {
      Value: FakeAnimatedValue,
      View: host('Animated.View'),
      Text: host('Animated.Text'),
      timing,
      spring: timing,
      parallel: (anims: { start: (cb?: () => void) => void }[]) => ({
        start: (cb?: () => void) => { anims.forEach((a) => a.start()); cb?.(); },
      }),
    },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    Easing: { out: (fn: unknown) => fn, cubic: (v: number) => v, bezier: () => (v: number) => v },
    Image: host('Image'),
    KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Keyboard: { dismiss: vi.fn() },
    Linking: { openURL: vi.fn() },
    Platform: { OS: 'web', select: (obj: Record<string, unknown>) => obj.web ?? obj.default },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StatusBar: host('StatusBar'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    Text: host('Text'),
    TextInput: host('TextInput'),
    TouchableOpacity: host('TouchableOpacity'),
    View: host('View'),
  };
});

// Only reached via @/components/onboarding/onboardingTokens.ts (MOTION's
// Easing.bezier curves + the useOnboardingMotion() hook) — every component
// that uses reanimated more directly (OnboardingUI, WelcomeStep, ThreadLine,
// …) is mocked away below, but onboardingTokens.ts itself is real.
vi.mock('react-native-reanimated', () => ({
  default: { View: (props: Record<string, unknown>) => React.createElement('Animated.View', props, props.children as React.ReactNode) },
  Easing: { out: (fn: unknown) => fn, cubic: (v: number) => v, bezier: () => (v: number) => v },
  useReducedMotion: () => false,
  useSharedValue: (initial: unknown) => ({ value: initial }),
  useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
  withTiming: (v: unknown) => v,
  withSpring: (v: unknown) => v,
  interpolate: (v: unknown) => v,
  interpolateColor: (v: unknown) => v,
  FadeIn: { duration: () => undefined },
}));

vi.mock('expo-linear-gradient', () => {
  const React = require('react') as typeof import('react');
  return { LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('LinearGradient', props, children) };
});

vi.mock('@expo/vector-icons', () => {
  const React = require('react') as typeof import('react');
  return {
    Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
    Ionicons: ({ name }: { name: string }) => React.createElement('Ionicons', { name }),
  };
});

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

vi.mock('expo-auth-session', () => ({ makeRedirectUri: vi.fn(() => 'brandthread://redirect') }));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: vi.fn(), openAuthSessionAsync: vi.fn() }));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const memoryStorage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => memoryStorage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { memoryStorage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { memoryStorage.delete(key); }),
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, memoryStorage.get(k) ?? null] as [string, string | null])),
    multiSet: vi.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => memoryStorage.set(k, v)); }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((k) => memoryStorage.delete(k)); }),
  },
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock, back: vi.fn() }),
  useLocalSearchParams: () => searchParams,
  useGlobalSearchParams: () => searchParams,
}));

// ── @clerk/expo: a tiny reactive fake sign-up, mirroring
// clerk-onboarding-stub.mjs's browser stub (same accepted-code rule) ────────
vi.mock('@clerk/expo', () => {
  const React = require('react') as typeof import('react');

  function useClerkStoreVersion() {
    const [, setTick] = React.useState(0);
    React.useEffect(() => {
      const listener = () => setTick((t) => t + 1);
      clerkStore.listeners.add(listener);
      return () => { clerkStore.listeners.delete(listener); };
    }, []);
  }

  const complete = () => {
    if (clerkStore.signUp.emailVerified && clerkStore.signUp.hasPassword) clerkStore.signUp.status = 'complete';
  };
  const signUp = {
    get id() { return clerkStore.signUp.id; },
    get status() { return clerkStore.signUp.status; },
    get emailAddress() { return clerkStore.signUp.emailAddress; },
    async create({ emailAddress }: { emailAddress: string }) {
      clerkStore.createCalls.push(emailAddress);
      if (clerkStore.createErrorOnce) {
        const error = clerkStore.createErrorOnce;
        clerkStore.createErrorOnce = null;
        return { error };
      }
      if (clerkStore.existingEmails.has(emailAddress)) {
        return { error: { errors: [{ code: 'form_identifier_exists', message: 'That email address is taken. Please try another.', meta: { paramName: 'email_address' } }] } };
      }
      clerkStore.signUp = { ...clerkStore.signUp, id: 'su_test', emailAddress, status: 'missing_requirements', emailVerified: false, hasPassword: false };
      clerkStore.notify();
      return { error: null };
    },
    async password() {
      clerkStore.signUp.hasPassword = true;
      complete();
      clerkStore.notify();
      return { error: null };
    },
    verifications: {
      get emailAddress() { return { status: clerkStore.signUp.emailVerified ? 'verified' : 'unverified' }; },
      async sendEmailCode() {
        clerkStore.signUp.pendingCode = '000000';
        clerkStore.notify();
        return { error: null };
      },
      async verifyEmailCode({ code }: { code: string }) {
        if (code !== (clerkStore.signUp.pendingCode || '000000')) {
          return { error: { code: 'form_code_incorrect', message: 'Invalid code. Please check and try again.', errors: [{ code: 'form_code_incorrect', message: 'Invalid code.' }] } };
        }
        clerkStore.signUp.emailVerified = true;
        complete();
        clerkStore.notify();
        return { error: null };
      },
    },
    async finalize({ navigate }: { navigate?: (args: { decorateUrl: (u: string) => string }) => Promise<void> }) {
      clerkStore.isSignedIn = true;
      clerkStore.userId = 'user_test_clerk_id';
      clerkStore.signUp.finalized = true;
      clerkStore.notify();
      if (navigate) await navigate({ decorateUrl: (u) => u });
      return { error: null };
    },
  };

  return {
    useAuth: () => {
      useClerkStoreVersion();
      return {
        isSignedIn: clerkStore.isSignedIn,
        isLoaded: true,
        userId: clerkStore.userId,
        signOut: vi.fn(async () => { clerkStore.isSignedIn = false; clerkStore.userId = null; clerkStore.notify(); }),
        getToken: vi.fn(async () => 'stub-token'),
      };
    },
    useUser: () => {
      useClerkStoreVersion();
      return {
        isLoaded: true,
        user: clerkStore.isSignedIn ? { id: clerkStore.userId, primaryEmailAddress: { emailAddress: clerkStore.signUp.emailAddress } } : null,
      };
    },
    useSignUp: () => {
      useClerkStoreVersion();
      return { isLoaded: true, signUp };
    },
    useSSO: () => ({ startSSOFlow: vi.fn(async () => ({ createdSessionId: null })) }),
  };
});

vi.mock('@/lib/api', () => ({ useApi: () => api }));

vi.mock('@/services/socialService', () => ({
  hydrateMyProfileFromAccount: vi.fn(async () => {}),
  socialKeysForUser: vi.fn(() => ({})),
}));

vi.mock('@/lib/buyerProfile', () => ({
  DEFAULT_BUYER_PROFILE: {},
  saveBuyerProfileForUser: vi.fn(async () => {}),
}));

vi.mock('@/lib/contextualPushPermission', () => ({
  registerGrantedPushToken: vi.fn(async () => {}),
}));

vi.mock('@/lib/legalConsent', () => ({
  rememberPendingConsent: vi.fn(async () => {}),
}));

vi.mock('@/lib/installId', () => ({ getInstallId: vi.fn(async () => 'install-test-0000-0000') }));
vi.mock('@/lib/pickProfileImage', () => ({ pickFromLibrary: vi.fn(async () => null) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/onboarding/useUsernameLiveCheck', () => ({ useUsernameLiveCheck: () => ({ error: '', checking: false }) }));
vi.mock('@/lib/buyerOnboardingSync', () => ({
  queueBuyerOnboardingSync: vi.fn(async () => {}),
  isRecoverableBuyerOnboardingSyncError: () => false,
  syncBuyerOnboarding: vi.fn(async (_id: string, styles: string[]) => {
    apiCalls.push({ name: 'auth.saveBuyerPreferences', args: [styles] });
    apiCalls.push({ name: 'auth.completeOnboarding', args: ['buyer'] });
  }),
}));
vi.mock('@/lib/onboardingSurvey', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  saveBuyerSurvey: vi.fn(async () => {}),
}));
vi.mock('@/components/KeyboardProviderCompat', () => {
  const React = require('react') as typeof import('react');
  return { KeyboardAvoidingView: ({ children }: { children?: React.ReactNode }) => React.createElement('View', null, children) };
});
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ foreground: '#FFFFFF', mutedForeground: '#C0C0C0', destructive: '#FF3B30', border: '#333333', background: '#000000' }),
}));
vi.mock('@/components/AiGeneratedBadge', () => ({ AiGeneratedBadge: () => null }));
vi.mock('@/components/ui', () => {
  const React = require('react') as typeof import('react');
  return {
    Button: (props: Record<string, unknown>) => React.createElement('Button', props),
    Input: (props: Record<string, unknown>) => React.createElement('TextInput', { ...props, accessibilityLabel: props.label }, props.right as React.ReactNode),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
    OptionSheet: () => null,
  };
});
vi.mock('@/components/branding/BrandthreadLogo', () => ({ default: () => null }));
vi.mock('@/components/branding/GoogleGlyph', () => ({ default: () => null }));

// app/onboarding.tsx imports ONBOARDING_KEY/ONBOARDING_OWNER_KEY from
// './_layout' — real app/_layout.tsx pulls in the entire app shell (query
// client, notifications, RevenueCat, every context provider, …), which is
// both unnecessary here and unmockable at this scope, so only the two
// string constants it actually needs are provided.
vi.mock('@/app/_layout', () => ({
  ONBOARDING_KEY: 'onboarding_complete',
  ONBOARDING_OWNER_KEY: 'onboarding_owner_id',
}));

vi.mock('@/components/legal/LegalConsent', () => {
  const React = require('react') as typeof import('react');
  return {
    // Sign-up shows one linked line; continuing is the agreement (no checkbox).
    LegalContinueNotice: () => React.createElement('Text', { testID: 'legal-consent-line' }),
  };
});

vi.mock('@/components/onboarding/WelcomeStep', () => {
  const React = require('react') as typeof import('react');
  return {
    WelcomeStep: ({ onGetStarted, onSignIn }: { onGetStarted: () => void; onSignIn: () => void }) =>
      React.createElement('View', null,
        React.createElement('TouchableOpacity', { testID: 'onboarding-welcome-get-started', onPress: onGetStarted }),
        React.createElement('TouchableOpacity', { testID: 'onboarding-welcome-sign-in', onPress: onSignIn }),
      ),
  };
});

vi.mock('@/app/account-type', () => {
  const React = require('react') as typeof import('react');
  return {
    AccountTypeStep: ({ onSelect, onContinue }: { onSelect: (t: 'buyer' | 'seller') => void; onContinue: () => void }) =>
      React.createElement('View', null,
        React.createElement('TouchableOpacity', { testID: 'onboarding-account-type-buyer', onPress: () => onSelect('buyer') }),
        React.createElement('TouchableOpacity', { testID: 'onboarding-account-type-seller', onPress: () => onSelect('seller') }),
        React.createElement('TouchableOpacity', { testID: 'onboarding-account-type-continue', onPress: onContinue }),
      ),
  };
});

vi.mock('@/components/onboarding/BrandsToFollowStep', () => {
  const React = require('react') as typeof import('react');
  return { BrandsToFollowStep: () => React.createElement('View', { testID: 'onboarding-brands-step' }) };
});

vi.mock('@/components/onboarding/SellerPlanRecommendationStep', () => {
  const React = require('react') as typeof import('react');
  return {
    SellerPlanRecommendationStep: ({ onContinue }: { onContinue: () => void }) =>
      React.createElement('TouchableOpacity', { testID: 'onboarding-plan-recommendation-continue', onPress: onContinue }),
  };
});

vi.mock('@/components/onboarding/ThreadLine', () => ({
  Glow: () => null,
  ThreadDraw: () => null,
  ThreadLogoStitch: () => null,
  ThreadProgress: () => null,
  ThreadWeave: () => null,
}));

vi.mock('@/components/onboarding/OnboardingUI', () => {
  const React = require('react') as typeof import('react');
  return {
    CodeCells: ({ value, onChangeText, testID }: { value: string; onChangeText: (v: string) => void; testID?: string }) =>
      React.createElement('TextInput', { testID: testID ?? 'onboarding-code-cells', accessibilityLabel: 'Verification code', value, onChangeText }),
    FloatingInput: React.forwardRef((props: Record<string, unknown>, ref: unknown) => React.createElement('TextInput', { ...props, ref })),
    PillButton: (props: Record<string, unknown>) =>
      React.createElement('PillButton', { ...props, accessibilityLabel: props.accessibilityLabel ?? props.label }),
    PressableScale: (props: Record<string, unknown>) => React.createElement('TouchableOpacity', props, props.children as React.ReactNode),
    Reveal: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    RevealToggle: (props: Record<string, unknown>) => React.createElement('TouchableOpacity', props),
    StepHeadline: ({ children }: { children?: React.ReactNode }) => React.createElement('Text', null, children),
    StepSub: ({ children }: { children?: React.ReactNode }) => React.createElement('Text', null, children),
    StitchAccent: () => null,
  };
});

// APP_THEME_PRESETS / DEFAULT_THEME / getOnAccentTextStyle are real (pure
// data + a pure function) — only the hook needs to be swapped for a
// controllable one.
vi.mock('@/contexts/AppThemeContext', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@/contexts/AppThemeContext');
  return {
    ...actual,
    useAppTheme: () => ({ theme: actual.DEFAULT_THEME, isHydrated: true, selectTheme: vi.fn(async () => {}) }),
  };
});

import OnboardingScreen from '@/app/onboarding';
import { BUYER_STEPS, SELLER_STEPS } from '@/lib/onboardingFlow';

function findByTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findByProps({ testID });
}
function has(renderer: ReactTestRenderer, testID: string): boolean {
  return renderer.root.findAllByProps({ testID }).length > 0;
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(OnboardingScreen));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return renderer;
}

async function settle() {
  await act(async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function tap(renderer: ReactTestRenderer, testID: string) {
  await act(async () => {
    findByTestId(renderer, testID).props.onPress();
    await Promise.resolve();
  });
  await settle();
}

async function type(renderer: ReactTestRenderer, testID: string, value: string) {
  await act(async () => {
    findByTestId(renderer, testID).props.onChangeText(value);
    await Promise.resolve();
  });
}

/** Instagram's account steps, shared by both paths: email → code → password → birthday → terms. */
async function driveAccountSteps(renderer: ReactTestRenderer, email: string, opts: { adultBirthday: boolean }) {
  await type(renderer, 'onboarding-email-input', email);
  await tap(renderer, 'onboarding-email-next');
  await type(renderer, 'onboarding-code-input', '000000');
  await tap(renderer, 'onboarding-code-next');
  await type(renderer, 'onboarding-password-input', 'Walkthrough!Pass1');
  await tap(renderer, 'onboarding-password-next');
  // Birthday defaults to today (0 years old): the age gate blocks it.
  await tap(renderer, 'onboarding-birthday-next');
  expect(has(renderer, 'onboarding-step-error')).toBe(true);
  const yearColumn = renderer.root.findAll((n) => n.props.label === 'Year' && typeof n.props.onIndex === 'function')[0];
  await act(async () => { yearColumn.props.onIndex(yearColumn.props.index - (opts.adultBirthday ? 30 : 15)); });
  await tap(renderer, 'onboarding-birthday-next');
  await tap(renderer, 'onboarding-terms-agree');
  await settle();
}

function resetState() {
  memoryStorage.clear();
  apiCalls.length = 0;
  clerkStore.isSignedIn = false;
  clerkStore.userId = null;
  clerkStore.existingEmails.clear();
  clerkStore.createErrorOnce = null;
  clerkStore.createCalls.length = 0;
  clerkStore.signUp = { id: null, status: 'missing_requirements', emailAddress: null, pendingCode: null, emailVerified: false, hasPassword: false, finalized: false };
  routerReplaceMock.mockClear();
  routerPushMock.mockClear();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
}

describe('onboarding flow (buyer, Instagram order)', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(resetState);
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
  });

  it('one question per screen from email to brands, then lands on the thread explainer with the right API calls', async () => {
    renderer = await renderScreen();
    await tap(renderer, 'onboarding-welcome-get-started');
    await tap(renderer, 'onboarding-account-type-buyer');
    await tap(renderer, 'onboarding-account-type-continue');

    // The referral field is hidden behind "Have a code?".
    expect(has(renderer, 'onboarding-referral-input')).toBe(false);
    expect(has(renderer, 'onboarding-have-code')).toBe(true);

    await driveAccountSteps(renderer, 'buyer-flow@onboarding-e2e.test', { adultBirthday: true });
    expect(clerkStore.isSignedIn).toBe(true);

    await type(renderer, 'onboarding-first-name-input', 'Bailey Rivera');
    await tap(renderer, 'onboarding-name-next');

    // Username is pre-filled with a suggestion.
    expect(findByTestId(renderer, 'onboarding-username-input').props.value).toBe('bailey_rivera');
    await tap(renderer, 'onboarding-username-next');
    await tap(renderer, 'onboarding-photo-skip');
    expect(has(renderer, 'onboarding-welcome-user')).toBe(true);
    await tap(renderer, 'onboarding-welcome-user');
    await tap(renderer, 'onboarding-style-next');
    await tap(renderer, 'onboarding-sizes-skip');
    await tap(renderer, 'onboarding-brands-skip');

    const names = apiCalls.map((c) => c.name);
    expect(names).toContain('ageGate.submit');
    expect(names).toContain('auth.sync');
    expect(names).toContain('auth.updateProfile');
    expect(names).toContain('auth.saveBuyerPreferences');
    expect(names).toContain('auth.completeOnboarding');
    expect(names.indexOf('auth.sync')).toBeLessThan(names.indexOf('auth.updateProfile'));

    const updateProfileCall = apiCalls.find((c) => c.name === 'auth.updateProfile');
    expect(updateProfileCall!.args[0]).toMatchObject({ accountType: 'buyer', username: 'bailey_rivera', name: 'Bailey Rivera' });
    expect(routerReplaceMock).toHaveBeenCalledWith('/thread-explainer');

    // The draft is cleared once onboarding finishes.
    expect([...memoryStorage.keys()].some((k) => k.startsWith('onboarding_draft:') || k === 'onboarding_pending_draft')).toBe(false);
  }, 20_000);

  it('never stores the password in the draft', async () => {
    renderer = await renderScreen();
    await tap(renderer, 'onboarding-welcome-get-started');
    await tap(renderer, 'onboarding-account-type-buyer');
    await tap(renderer, 'onboarding-account-type-continue');
    await type(renderer, 'onboarding-email-input', 'draft@onboarding-e2e.test');
    await tap(renderer, 'onboarding-email-next');
    await type(renderer, 'onboarding-code-input', '000000');
    await tap(renderer, 'onboarding-code-next');
    await type(renderer, 'onboarding-password-input', 'SuperSecret!42');
    await tap(renderer, 'onboarding-password-next');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });

    const raw = memoryStorage.get('onboarding_pending_draft');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('SuperSecret');
    expect(JSON.parse(raw!)).toMatchObject({ stepId: 'BIRTHDAY', email: 'draft@onboarding-e2e.test', flow: 'buyer' });
  }, 20_000);
});

describe('onboarding flow (seller, Shopify order)', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(resetState);
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
  });

  it('questions → location → account → brand → store preview → dashboard, with no plan, payout or notification step', async () => {
    renderer = await renderScreen();
    await tap(renderer, 'onboarding-welcome-get-started');
    await tap(renderer, 'onboarding-account-type-seller');
    await tap(renderer, 'onboarding-account-type-continue');

    await tap(renderer, 'onboarding-choice-build');
    await tap(renderer, 'onboarding-question-next');
    await tap(renderer, 'onboarding-choice-find-manufacturers');
    await tap(renderer, 'onboarding-question-next');
    expect(has(renderer, 'onboarding-location-row')).toBe(true);
    await tap(renderer, 'onboarding-question-next');

    await driveAccountSteps(renderer, 'seller-flow@onboarding-e2e.test', { adultBirthday: true });

    await type(renderer, 'onboarding-first-name-input', 'Sasha Rivera');
    await tap(renderer, 'onboarding-name-next');
    await type(renderer, 'onboarding-brand-name-input', 'Noir Field Studio');
    await tap(renderer, 'onboarding-brand-name-next');
    expect(findByTestId(renderer, 'onboarding-username-input').props.value).toBe('noirfieldstudio');
    await tap(renderer, 'onboarding-username-next');

    // "Building your store": the seller's own preview, before anything paid.
    expect(has(renderer, 'onboarding-store-preview')).toBe(true);
    await settle();
    await tap(renderer, 'onboarding-generate-sample');
    expect(api.logo.onboardingSample).toHaveBeenCalledWith('Noir Field Studio', 'Minimalist', 'install-test-0000-0000');
    await tap(renderer, 'onboarding-building-done');

    const names = apiCalls.map((c) => c.name);
    for (const call of ['auth.sync', 'auth.onboarding', 'auth.updateProfile', 'seller.saveOnboardingData', 'shippingZones.updateSettings', 'auth.completeOnboarding']) {
      expect(names).toContain(call);
    }
    expect(apiCalls.find((c) => c.name === 'auth.onboarding')!.args[0]).toMatchObject({ brandName: 'Noir Field Studio', brandStage: 'build', username: 'noirfieldstudio' });
    expect(apiCalls.find((c) => c.name === 'auth.updateProfile')!.args[0]).toMatchObject({ accountType: 'seller' });
    expect(apiCalls.find((c) => c.name === 'seller.saveOnboardingData')!.args[0]).toMatchObject({ goals: ['Find manufacturers'], brandStage: 'build' });
    expect(apiCalls.find((c) => c.name === 'auth.completeOnboarding')!.args[0]).toBe('seller');
    expect(names.indexOf('auth.completeOnboarding')).toBeGreaterThan(names.indexOf('seller.saveOnboardingData'));
    expect(routerReplaceMock).toHaveBeenCalledWith('/(tabs)/');
  }, 20_000);

  it('a 16-year-old cannot create a seller account', async () => {
    renderer = await renderScreen();
    await tap(renderer, 'onboarding-welcome-get-started');
    await tap(renderer, 'onboarding-account-type-seller');
    await tap(renderer, 'onboarding-account-type-continue');
    await tap(renderer, 'onboarding-question-skip-all');
    await tap(renderer, 'onboarding-question-next');
    await type(renderer, 'onboarding-email-input', 'teen@onboarding-e2e.test');
    await tap(renderer, 'onboarding-email-next');
    await type(renderer, 'onboarding-code-input', '000000');
    await tap(renderer, 'onboarding-code-next');
    await type(renderer, 'onboarding-password-input', 'Walkthrough!Pass1');
    await tap(renderer, 'onboarding-password-next');
    const yearColumn = renderer.root.findAll((n) => n.props.label === 'Year' && typeof n.props.onIndex === 'function')[0];
    await act(async () => { yearColumn.props.onIndex(yearColumn.props.index - 16); });
    await tap(renderer, 'onboarding-birthday-next');
    expect(has(renderer, 'onboarding-step-error')).toBe(true);
    expect(has(renderer, 'onboarding-terms-agree')).toBe(false);
    expect(clerkStore.isSignedIn).toBe(false);
  }, 20_000);
});

describe('onboarding entry points and resume', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(resetState);
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
  });

  it('"Create new account" (addAccount=1) opens on the buyer/seller question and still asks for a new email', async () => {
    clerkStore.isSignedIn = true;
    clerkStore.userId = 'user_source_account';
    searchParams.addAccount = '1';
    memoryStorage.set('onboarding_pending_draft', JSON.stringify({ version: 9, flow: 'seller', stepId: 'PASSWORD', email: 'stale@x.test' }));

    renderer = await renderScreen();
    await settle();
    expect(has(renderer, 'onboarding-account-type-continue')).toBe(true);
    expect(has(renderer, 'onboarding-welcome-get-started')).toBe(false);
    await tap(renderer, 'onboarding-account-type-seller');
    await tap(renderer, 'onboarding-account-type-continue');
    await tap(renderer, 'onboarding-question-skip-all');
    await tap(renderer, 'onboarding-question-next');
    expect(findByTestId(renderer, 'onboarding-email-input').props.value).toBe('');
  });

  it('the web landing page\'s "Start selling" pre-selects seller on the buyer/seller question', async () => {
    memoryStorage.set('onboarding_pending_flow', 'seller');
    renderer = await renderScreen();
    await settle();
    expect(has(renderer, 'onboarding-account-type-continue')).toBe(true);
    await tap(renderer, 'onboarding-account-type-continue');
    expect(has(renderer, 'onboarding-stage-step')).toBe(true);
    expect(memoryStorage.has('onboarding_pending_flow')).toBe(false);
  });

  it('a signed-in account with no answers skips every account step', async () => {
    clerkStore.isSignedIn = true;
    clerkStore.userId = 'user_already_signed_in';
    renderer = await renderScreen();
    await settle();
    await tap(renderer, 'onboarding-account-type-buyer');
    await tap(renderer, 'onboarding-account-type-continue');
    expect(has(renderer, 'onboarding-first-name-input')).toBe(true);
    expect(has(renderer, 'onboarding-email-input')).toBe(false);
  });

  it('reopening mid-sign-up returns to the same step with the email kept', async () => {
    memoryStorage.set('onboarding_pending_draft', JSON.stringify({
      version: 9, flow: 'buyer', stepId: 'CODE', authMethod: 'email', accountCreated: false, email: 'resume@x.test',
    }));
    clerkStore.signUp = { ...clerkStore.signUp, id: 'su_resume', emailAddress: 'resume@x.test', status: 'missing_requirements' };
    renderer = await renderScreen();
    await settle();
    expect(has(renderer, 'onboarding-code-input')).toBe(true);
  });

  it('reopening after the account exists returns to the same profile step with answers kept', async () => {
    clerkStore.isSignedIn = true;
    clerkStore.userId = 'user_resume';
    memoryStorage.set('onboarding_draft:user_resume', JSON.stringify({
      version: 9, flow: 'seller', stepId: 'BRAND_NAME', authMethod: 'email', accountCreated: true, ownerId: 'user_resume',
      firstName: 'Sasha', lastName: 'Rivera', brandName: 'Noir', goals: ['Grow sales'], brandStage: 'selling',
    }));
    renderer = await renderScreen();
    await settle();
    expect(findByTestId(renderer, 'onboarding-brand-name-input').props.value).toBe('Noir');
  });
});

describe('Dev P0: a brand-new email never shows "this email already has an account"', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(resetState);
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
  });

  async function toEmailStep(r: ReactTestRenderer) {
    if (has(r, 'onboarding-welcome-get-started')) await tap(r, 'onboarding-welcome-get-started');
    await tap(r, 'onboarding-account-type-buyer');
    await tap(r, 'onboarding-account-type-continue');
    expect(has(r, 'onboarding-email-input')).toBe(true);
  }

  async function submitNewEmail(r: ReactTestRenderer, email: string) {
    await type(r, 'onboarding-email-input', email);
    await tap(r, 'onboarding-email-next');
  }

  function expectCodeStepWithoutSwitch(r: ReactTestRenderer) {
    expect(has(r, 'onboarding-code-step')).toBe(true);
    expect(has(r, 'onboarding-email-switch')).toBe(false);
  }

  it('(a) clean device: a fresh email goes straight to the code step', async () => {
    renderer = await renderScreen();
    await settle();
    await toEmailStep(renderer);
    await submitNewEmail(renderer, 'fresh-a@x.test');
    expectCodeStepWithoutSwitch(renderer);
  });

  it('(b) device still signed in to another account: "Create an account" signs it out quietly and creates the new one', async () => {
    clerkStore.isSignedIn = true;
    clerkStore.userId = 'user_left_over';
    searchParams.start = 'account-type';
    renderer = await renderScreen();
    await settle();
    expect(clerkStore.isSignedIn).toBe(false);
    await toEmailStep(renderer);
    await submitNewEmail(renderer, 'fresh-b@x.test');
    expectCodeStepWithoutSwitch(renderer);
  });

  it('(b) a session Clerk still reports on create is cleared and the create retried, never shown as "exists"', async () => {
    renderer = await renderScreen();
    await settle();
    await toEmailStep(renderer);
    clerkStore.createErrorOnce = { errors: [{ code: 'session_exists', message: 'You\'re already signed in.' }] };
    await submitNewEmail(renderer, 'fresh-b2@x.test');
    expect(clerkStore.createCalls).toEqual(['fresh-b2@x.test', 'fresh-b2@x.test']);
    expectCodeStepWithoutSwitch(renderer);
  });

  it('(c) an earlier sign-up abandoned at the code step is not reused for the new email', async () => {
    clerkStore.signUp = { ...clerkStore.signUp, id: 'su_abandoned', emailAddress: 'abandoned@x.test', status: 'missing_requirements' };
    renderer = await renderScreen();
    await settle();
    await toEmailStep(renderer);
    await submitNewEmail(renderer, 'fresh-c@x.test');
    expect(clerkStore.createCalls).toEqual(['fresh-c@x.test']);
    expect(clerkStore.signUp.emailAddress).toBe('fresh-c@x.test');
    expectCodeStepWithoutSwitch(renderer);
  });

  it('(d) after the multi-account add flow: a fresh email goes straight to the code step', async () => {
    clerkStore.isSignedIn = true;
    clerkStore.userId = 'user_source_account';
    searchParams.addAccount = '1';
    renderer = await renderScreen();
    await settle();
    await toEmailStep(renderer);
    await submitNewEmail(renderer, 'fresh-d@x.test');
    expectCodeStepWithoutSwitch(renderer);
    expect(clerkStore.isSignedIn).toBe(true); // the source account stays signed in
  });

  it('a taken identifier that is not the email shows a field error, not the switch screen', async () => {
    renderer = await renderScreen();
    await settle();
    await toEmailStep(renderer);
    clerkStore.createErrorOnce = { errors: [{ code: 'form_identifier_exists', message: 'taken', meta: { paramName: 'username' } }] };
    await submitNewEmail(renderer, 'fresh-e@x.test');
    expect(has(renderer, 'onboarding-email-switch')).toBe(false);
    expect(findByTestId(renderer, 'onboarding-step-error').props.children).toBe('That username is taken. Try another.');
  });

  it('only an email that really has an account shows Dev\'s copy, "Switch to it" and "Use a different email"', async () => {
    clerkStore.existingEmails.add('taken@x.test');
    renderer = await renderScreen();
    await settle();
    await toEmailStep(renderer);
    await submitNewEmail(renderer, 'taken@x.test');
    expect(has(renderer, 'onboarding-code-step')).toBe(false);
    expect(findByTestId(renderer, 'onboarding-step-error').props.children).toBe('This email already has a buyer account.');
    await tap(renderer, 'onboarding-email-use-different');
    expect(findByTestId(renderer, 'onboarding-email-input').props.value).toBe('');
    expect(has(renderer, 'onboarding-email-switch')).toBe(false);

    await submitNewEmail(renderer, 'taken@x.test');
    await tap(renderer, 'onboarding-email-switch');
    expect(routerReplaceMock).toHaveBeenCalledWith('/sign-in');
  });
});

describe('onboarding step machine sanity', () => {
  it('neither flow has a payout, plan or notifications step', () => {
    for (const id of [...BUYER_STEPS, ...SELLER_STEPS]) {
      expect(['PLAN', 'PAYOUTS', 'NOTIFICATIONS', 'LOADING', 'SUCCESS']).not.toContain(id);
    }
  });
});
