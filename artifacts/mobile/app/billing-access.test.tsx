import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  apiMock,
  roleState,
  routerMock,
  roleError,
} = vi.hoisted(() => {
  const roleError = () => new Error(`API 403: ${JSON.stringify({
    code: 'ROLE_REQUIRED',
    requiredRole: 'owner',
    currentRole: roleState.currentRole,
    message: 'Only the store owner can do this',
  })}`);

  const apiMock = {
    finance: {
      balance: vi.fn(),
      transactions: vi.fn(),
      payouts: vi.fn(),
      summary: vi.fn(),
    },
    seller: {
      connect: {
        status: vi.fn(),
        onboard: vi.fn(),
      },
      subscription: {
        status: vi.fn(),
        invoices: vi.fn(),
        checkout: vi.fn(),
        portal: vi.fn(),
      },
    },
    team: {
      context: vi.fn(),
    },
  };

  const roleState = { currentRole: 'manager' as 'owner' | 'manager' | 'staff' };
  return {
    apiMock,
    roleState,
    routerMock: { back: vi.fn(), push: vi.fn() },
    roleError,
  };
});

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };

  return {
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Alert: { alert: vi.fn() },
    AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    Linking: { openURL: vi.fn(), canOpenURL: vi.fn(async () => true) },
    Platform: { OS: 'web', select: (obj: Record<string, unknown>) => obj.web ?? obj.default },
    Pressable: nativeComponent('Pressable'),
    ScrollView: nativeComponent('ScrollView'),
    Share: { share: vi.fn() },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    Animated: {
      Value: class { constructor(_v?: number) {} },
      View: nativeComponent('Animated.View'),
      event: () => () => {},
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
      sequence: () => ({ start: (cb?: () => void) => cb?.() }),
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
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  useLocalSearchParams: () => ({}),
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

vi.mock('@/lib/api', () => ({
  useApi: () => apiMock,
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => apiMock,
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

import BillingScreen from './billing';
import SubscriptionScreen from './subscription';
import FinanceScreen from './finance';
import PayoutsScreen from './payouts';

type Screen = React.ComponentType;

function resetApiToRoleRequired() {
  apiMock.finance.balance.mockRejectedValue(roleError());
  apiMock.finance.transactions.mockRejectedValue(roleError());
  apiMock.finance.payouts.mockRejectedValue(roleError());
  apiMock.finance.summary.mockRejectedValue(roleError());
  apiMock.seller.connect.status.mockRejectedValue(roleError());
  apiMock.seller.subscription.status.mockRejectedValue(roleError());
  apiMock.seller.subscription.invoices.mockRejectedValue(roleError());
  apiMock.seller.subscription.checkout.mockRejectedValue(roleError());
  apiMock.seller.subscription.portal.mockRejectedValue(roleError());
  apiMock.seller.connect.onboard.mockRejectedValue(roleError());
  apiMock.team.context.mockRejectedValue(roleError());
}

async function renderScreen(ScreenComponent: Screen): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ScreenComponent />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

function screenText(renderer: ReactTestRenderer): string {
  return textContent(renderer.toJSON());
}

function hasTestId(renderer: ReactTestRenderer, testID: string): boolean {
  return renderer.root.findAllByProps({ testID }).length > 0;
}

function lockedViews(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => String(node.type) === 'RoleLockedView');
}

async function selectTab(renderer: ReactTestRenderer, testID: string) {
  const tab = renderer.root.findByProps({ testID });
  await act(async () => {
    tab.props.onPress();
    await Promise.resolve();
  });
}

describe('seller financial role boundaries', () => {
  beforeEach(() => {
    roleState.currentRole = 'manager';
    routerMock.back.mockReset();
    routerMock.push.mockReset();
    for (const group of Object.values(apiMock)) {
      for (const service of Object.values(group)) {
        if (typeof service === 'function' && 'mockReset' in service) {
          (service as ReturnType<typeof vi.fn>).mockReset();
        } else if (service && typeof service === 'object') {
          for (const method of Object.values(service)) {
            if (typeof method === 'function' && 'mockReset' in method) {
              (method as ReturnType<typeof vi.fn>).mockReset();
            }
          }
        }
      }
    }
    resetApiToRoleRequired();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['billing', BillingScreen, 'Upcoming bill'],
    ['subscription', SubscriptionScreen, 'Current plan'],
    ['finance', FinanceScreen, 'Summary'],
    ['payouts', PayoutsScreen, 'Payout history'],
  ])('renders the manager %s view when owner-only APIs return ROLE_REQUIRED', async (_name, ScreenComponent, expectedText) => {
    const renderer = await renderScreen(ScreenComponent);

    expect(screenText(renderer)).toContain(expectedText);
    expect(lockedViews(renderer)).toHaveLength(0);
  });

  it('hides every owner-only financial control from managers', async () => {
    const billing = await renderScreen(BillingScreen);
    const subscription = await renderScreen(SubscriptionScreen);
    const finance = await renderScreen(FinanceScreen);
    const payouts = await renderScreen(PayoutsScreen);

    for (const testID of [
      'seller-billing-view-bill',
      'seller-billing-view-breakdown',
      'seller-billing-payment-method',
      'seller-subscription-change-growth',
      'seller-subscription-change-pro',
      'seller-subscription-cancel',
      'seller-subscription-manage-billing',
      'seller-payouts-bank-account',
    ]) {
      expect(hasTestId(billing, testID) || hasTestId(subscription, testID) || hasTestId(finance, testID) || hasTestId(payouts, testID)).toBe(false);
    }

    await selectTab(subscription, 'seller-subscription-tab-billing');
    await selectTab(payouts, 'seller-payouts-tab-settings');
    expect(hasTestId(subscription, 'seller-subscription-manage-billing')).toBe(false);
    expect(hasTestId(payouts, 'seller-payouts-bank-account')).toBe(false);
    expect(screenText(finance)).not.toContain('Download Statement (CSV)');
  });

  it('keeps staff on the locked view for all four financial screens', async () => {
    roleState.currentRole = 'staff';

    for (const ScreenComponent of [BillingScreen, SubscriptionScreen, FinanceScreen, PayoutsScreen]) {
      const renderer = await renderScreen(ScreenComponent);
      expect(lockedViews(renderer)).toHaveLength(1);
    }
  });

  it('keeps owner controls available', async () => {
    roleState.currentRole = 'owner';

    const billing = await renderScreen(BillingScreen);
    const subscription = await renderScreen(SubscriptionScreen);
    const finance = await renderScreen(FinanceScreen);
    const payouts = await renderScreen(PayoutsScreen);

    expect(hasTestId(billing, 'seller-billing-payment-method')).toBe(true);
    expect(hasTestId(subscription, 'seller-subscription-change-growth')).toBe(true);
    expect(hasTestId(subscription, 'seller-subscription-change-pro')).toBe(true);
    expect(hasTestId(subscription, 'seller-subscription-cancel')).toBe(true);
    expect(screenText(finance)).toContain('Download Statement (CSV)');

    await selectTab(subscription, 'seller-subscription-tab-billing');
    await selectTab(payouts, 'seller-payouts-tab-settings');
    expect(hasTestId(subscription, 'seller-subscription-manage-billing')).toBe(true);
    expect(hasTestId(payouts, 'seller-payouts-bank-account')).toBe(true);
  });
});