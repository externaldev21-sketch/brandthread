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
 * but as plain React state instead of a window.Clerk shim.
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
    seller: {
      saveOnboardingData: vi.fn(record('seller.saveOnboardingData')),
    },
    ai: {
      brandMemoryRebuild: vi.fn(async () => ({ fields: {} })),
    },
    logo: {
      onboardingSample: vi.fn(async () => ({ b64_json: 'stub' })),
    },
  };

  // ── A tiny fake Clerk sign-up state machine, close to
  // clerk-onboarding-stub.mjs's browser version but expressed as plain
  // mutable state the mocked hooks below read/re-render from. ──
  const clerkStore = {
    listeners: new Set<() => void>(),
    isSignedIn: false,
    userId: null as string | null,
    signUp: {
      status: 'missing_requirements' as string,
      emailAddress: null as string | null,
      pendingCode: null as string | null,
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

  const signUp = {
    get status() { return clerkStore.signUp.status; },
    async password({ emailAddress }: { emailAddress: string; password: string }) {
      clerkStore.signUp.emailAddress = emailAddress;
      clerkStore.signUp.status = 'missing_requirements';
      clerkStore.notify();
      return { error: null };
    },
    verifications: {
      async sendEmailCode() {
        clerkStore.signUp.pendingCode = '000000';
        clerkStore.notify();
        return { error: null };
      },
      async verifyEmailCode({ code }: { code: string }) {
        if (code !== (clerkStore.signUp.pendingCode || '000000')) {
          return { error: { code: 'form_code_incorrect', message: 'Invalid code. Please check and try again.', errors: [{ code: 'form_code_incorrect', message: 'Invalid code.' }] } };
        }
        clerkStore.signUp.status = 'complete';
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

vi.mock('@/components/branding/BrandthreadLogo', () => ({ default: () => null }));
vi.mock('@/components/branding/GoogleGlyph', () => ({ default: () => null }));

vi.mock('expo-notifications', () => ({
  getPermissionsAsync: vi.fn(async () => ({ status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: vi.fn(async () => ({ status: 'denied' })),
}));

vi.mock('@/components/KeyboardProviderCompat', () => {
  const React = require('react') as typeof import('react');
  return { KeyboardAvoidingView: (props: Record<string, unknown>) => React.createElement('KeyboardAvoidingView', props, props.children as React.ReactNode) };
});

vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 0 }));

vi.mock('@/contexts/FeatureFlagContext', () => ({ useFeatureFlag: () => true }));

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

vi.mock('@/lib/onboarding/useUsernameLiveCheck', () => ({
  useUsernameLiveCheck: () => ({ error: '', checking: false }),
}));

vi.mock('@/components/onboarding/SizesStep', () => {
  const React = require('react') as typeof import('react');
  return { SizesStep: () => React.createElement('View', { testID: 'onboarding-sizes-step' }) };
});

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

vi.mock('@/components/onboarding/BrandsToFollowStep', () => {
  const React = require('react') as typeof import('react');
  return { BrandsToFollowStep: () => React.createElement('View', { testID: 'onboarding-brands-step' }) };
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
import { BUYER_STEP_INDEX, SELLER_STEP_INDEX } from '@/lib/onboardingFlow';

type Node = ReturnType<ReactTestRenderer['root']['findByProps']>;

function findByTestId(renderer: ReactTestRenderer, testID: string): Node {
  return renderer.root.findByProps({ testID });
}
/** A kit Field renders its TextInput with accessibilityLabel = the field label. */
function findInput(renderer: ReactTestRenderer, label: string): Node {
  return renderer.root.findAllByType('TextInput' as never).find((n) => n.props.accessibilityLabel === label)!;
}
/** A kit SquareButton is a Pressable labelled with its (title-case) label. */
function findButton(renderer: ReactTestRenderer, label: string): Node {
  const node = renderer.root.findAllByType('Pressable' as never).find((n) => n.props.accessibilityLabel === label);
  if (!node) throw new Error(`No button labelled "${label}"`);
  return node;
}
function allText(renderer: ReactTestRenderer): string {
  const flatten = (v: unknown): string => Array.isArray(v) ? v.map(flatten).join('') : (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
  return renderer.root.findAllByType('Text' as never).map((n) => flatten(n.props.children)).join(' | ');
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(OnboardingScreen));
    await Promise.resolve();
  });
  return renderer;
}

async function press(node: Node) {
  await act(async () => {
    node.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function fill(node: Node, value: string) {
  await act(async () => {
    node.props.onChangeText(value);
    await Promise.resolve();
  });
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); await Promise.resolve(); });
}

/** Sign up screen → email sheet → code, for the given role. */
async function driveThroughSignUp(renderer: ReactTestRenderer, role: 'buyer' | 'seller', email: string) {
  await press(findByTestId(renderer, `onboarding-account-type-${role}`));
  await fill(findByTestId(renderer, 'onboarding-dob-input'), '01151995');
  await press(findByTestId(renderer, 'onboarding-sign-up-email'));

  await fill(findInput(renderer, 'Email'), email);
  await fill(findInput(renderer, 'Password'), 'Walkthrough!Pass1');
  await press(findButton(renderer, 'Next'));
  await fill(findInput(renderer, 'Verification code'), '000000');
  await press(findButton(renderer, 'Verify'));
  await settle();
}

async function fillProfile(renderer: ReactTestRenderer, name: string, username: string) {
  await fill(findByTestId(renderer, 'onboarding-first-name-input'), name);
  await fill(findByTestId(renderer, 'onboarding-username-input'), username);
  await press(findButton(renderer, 'Next'));
}

function resetWorld() {
  memoryStorage.clear();
  apiCalls.length = 0;
  clerkStore.isSignedIn = false;
  clerkStore.userId = null;
  clerkStore.signUp = { status: 'missing_requirements', emailAddress: null, pendingCode: null, finalized: false };
  routerReplaceMock.mockClear();
  routerPushMock.mockClear();
  delete searchParams.addAccount;
  delete searchParams.postAuth;
}

describe('onboarding flow (buyer)', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(resetWorld);
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
  });

  it('signs up, skips the optional steps, and lands on the thread explainer with the right API calls', async () => {
    renderer = await renderScreen();
    await driveThroughSignUp(renderer, 'buyer', 'buyer-flow@onboarding-e2e.test');

    expect(allText(renderer)).toContain('01 / 04');
    await fillProfile(renderer, 'Bailey Rivera', 'wt_buyer_flow');

    // Brands (mocked list) and Sizes (mocked) are skippable: the one button reads Skip.
    expect(() => findByTestId(renderer!, 'onboarding-brands-step')).not.toThrow();
    await press(findButton(renderer, 'Skip'));
    expect(() => findByTestId(renderer!, 'onboarding-sizes-step')).not.toThrow();
    await press(findButton(renderer, 'Skip'));

    // Notifications: CONTINUE asks (web: no prompt) and finishes onboarding.
    expect(allText(renderer)).toContain('04 / 04');
    await press(findButton(renderer, 'Continue'));
    await settle();
    await settle();

    const names = apiCalls.map((c) => c.name);
    expect(names.indexOf('auth.sync')).toBeGreaterThan(-1);
    expect(names.indexOf('auth.sync')).toBeLessThan(names.indexOf('auth.updateProfile'));
    expect(names.indexOf('auth.saveBuyerPreferences')).toBeLessThan(names.indexOf('auth.completeOnboarding'));

    const updateProfileCall = apiCalls.find((c) => c.name === 'auth.updateProfile');
    expect(updateProfileCall!.args[0]).toMatchObject({ accountType: 'buyer', username: 'wt_buyer_flow', name: 'Bailey Rivera' });
    expect(apiCalls.find((c) => c.name === 'auth.completeOnboarding')!.args[0]).toBe('buyer');
    expect(routerReplaceMock).toHaveBeenCalledWith('/thread-explainer');
  }, 20_000);

  it('blocks account creation without a valid birthday', async () => {
    renderer = await renderScreen();
    await fill(findByTestId(renderer, 'onboarding-dob-input'), '01152020');
    await press(findByTestId(renderer, 'onboarding-sign-up-email'));
    expect(allText(renderer)).toContain('You must be at least 13 to create an account.');
    expect(findInput(renderer, 'Password')).toBeUndefined();
  });
});

describe('onboarding flow (seller)', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(resetWorld);
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
  });

  it('signs up, names the store, and lands on the tabs dashboard with the right API calls', async () => {
    renderer = await renderScreen();
    await driveThroughSignUp(renderer, 'seller', 'seller-flow@onboarding-e2e.test');

    await fillProfile(renderer, 'Sasha Rivera', 'noirfield');
    await fill(findByTestId(renderer, 'onboarding-brand-name-input'), 'Noir Field Studio');
    await press(findButton(renderer, 'Next'));

    await press(findButton(renderer, 'Continue'));
    await settle();
    await settle();

    const names = apiCalls.map((c) => c.name);
    expect(names).toContain('auth.sync');
    expect(names).toContain('auth.updateProfile');
    expect(apiCalls.find((c) => c.name === 'auth.onboarding')!.args[0]).toMatchObject({ brandName: 'Noir Field Studio', username: 'noirfield' });
    expect((apiCalls.find((c) => c.name === 'auth.updateProfile')!.args[0] as { accountType?: string }).accountType).toBe('seller');
    expect(apiCalls.find((c) => c.name === 'auth.completeOnboarding')!.args[0]).toBe('seller');
    expect(routerReplaceMock).toHaveBeenCalledWith('/(tabs)/');
  }, 20_000);

  it('a 16-year-old can shop but not sell', async () => {
    const year = new Date().getUTCFullYear() - 16;
    renderer = await renderScreen();
    await press(findByTestId(renderer, 'onboarding-account-type-seller'));
    await fill(findByTestId(renderer, 'onboarding-dob-input'), `0101${year}`);
    await press(findByTestId(renderer, 'onboarding-sign-up-email'));
    expect(allText(renderer)).toContain('You must be 18 or older to sell.');
    await press(findByTestId(renderer, 'onboarding-account-type-buyer'));
    await press(findByTestId(renderer, 'onboarding-sign-up-email'));
    expect(findInput(renderer, 'Password')).toBeDefined();
  });
});

