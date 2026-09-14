import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { BuyerOrderView } from '@/services/orderTypes';
import { CANCELLATION_REASONS } from '@/services/orderTypes';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => {
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
    Modal: nativeComponent('Modal'),
    RefreshControl: nativeComponent('RefreshControl'),
    ScrollView: nativeComponent('ScrollView'),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
  };
});

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useLocalSearchParams: vi.fn(() => ({ id: 'order-1' })),
  useRouter: vi.fn(() => ({ back: vi.fn(), push: vi.fn() })),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: 'buyer-1' }),
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => ({}),
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ primary: '#C7CDD5' }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#C7CDD5',
      accentDim: '#34383E',
      accentLight: '#F8FAFC',
      secondary: '#7D8793',
      secondaryDim: '#172554',
      primaryGradient: ['#17191D', '#727A84'],
    },
  }),
}));

vi.mock('expo-clipboard', () => ({}));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

vi.mock('@/components/BrandthreadUI', () => {
  const native = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return {
    BrandthreadCard: native('BrandthreadCard'),
    BrandthreadHeader: native('BrandthreadHeader'),
    BrandthreadScreen: native('BrandthreadScreen'),
    GradientCard: native('GradientCard'),
    PrimaryButton: native('PrimaryButton'),
    SecondaryButton: native('SecondaryButton'),
    StatusBadge: native('StatusBadge'),
  };
});

vi.mock('@/lib/theme', () => ({
  BG: '#0A0A0B',
  SCREEN_BG: 'transparent',
  CARD: '#18181B',
  CARD_ELEVATED: '#222226',
  BORDER: '#303044',
  FG: '#F7F7FA',
  MUTED: '#AAAABC',
  SUBTLE: '#77778A',
  ACCENT: '#5B5CFF',
  ACCENT_LIGHT: '#8B8CFF',
  ON_DARK: '#FFFFFF',
  SUCCESS: '#10B981',
  SUCCESS_DIM: '#103D31',
  BLUE: '#3B82F6',
  BLUE_DIM: '#172554',
  ORANGE: '#F97316',
  ORANGE_DIM: '#3F2A00',
  RED: '#F87171',
  RED_DIM: '#3F2020',
  GOLD: '#F59E0B',
  FONT: { regular: 'System', semibold: 'System', bold: 'System' },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, pill: 999 },
  COMP: { buttonH: 52, tabBarH: 64 },
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xxl: 40 },
}));

import { BuyerCancellationDetailsCard, BuyerTrackingAlertCard } from '@/app/buyer-order-detail';

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

function renderCard(order: Partial<BuyerOrderView>): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <BuyerCancellationDetailsCard order={order as BuyerOrderView} />,
    );
  });
  return renderer;
}

describe('buyer order cancellation details', () => {
  const cases: Array<{
    label: string;
    order: Partial<BuyerOrderView>;
    shouldRender: boolean;
  }> = [
    {
      label: 'a non-cancelled order',
      order: { status: 'processing', cancellationReason: 'out_of_stock', isCustomerVisible: true },
      shouldRender: false,
    },
    {
      label: 'a cancelled order without a reason',
      order: { status: 'cancelled', cancellationReason: null, isCustomerVisible: true },
      shouldRender: false,
    },
    {
      label: 'a cancelled order with a hidden reason',
      order: { status: 'cancelled', cancellationReason: 'out_of_stock', isCustomerVisible: false },
      shouldRender: false,
    },
    {
      label: 'a cancelled order with a visible reason',
      order: {
        status: 'cancelled',
        cancellationReason: 'out_of_stock',
        cancellationNotes: 'The supplier could not replenish this item.',
        isCustomerVisible: true,
      },
      shouldRender: true,
    },
  ];

  it.each(cases)('renders the card only for $label', ({ order, shouldRender }) => {
    const renderer = renderCard(order);
    const cards = renderer.root.findAll((node: any) => node.type === 'GradientCard');

    expect(cards).toHaveLength(shouldRender ? 1 : 0);

    if (shouldRender) {
      const reasonLabel = CANCELLATION_REASONS.find(
        (reason) => reason.key === order.cancellationReason,
      )?.label;
      expect(textContent(cards[0])).toContain(reasonLabel);
      expect(textContent(cards[0])).toContain(order.cancellationNotes);
    }
  });
});

describe('buyer order tracking alerts', () => {
  it.each([
    ['out_for_delivery', 'Arriving today'],
    ['exception', 'Delivery problem'],
    ['returned_to_sender', 'Package returning to sender'],
  ] as const)('shows the %s alert', (trackingStatus, expectedTitle) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<BuyerTrackingAlertCard trackingStatus={trackingStatus} />);
    });

    expect(textContent(renderer.toJSON())).toContain(expectedTitle);
  });

  it('stays hidden for routine tracking updates', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<BuyerTrackingAlertCard trackingStatus="in_transit" />);
    });

    expect(renderer.toJSON()).toBeNull();
  });
});
