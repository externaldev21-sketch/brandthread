import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuyerOrderView } from '@/services/orderTypes';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getBuyerOrdersWithStatusMock, routerMock } = vi.hoisted(() => ({
  getBuyerOrdersWithStatusMock: vi.fn(),
  routerMock: { push: vi.fn() },
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
    FlatList: ({
      data,
      renderItem,
    }: {
      data?: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    }) => React.createElement(
      'FlatList',
      null,
      ...(data ?? []).map((item, index) => renderItem({ item, index })),
    ),
    RefreshControl: nativeComponent('RefreshControl'),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
  };
});

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: 'buyer-1' }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name, color }: { name: string; color?: string }) =>
    React.createElement('Feather', { name, color }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react') as typeof import('react');
    React.useEffect(callback, [callback]);
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#C7CDD5',
      accentDim: '#34383E',
      accentLight: '#F8FAFC',
      secondary: '#22D3EE',
      secondaryDim: '#164E63',
    },
  }),
}));

vi.mock('@/lib/money', () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

vi.mock('@/lib/theme', () => ({
  BG: '#07070F',
  CARD: '#12121F',
  CARD_ELEVATED: '#18182E',
  BORDER: '#303044',
  FG: '#F4F4FF',
  MUTED: '#AAAABC',
  SUBTLE: '#77778A',
  SUCCESS: '#10B981',
  SUCCESS_DIM: '#103D31',
  BLUE: '#38BDF8',
  BLUE_DIM: '#172554',
  ORANGE: '#F97316',
  ORANGE_DIM: '#3F2A00',
  RED: '#F87171',
  RED_DIM: '#3F2020',
  FONT: {
    regular: 'System',
    medium: 'System',
    semibold: 'System',
    bold: 'System',
  },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, pill: 999 },
  COMP: { tabBarH: 64 },
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xxl: 40 },
}));

vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  const native = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);

  return {
    BrandthreadScreen: native('BrandthreadScreen'),
    BrandthreadHeader: native('BrandthreadHeader'),
    FilterChip: native('FilterChip'),
    StatusBadge: native('StatusBadge'),
    EmptyState: native('EmptyState'),
    PrimaryButton: native('PrimaryButton'),
    BrandedLoader: native('BrandedLoader'),
  };
});

vi.mock('@/services/orderService', () => ({
  getBuyerOrdersWithStatus: getBuyerOrdersWithStatusMock,
}));

import BuyerOrdersScreen from '@/app/(buyer)/orders';

const baseOrder: BuyerOrderView = {
  id: 'order-1',
  orderNumber: 'BT-1001',
  sellerId: 'seller-1',
  sellerName: 'Demo Seller',
  sellerHandle: '@demo',
  status: 'cancelled',
  paymentStatus: 'refunded',
  fulfillmentStatus: 'cancelled',
  lineItems: [{
    productName: 'Everyday Tee',
    variant: 'M',
    quantity: 1,
    unitPriceCents: 4200,
  }],
  shippingAddress: {
    name: 'Buyer',
    line1: '1 Main Street',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    country: 'US',
  },
  payment: {
    subtotalCents: 4200,
    shippingTotalCents: 0,
    taxTotalCents: 0,
    totalCents: 4200,
  },
  isPreOrder: false,
  hasReturnRequest: false,
  cancellationReason: 'shipping_restriction_that_is_long_enough_to_need_truncation',
  createdAt: '2026-08-31T00:00:00.000Z',
};

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

async function flushPromises() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<BuyerOrdersScreen />);
    await flushPromises();
  });
  return renderer;
}

describe('buyer order cancellation banner', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    getBuyerOrdersWithStatusMock.mockReset();
    routerMock.push.mockReset();
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = undefined;
    }
  });

  it('shows a red cancellation indicator and keeps a long reason on one line', async () => {
    const activeOrder: BuyerOrderView = {
      ...baseOrder,
      id: 'order-2',
      orderNumber: 'BT-1002',
      status: 'processing',
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      cancellationReason: null,
    };
    getBuyerOrdersWithStatusMock.mockResolvedValue({
      orders: [baseOrder, activeOrder],
      error: null,
    });

    renderer = await renderScreen();

    const cancellationIcons = renderer.root.findAll(
      node => (node.type as unknown) === 'Feather'
        && node.props.name === 'x-circle'
        && node.props.color === '#F87171',
    );
    expect(cancellationIcons).toHaveLength(1);

    const cancellationReasons = renderer.root.findAll(
      node => (node.type as unknown) === 'Text'
        && textContent(node.props.children).includes('Shipping Restriction That Is Long Enough To Need Truncation'),
    );
    expect(cancellationReasons).toHaveLength(1);
    expect(cancellationReasons[0].props.numberOfLines).toBe(1);

    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text' && textContent(node.props.children) === 'Order cancelled',
    )).toHaveLength(1);
  });
});