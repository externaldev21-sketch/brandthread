import React, { type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/networkNotice';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  alertMock,
  checkoutMock,
  subscriptionPortalMock,
  linkMock,
  pushMock,
  api,
} = vi.hoisted(() => {
  const subscriptionStatus = vi.fn();
  const invoices = vi.fn();
  const checkout = vi.fn();
  const subscriptionPortal = vi.fn();
  return {
    alertMock: vi.fn(),
    checkoutMock: checkout,
    subscriptionPortalMock: subscriptionPortal,
    linkMock: vi.fn(),
    pushMock: vi.fn(),
    api: {
      seller: {
        subscription: {
          status: subscriptionStatus,
          invoices,
          checkout,
          portal: subscriptionPortal,
        },
      },
    },
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
    Alert: { alert: alertMock },
    AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    Linking: { openURL: linkMock },
    Platform: { OS: 'web', select: (obj: Record<string, unknown>) => obj.web ?? obj.default },
    ScrollView: nativeComponent('ScrollView'),
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

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, ...props }: { children?: ReactNode }) =>
    React.createElement('LinearGradient', props, children),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    React.useEffect(callback, [callback]);
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#000000',
    card: '#111111',
    border: '#222222',
    foreground: '#ffffff',
    mutedForeground: '#aaaaaa',
    primary: '#c7cdd5',
    secondary: '#18181b',
    success: '#22c55e',
    destructive: '#ef4444',
  }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  getOnAccentTextStyle: () => ({}),
  useAppTheme: () => ({
    theme: {
      accent: '#c7cdd5',
      accentDim: '#34383e',
      accentLight: '#f8fafc',
      secondary: '#172554',
      secondaryDim: '#172554',
      primaryGradient: ['#c7cdd5', '#34383e'],
      onAccent: '#ffffff',
    },
  }),
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => api,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => api,
}));

vi.mock('@/hooks/useTeamRole', () => ({
  useTeamRole: () => ({ currentRole: 'owner', isLoadingRole: false }),
}));

vi.mock('@/lib/revenueCat', () => ({
  useRevenueCat: () => ({
    available: true,
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
  getBillingRecoveryTarget: () => 'stripe',
  isSubscriptionPaymentRecoveryRequired: () => false,
}));

vi.mock('@/hooks/useSubscriptionPlan', () => ({
  invalidatePlanCache: vi.fn(),
}));

vi.mock('@/components/RoleLockedView', () => ({
  RoleLockedView: () => null,
}));

vi.mock('@/components/ScreenHeader', () => ({
  ScreenHeader: ({ title }: { title: string }) => React.createElement('ScreenHeader', { title }),
}));

vi.mock('@/lib/theme', () => ({
  BG: '#000000',
  SCREEN_BG: 'transparent',
  CARD: '#111111',
  CARD_ELEVATED: '#18181b',
  BORDER: '#222222',
  FG: '#ffffff',
  MUTED: '#aaaaaa',
  SUBTLE: '#666666',
  PURPLE: '#c7cdd5',
  PURPLE_DIM: '#34383e',
  PURPLE_LIGHT: '#f8fafc',
  CYAN: '#22d3ee',
  SUCCESS: '#22c55e',
  ORANGE: '#f97316',
  RED: '#ef4444',
  FONT: { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold' },
  FS: { xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28 },
  SP: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  RADIUS: { sm: 8, md: 10, lg: 14, xl: 18, pill: 999 },
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xl: 28, xxl: 36 },
  GUTTER: 16,
  SECTION_GAP: 24,
  CONTENT_MAX_WIDTH: 720,
  GRID_MAX_WIDTH: 1080,
  BREAKPOINT: { tablet: 768, desktopWeb: 1024 },
  TYPE: {
    largeTitle: { fontSize: 36, fontFamily: 'Inter_700Bold', lineHeight: 42 },
    title: { fontSize: 30, fontFamily: 'Inter_700Bold', lineHeight: 36 },
    heading: { fontSize: 22, fontFamily: 'Inter_600SemiBold', lineHeight: 28 },
    subheading: { fontSize: 19, fontFamily: 'Inter_600SemiBold', lineHeight: 24 },
    body: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22 },
    bodyMedium: { fontSize: 15, fontFamily: 'Inter_500Medium', lineHeight: 22 },
    caption: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
    label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', lineHeight: 14 },
  },
}));

vi.mock('@/lib/growthTools', () => ({
  GROWTH_EXTRAS: [],
  getGrowthStudioTools: () => [],
}));

import BillingScreen from '../app/billing';
import SubscriptionScreen from '../app/subscription';

const roleError = () => new ApiError(403, JSON.stringify({
  error: {
    code: 'ROLE_REQUIRED',
    message: 'Owner access is required.',
    details: { requiredRole: 'owner', currentRole: 'manager' },
  },
}));

const serverError = () => new ApiError(500, JSON.stringify({
  error: { code: 'INTERNAL_ERROR', message: 'Billing service unavailable.' },
}));

function findAction(renderer: ReactTestRenderer, testID: string) {
  const action = renderer.root.findAll((node) => node.props.testID === testID)[0];
  if (!action) throw new Error(`Could not find action ${testID}`);
  return action;
}

async function press(renderer: ReactTestRenderer, testID: string) {
  await act(async () => {
    await findAction(renderer, testID).props.onPress();
  });
}

async function renderScreen(
  Screen: typeof BillingScreen | typeof SubscriptionScreen,
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Screen />);
    await Promise.resolve();
  });
  return renderer;
}