// ── The "Already signed in" trap ───────────────────────────────────────────
// A session that is already active (this flow's own, after a remount) must
// continue into the questionnaire, never back into account creation; only a
// deliberate add-account flow shows the sign-up methods again.
describe('onboarding flow — already-signed-in routing', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(resetWorld);
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
    resetWorld();
  });

  it('a session already active continues straight to Profile — never the sign-up methods again', async () => {
    clerkStore.isSignedIn = true;
    clerkStore.userId = 'user_already_signed_in';

    renderer = await renderScreen();
    expect(() => findByTestId(renderer!, 'onboarding-sign-up-email')).toThrow();
    await press(findByTestId(renderer, 'onboarding-account-type-buyer'));
    await press(findByTestId(renderer, 'onboarding-account-type-continue'));

    expect(() => findByTestId(renderer!, 'onboarding-first-name-input')).not.toThrow();
    expect(memoryStorage.get('onboarding_pending_flow')).toBe('buyer');
  });

  it('creating a second account (add-account flow) while signed in still shows the sign-up methods', async () => {
    clerkStore.isSignedIn = true;
    clerkStore.userId = 'user_source_account';
    searchParams.addAccount = '1';

    renderer = await renderScreen();
    await settle();
    expect(() => findByTestId(renderer!, 'onboarding-sign-up-email')).not.toThrow();
    expect(allText(renderer)).not.toContain('Finish setting up');
  });

  it('a pending flow from an abandoned attempt comes back preselected on Sign up — which is why sign-out clears it', async () => {
    memoryStorage.set('onboarding_pending_flow', 'seller');

    renderer = await renderScreen();
    await settle();

    const sellRow = renderer.root.findAllByType('Pressable' as never).find((n) => n.props.testID === 'onboarding-account-type-seller');
    expect(sellRow!.props.accessibilityState).toEqual({ selected: true });
    expect(() => findByTestId(renderer!, 'onboarding-sign-up-email')).not.toThrow();
  });

  it('after the email-verification remount (postAuth=1) the pending flow resumes on Profile', async () => {
    memoryStorage.set('onboarding_pending_flow', 'seller');
    clerkStore.isSignedIn = true;
    clerkStore.userId = 'user_just_verified';
    searchParams.postAuth = '1';

    renderer = await renderScreen();
    await settle();

    expect(() => findByTestId(renderer!, 'onboarding-first-name-input')).not.toThrow();
    expect(allText(renderer)).toContain('01 / 03');
  });
});

describe('onboarding step machine sanity', () => {
  it('BUYER_STEP_INDEX / SELLER_STEP_INDEX match what this test drives through', () => {
    expect(BUYER_STEP_INDEX.PROFILE).toBe(1);
    expect(SELLER_STEP_INDEX.BRAND_NAME).toBeGreaterThan(SELLER_STEP_INDEX.PROFILE);
  });
});
