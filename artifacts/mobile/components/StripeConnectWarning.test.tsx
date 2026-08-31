import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  api,
  canOpenURLMock,
  hapticMock,
  openURLMock,
} = vi.hoisted(() => ({
  api: {
    seller: {
      connect: {
        onboard: vi.fn(),
        status: vi.fn(),
      },
    },
  },
  canOpenURLMock: vi.fn(),
  hapticMock: vi.fn(),
  openURLMock: vi.fn(),
}));

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
    Alert: { alert: vi.fn() },
    AppState: {
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
    Linking: {
      canOpenURL: canOpenURLMock,
      openURL: openURLMock,
    },
    StyleSheet: { create: (styles: unknown) => styles },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
  };
});

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: hapticMock,
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    React.useEffect(callback, [callback]);
  },
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => api,
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#7c3aed',
      accentDim: '#2e1b55',
      onAccent: '#ffffff',
    },
  }),
}));

const { default: StripeConnectWarning } = await import('./StripeConnectWarning');
import type { ConnectStatus } from './StripeConnectWarning';

function status(overrides: Partial<ConnectStatus> = {}): ConnectStatus {
  return {
    connected: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    status: 'unknown',
    verified: false,
    bankLast4: null,
    ...overrides,
  };
}

async function renderWarning(connectStatus: ConnectStatus): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<StripeConnectWarning connectStatus={connectStatus} />);
    await Promise.resolve();
  });
  return renderer;
}

function warningButton(renderer: ReactTestRenderer) {
  return renderer.root.findAllByProps({
    accessibilityLabel: 'Fix Stripe Connect setup',
  })[0];
}

describe('StripeConnectWarning', () => {
  beforeEach(() => {
    api.seller.connect.onboard.mockReset();
    api.seller.connect.status.mockReset();
    canOpenURLMock.mockReset();
    hapticMock.mockReset();
    openURLMock.mockReset();
    canOpenURLMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['not connected', status()],
    ['pending verification', status({
      connected: true,
      status: 'pending',
    })],
    ['restricted', status({
      connected: true,
      chargesEnabled: true,
      status: 'restricted',
    })],
  ])('renders for an inactive Connect status: %s', async (_label, connectStatus) => {
    const renderer = await renderWarning(connectStatus);

    expect(warningButton(renderer)).toBeDefined();
    renderer.unmount();
  });

  it('hides for an active Connect status', async () => {
    const renderer = await renderWarning(status({
      connected: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      status: 'active',
      verified: true,
      bankLast4: '4242',
    }));

    expect(warningButton(renderer)).toBeUndefined();
    renderer.unmount();
  });

  it('requests Stripe onboarding and opens the returned URL from Fix Now', async () => {
    const onboardingUrl = 'https://connect.stripe.com/setup/test-account';
    api.seller.connect.onboard.mockResolvedValue({ url: onboardingUrl });

    const renderer = await renderWarning(status());
    await act(async () => {
      await warningButton(renderer).props.onPress();
    });

    expect(api.seller.connect.onboard).toHaveBeenCalledTimes(1);
    expect(canOpenURLMock).toHaveBeenCalledWith(onboardingUrl);
    expect(openURLMock).toHaveBeenCalledWith(onboardingUrl);
    expect(hapticMock).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });
});

describe('StripeConnectWarning screen placement', () => {
  const appRoot = path.resolve(__dirname, '../app');
  const source = (relativePath: string) => readFileSync(path.join(appRoot, relativePath), 'utf8');

  it('remains mounted on the seller dashboard', () => {
    const dashboard = source('(tabs)/index.tsx');

    expect(dashboard).toContain("import StripeConnectWarning from '@/components/StripeConnectWarning';");
    expect(dashboard).toMatch(/<StripeConnectWarning\s*\/>/);
  });

  it('remains mounted on Payouts', () => {
    const payouts = source('payouts.tsx');

    expect(payouts).toContain("import StripeConnectWarning, { ConnectStatus, normalizeConnectStatus } from '@/components/StripeConnectWarning';");
    expect(payouts).toMatch(/<StripeConnectWarning[\s\S]*connectStatus=\{connectStatus\}/);
  });

  it('remains mounted in the seller Settings Account section', () => {
    const settings = source('seller-settings.tsx');

    expect(settings).toContain("import StripeConnectWarning from '@/components/StripeConnectWarning';");
    expect(settings).toMatch(/key\s*===\s*['"]account['"][\s\S]{0,120}<StripeConnectWarning\s*\/>/);
  });
});