beforeEach(() => {
  alertMock.mockReset();
  checkoutMock.mockReset();
  subscriptionPortalMock.mockReset();
  linkMock.mockReset();
  pushMock.mockReset();
  api.seller.subscription.status.mockResolvedValue({
    plan: 'starter',
    amountCents: 2900,
    renewsOn: 'Sep 30, 2026',
    trialEnd: null,
    status: 'active',
    effectiveProvider: 'stripe',
    paymentMethodLabel: 'Visa ending in 4242',
  });
  api.seller.subscription.invoices.mockResolvedValue({ invoices: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('owner-only billing actions', () => {
  it('shows the owner-only message for a billing portal ROLE_REQUIRED response', async () => {
    subscriptionPortalMock.mockRejectedValueOnce(roleError());
    const renderer = await renderScreen(BillingScreen);

    await press(renderer, 'seller-billing-payment-method');

    expect(alertMock).toHaveBeenCalledWith('Only the store owner can do this');
    expect(linkMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('shows a human error instead of the deleted billing portal fallback for non-role failures', async () => {
    subscriptionPortalMock.mockRejectedValueOnce(serverError());
    const renderer = await renderScreen(BillingScreen);

    await press(renderer, 'seller-billing-payment-method');

    expect(alertMock).toHaveBeenCalledWith("Couldn't open billing. Try again.");
    expect(pushMock).not.toHaveBeenCalledWith('/plan-details');
    renderer.unmount();
  });

  it('shows the owner-only message for subscription checkout and does not open Stripe', async () => {
    checkoutMock.mockRejectedValueOnce(roleError());
    const renderer = await renderScreen(SubscriptionScreen);

    await press(renderer, 'seller-subscription-change-growth');

    expect(alertMock).toHaveBeenCalledWith('Only the store owner can do this');
    expect(linkMock).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('keeps the checkout error fallback for non-role failures', async () => {
    checkoutMock.mockRejectedValueOnce(serverError());
    const renderer = await renderScreen(SubscriptionScreen);

    await press(renderer, 'seller-subscription-change-growth');

    expect(alertMock).toHaveBeenCalledWith('Checkout error', 'API 500: Billing service unavailable.');
    renderer.unmount();
  });

  it('shows the owner-only message for the subscription portal', async () => {
    subscriptionPortalMock.mockRejectedValueOnce(roleError());
    const renderer = await renderScreen(SubscriptionScreen);

    await press(renderer, 'seller-subscription-cancel');

    expect(alertMock).toHaveBeenCalledWith('Only the store owner can do this');
    expect(linkMock).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('keeps the portal error fallback for non-role failures', async () => {
    subscriptionPortalMock.mockRejectedValueOnce(serverError());
    const renderer = await renderScreen(SubscriptionScreen);

    await press(renderer, 'seller-subscription-cancel');

    expect(alertMock).toHaveBeenCalledWith('Portal error', 'API 500: Billing service unavailable.');
    renderer.unmount();
  });
});