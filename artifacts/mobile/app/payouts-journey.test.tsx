/**
 * Payouts setup journey, rendered: each server payoutState lands on its own
 * screen, only "active" opens the manage page, and the primary button opens
 * the real hosted Stripe onboarding and re-reads status on return.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureJourneyStatus } from '@/lib/payoutJourney';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, roleState, routerMock, browserMock, paramsState } = vi.hoisted(() => ({
  apiMock: {
    auth: { me: vi.fn(async () => ({ ageBand: '18_plus' })) },
    finance: {
      balance: vi.fn(),
      payouts: vi.fn(),
      firstPayout: vi.fn(),
      summary: vi.fn(async () => ({ held: { amount: 0, drops: [] } })),
    },
    seller: {
      connect: { status: vi.fn(), onboard: vi.fn() },
    },
    team: { context: vi.fn() },
  },
  roleState: { currentRole: 'owner' as string },
  routerMock: { back: vi.fn(), push: vi.fn() },
  browserMock: { openAuthSessionAsync: vi.fn(async () => ({ type: 'success', url: 'brandthread://payouts?returned=1' })) },
  paramsState: { params: {} as Record<string, string> },
}));

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  const React = require('react') as typeof import('react');
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };

  return {
    ...actual,
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Alert: { alert: vi.fn() },
    AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    Linking: { openURL: vi.fn(), canOpenURL: vi.fn(async () => true) },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    Pressable: nativeComponent('Pressable'),
    ScrollView: nativeComponent('ScrollView'),
    Share: { share: vi.fn() },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    Animated: {
      Value: class { constructor(_v?: number) {} setValue() {} interpolate() { return 0; } },
      View: nativeComponent('Animated.View'),
      event: () => () => {},
      timing: () => ({ start: (cb?: (result: { finished: boolean }) => void) => cb?.({ finished: true }), stop() {} }),
      sequence: () => ({ start: (cb?: (result: { finished: boolean }) => void) => cb?.({ finished: true }), stop() {} }),
      loop: () => ({ start: () => {}, stop: () => {} }),
    },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('LinearGradient', props, children),
}));

vi.mock('expo-web-browser', () => ({
  openBrowserAsync: vi.fn(),
  openAuthSessionAsync: browserMock.openAuthSessionAsync,
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  useLocalSearchParams: () => paramsState.params,
  useFocusEffect: (callback: () => void) => {
    const React = require('react') as typeof import('react');
    React.useEffect(callback, [callback]);
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const theme = {
  accent: '#C7CDD5',
  accentDim: '#34383E',
  accentLight: '#F8FAFC',
  secondary: '#172554',
  secondaryDim: '#172554',
  primaryGradient: ['#C7CDD5', '#727A84'],
  onAccent: '#FFFFFF',
};

vi.mock('@/contexts/AppThemeContext', () => ({
  getOnAccentTextStyle: () => ({}),
  useAppTheme: () => ({ theme }),
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#09090B',
    card: '#18181B',
    border: '#27272A',
    foreground: '#FAFAFA',
    mutedForeground: '#A1A1AA',
    primary: theme.accent,
    secondary: theme.secondary,
    success: '#22C55E',
    destructive: '#EF4444',
    info: '#38BDF8',
    infoDim: '#172554',
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  useApi: () => apiMock,
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => apiMock,
}));

vi.mock('@/components/ui/RetryRow', () => ({
  RetryRow: (props: Record<string, unknown>) => require('react').createElement('RetryRow', props),
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'user_test' }),
}));

vi.mock('@/hooks/useTeamRole', () => ({
  useTeamRole: () => ({ currentRole: roleState.currentRole, isLoadingRole: false }),
}));

vi.mock('@/lib/revenueCat', () => ({
  useRevenueCat: () => ({
    available: false,
    packages: [],
    purchase: vi.fn(),
    restore: vi.fn(),
    managementURL: null,
  }),
}));

vi.mock('@/lib/pollSubscriptionStatus', () => ({
  pollSubscriptionStatus: vi.fn(),
}));

vi.mock('@/lib/subscriptionRecovery', () => ({
  getBillingRecoveryTarget: vi.fn(() => 'subscription'),
  isSubscriptionPaymentRecoveryRequired: vi.fn(() => false),
}));

vi.mock('@/lib/growthTools', () => ({
  getGrowthStudioTools: vi.fn(() => []),
  GROWTH_EXTRAS: [],
}));

vi.mock('@/lib/sellerBilling', () => ({
  SELLER_PACKAGE_IDS: { starter: '$bt_starter', growth: '$bt_growth', pro: '$bt_pro' },
}));

vi.mock('@/components/ScreenHeader', () => ({
  ScreenHeader: ({ title, subtitle, rightElement }: {
    title: string;
    subtitle?: string;
    rightElement?: React.ReactNode;
  }) => React.createElement(
    'ScreenHeader',
    null,
    React.createElement('Text', null, title),
    subtitle ? React.createElement('Text', null, subtitle) : null,
    rightElement,
  ),
}));

// The first-visit explainer needs FirstRunTipsProvider; it is not under test here.
vi.mock('@/components/first-run-tips/ScreenExplainer', () => ({
  ScreenExplainer: () => null,
}));

vi.mock('@/components/Badge', () => ({
  Badge: ({ label }: { label: string }) => React.createElement('Text', null, label),
}));

vi.mock('@/components/RoleLockedView', () => ({
  RoleLockedView: ({ screenTitle }: { screenTitle: string }) =>
    React.createElement('RoleLockedView', { screenTitle }, React.createElement('Text', null, 'Owner access required')),
}));

vi.mock('@/components/StripeConnectWarning', () => ({
  default: () => null,
  normalizeConnectStatus: (value: unknown) => value,
}));

import PayoutsScreen from './payouts';

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(text).join(' ');
  if (!value || typeof value !== 'object') return '';
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return text(node.children ?? node.props?.children);
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<PayoutsScreen />); await flush(); });
  return r;
}

const has = (r: ReactTestRenderer, testID: string) => r.root.findAllByProps({ testID }).length > 0;

beforeEach(() => {
  roleState.currentRole = 'owner';
  paramsState.params = {};
  apiMock.finance.balance.mockResolvedValue({ available: { amount: 0, formatted: '$0.00' }, pending: { amount: 0, formatted: '$0.00' }, nextPayout: null, connected: true });
  apiMock.finance.payouts.mockResolvedValue({ payouts: [] });
  apiMock.finance.firstPayout.mockResolvedValue({ identityRequired: false });
  apiMock.seller.connect.onboard.mockResolvedValue({ url: 'https://connect.stripe.com/setup/e/acct_1/abc', stripeAccountId: 'acct_1' });
});

afterEach(() => { vi.clearAllMocks(); });

describe('Payouts journey screens', () => {
  it.each([
    ['not_started', 'Set up payouts', 'Set up payouts'],
    ['onboarding_incomplete', 'Finish setting up payouts', 'Resume setup'],
    ['pending_verification', 'Stripe is verifying your info', null],
    ['action_needed', 'Stripe needs more info', 'Update info on Stripe'],
  ] as const)('%s: its own setup screen, no manage page, no "unavailable"', async (state, title, cta) => {
    apiMock.seller.connect.status.mockResolvedValue(fixtureJourneyStatus(state));
    const r = await render();
    const screen = text(r.toJSON());

    expect(has(r, `payouts-journey-${state}`)).toBe(true);
    expect(screen).toContain(title);
    expect(has(r, 'payouts-journey-cta')).toBe(cta !== null);
    if (cta) expect(r.root.findByProps({ testID: 'payouts-journey-cta' }).props.label).toBe(cta);
    expect(has(r, 'seller-payouts-tab-payouts')).toBe(false);
    expect(screen).not.toMatch(/unavailable/i);
  });

  it('state 1 explains what payouts need', async () => {
    apiMock.seller.connect.status.mockResolvedValue(fixtureJourneyStatus('not_started'));
    const screen = text((await render()).toJSON());
    for (const need of ['Bank account', 'Photo ID', 'SSN or EIN']) expect(screen).toContain(need);
  });

  it('state 2 (verifying) offers a status check instead of a setup button', async () => {
    apiMock.seller.connect.status.mockResolvedValue(fixtureJourneyStatus('pending_verification'));
    const r = await render();
    expect(has(r, 'payouts-journey-refresh')).toBe(true);
    expect(text(r.toJSON())).toContain('In review');
  });

  it('state 3 says exactly what Stripe needs and by when', async () => {
    apiMock.seller.connect.status.mockResolvedValue(fixtureJourneyStatus('action_needed'));
    const r = await render();
    const screen = text(r.toJSON());
    expect(screen).toContain('Photo ID');
    expect(screen).toContain('Past due');
    expect(has(r, 'payouts-journey-deadline')).toBe(true);
  });

  it('state 4 (active) is the manage page', async () => {
    apiMock.seller.connect.status.mockResolvedValue(fixtureJourneyStatus('active'));
    const r = await render();
    expect(has(r, 'seller-payouts-tab-payouts')).toBe(true);
    expect(has(r, 'payouts-journey-cta')).toBe(false);
    expect(text(r.toJSON())).toContain('Payout balance');
  });

  it('a live account that owes Stripe info keeps the manage page with the ask on top', async () => {
    apiMock.seller.connect.status.mockResolvedValue({ ...fixtureJourneyStatus('action_needed'), payoutsEnabled: true });
    const r = await render();
    expect(has(r, 'seller-payouts-tab-payouts')).toBe(true);
    expect(has(r, 'seller-payouts-action-needed')).toBe(true);
  });

  it('shows a skeleton (not the manage page) until Stripe answers', async () => {
    apiMock.seller.connect.status.mockReturnValue(new Promise(() => {}));
    const r = await render();
    expect(has(r, 'payouts-status-loading')).toBe(true);
    expect(has(r, 'seller-payouts-tab-payouts')).toBe(false);
  });

  it.each([
    ['a failed request', () => apiMock.seller.connect.status.mockRejectedValue(new Error('API 500: boom'))],
    ['an unreadable Stripe account', () => apiMock.seller.connect.status.mockResolvedValue({ connected: true, payoutState: null })],
  ])('%s is a retry, never a guessed state', async (_name, arrange) => {
    arrange();
    const r = await render();
    const retry = r.root.findAll((n) => String(n.type) === 'RetryRow');
    expect(retry).toHaveLength(1);
    expect(retry[0].props.label).toBe("Couldn't check your payout status with Stripe");
    expect(has(r, 'seller-payouts-tab-payouts')).toBe(false);
  });

  it('the setup button opens hosted Stripe onboarding and re-reads status on return', async () => {
    apiMock.seller.connect.status
      .mockResolvedValueOnce(fixtureJourneyStatus('not_started'))
      .mockResolvedValue(fixtureJourneyStatus('pending_verification'));
    const r = await render();
    await act(async () => { r.root.findByProps({ testID: 'payouts-journey-cta' }).props.onPress(); await flush(); });

    expect(apiMock.seller.connect.onboard).toHaveBeenCalledTimes(1);
    expect(browserMock.openAuthSessionAsync).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/abc', 'brandthread://payouts');
    expect(has(r, 'payouts-journey-pending_verification')).toBe(true);
  });

  it('an expired Stripe link (?refresh=1) opens a fresh one automatically', async () => {
    paramsState.params = { refresh: '1' };
    apiMock.seller.connect.status.mockResolvedValue(fixtureJourneyStatus('onboarding_incomplete'));
    await render();
    await act(async () => { await flush(); });
    expect(apiMock.seller.connect.onboard).toHaveBeenCalledTimes(1);
  });

  it('staff without setup rights get the owner note, no button', async () => {
    roleState.currentRole = 'manager';
    apiMock.seller.connect.status.mockRejectedValue(new Error(`API 403: ${JSON.stringify({ code: 'ROLE_REQUIRED', requiredRole: 'owner', currentRole: 'manager' })}`));
    apiMock.finance.balance.mockResolvedValue({ available: { amount: 0 }, pending: { amount: 0 }, connected: false });
    const r = await render();
    expect(has(r, 'payouts-journey-not_started')).toBe(true);
    expect(has(r, 'payouts-journey-cta')).toBe(false);
    expect(text(r.toJSON())).toContain('The store owner sets them up');
  });
});
