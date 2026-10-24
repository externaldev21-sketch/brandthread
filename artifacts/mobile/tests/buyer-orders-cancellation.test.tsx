import React from 'react';
vi.mock('expo-store-review', () => ({ isAvailableAsync: async () => false, requestReview: async () => {} }));
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuyerOrderView } from '@/services/orderTypes';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getBuyerOrdersWithStatusMock, getBuyerReturnsMock, routerMock } = vi.hoisted(() => ({
  getBuyerOrdersWithStatusMock: vi.fn(),
  getBuyerReturnsMock: vi.fn(),
  routerMock: { push: vi.fn() },
}));

vi.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => React.createElement('Image', props),
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
    ScrollView: nativeComponent('ScrollView'),
    Pressable: nativeComponent('Pressable'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    NativeModules: {},
    KeyboardAvoidingView: nativeComponent('KeyboardAvoidingView'),
    TurboModuleRegistry: { get: () => null },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    Animated: {
      Value: class { _value: number; constructor(v?: number) { this._value = v ?? 0; } setValue(v: number) { this._value = v; } interpolate() { return this._value; } },
      View: nativeComponent('Animated.View'),
      event: () => () => {},
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
      sequence: () => ({ start: (cb?: () => void) => cb?.() }),
      loop: () => ({ start: () => {}, stop: () => {} }),
    },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    // The floating buyer tab bar inset reads the window size.
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
  };
});

// The filter chip row's trailing fade uses LinearGradient, which calls
// react-native's processColor internally — not present on this suite's
// plain react-native mock above. Stub it like the other native-only mocks.
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: (props: Record<string, unknown>) => React.createElement('LinearGradient', props, props.children as React.ReactNode),
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: 'buyer-1' }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name, color }: { name: string; color?: string }) =>
    React.createElement('Feather', { name, color }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react') as typeof import('react');
    React.useEffect(callback, [callback]);
  },
  useScrollToTop: () => {},
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#07070F',
      card: '#12121F',
      cardElevated: '#18182E',
      border: '#303044',
      text: '#F4F4FF',
      muted: '#AAAABC',
      subtle: '#77778A',
      accent: '#C7CDD5',
      accentDim: '#34383E',
      accentLight: '#F8FAFC',
      onAccent: '#0A0A0B',
      secondary: '#22D3EE',
      secondaryDim: '#164E63',
      success: '#10B981',
      warning: '#F97316',
      error: '#F87171',
    },
  }),
}));

vi.mock('@/lib/money', () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

vi.mock('@/lib/theme', () => ({
  BG: '#07070F',
  SCREEN_BG: 'transparent',
  CARD: '#12121F',
  CARD_GLASS: 'rgba(18,18,31,0.72)',
  CARD_ELEVATED: '#18182E',
  BORDER: '#303044',
  FG: '#F4F4FF',
  ACCENT: '#F7F7FA',
  MUTED: '#AAAABC',
  SUBTLE: '#77778A',
  SUCCESS: '#10B981',
  SUCCESS_DIM: '#103D31',
  BLUE: '#38BDF8',
  BLUE_DIM: '#172554',
  ORANGE: '#F97316',
  ORANGE_DIM: '#3F2A00',
  GOLD: '#F59E0B',
  RED: '#F87171',
  RED_DIM: '#3F2020',
  GRAD_DARK_FADE: ['rgba(10,10,11,0)', 'rgba(10,10,11,1)'],
  ELEVATION: { background: '#000000', card: '#1C1C1E', sheet: '#1C1C1E', input: '#2C2C2E' },
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
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xl: 28, xxl: 40 },
  GUTTER: 16,
  WEB_SAFE_AREA_TOP: 47,
  SECTION_GAP: 24,
  CONTENT_MAX_WIDTH: 720,
  GRID_MAX_WIDTH: 1080,
  BREAKPOINT: { tablet: 768, desktopWeb: 1024 },
  TYPE: {
    largeTitle: { fontSize: 36, fontFamily: 'System', lineHeight: 42 },
    title: { fontSize: 30, fontFamily: 'System', lineHeight: 36 },
    heading: { fontSize: 22, fontFamily: 'System', lineHeight: 28 },
    subheading: { fontSize: 19, fontFamily: 'System', lineHeight: 24 },
    body: { fontSize: 15, fontFamily: 'System', lineHeight: 22 },
    bodyMedium: { fontSize: 15, fontFamily: 'System', lineHeight: 22 },
    caption: { fontSize: 13, fontFamily: 'System', lineHeight: 18 },
    label: { fontSize: 11, fontFamily: 'System', lineHeight: 14 },
  },
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
    PressableScale: native('PressableScale'),
    SearchBar: native('SearchBar'),
  };
});

vi.mock('@/services/orderService', () => ({
  getBuyerOrdersWithStatus: getBuyerOrdersWithStatusMock,
}));

// Pulled in transitively (reorder flow → cart); the native module isn't
// available under Vitest. This suite failed to load without it.
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

// The selected filter tab is persisted to storage; keep it per render here
// so the Returns-tab tests don't leak "returns" into the next test.
vi.mock('@/hooks/usePersistedChoice', () => ({
  usePersistedChoice: <T,>(_key: string, initial: T) => {
    const React = require('react') as typeof import('react');
    return React.useState<T>(initial);
  },
}));

vi.mock('@/services/buyerReturnsService', () => ({
  getBuyerReturns: getBuyerReturnsMock,
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

    // Only the cancellation banner marks a cancelled order: the compact
    // OrderStatusTimeline's "Cancelled" exception pill was a duplicate right
    // above it and is no longer rendered for cancelled orders.
    const cancellationIcons = renderer.root.findAll(
      node => (node.type as unknown) === 'Feather'
        && node.props.name === 'x-circle'
        && node.props.color === '#F87171',
    );
    expect(cancellationIcons).toHaveLength(1);
    // Only the cancelled card loses its timeline; the active order keeps its progress.
    expect(renderer.root.findAll(
      node => typeof node.type === 'function' && node.type.name === 'OrderStatusTimeline',
    )).toHaveLength(0);

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

  it('keeps the timeline exception pill for refunded orders (no banner there)', async () => {
    getBuyerOrdersWithStatusMock.mockResolvedValue({
      orders: [{ ...baseOrder, status: 'refunded', cancellationReason: null }],
      error: null,
    });

    renderer = await renderScreen();

    expect(renderer.root.findAll(
      node => typeof node.type === 'function' && node.type.name === 'OrderStatusTimeline',
    )).toHaveLength(1);
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text' && textContent(node.props.children) === 'Order cancelled',
    )).toHaveLength(0);
  });

  it('renders the friendly shared label for buyer_requested', async () => {
    getBuyerOrdersWithStatusMock.mockResolvedValue({
      orders: [{
        ...baseOrder,
        cancellationReason: 'buyer_requested',
      }],
      error: null,
    });

    renderer = await renderScreen();

    const cancellationReasons = renderer.root.findAll(
      node => (node.type as unknown) === 'Text'
        && textContent(node.props.children).includes('You requested the cancellation'),
    );
    expect(cancellationReasons).toHaveLength(1);
    expect(renderer.root.findAll(
      node => (node.type as unknown) === 'Text'
        && textContent(node.props.children).includes('buyer_requested'),
    )).toHaveLength(0);
  });
});
describe('buyer orders Returns tab and Track Shipment (items 108, 109)', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    getBuyerOrdersWithStatusMock.mockReset();
    getBuyerReturnsMock.mockReset();
    routerMock.push.mockReset();
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => { renderer?.unmount(); });
      renderer = undefined;
    }
  });

  async function openReturnsTab(r: ReactTestRenderer) {
    // The filters are now underlined text tabs (Pressable, role "tab").
    const chip = r.root.findAll(node => (node.type as unknown) === 'Pressable'
      && node.props.accessibilityRole === 'tab' && node.props.accessibilityLabel === 'Returns')[0];
    await act(async () => {
      chip.props.onPress();
      await flushPromises();
    });
  }

  it('loads the buyer returns from the server and opens the return status screen', async () => {
    getBuyerOrdersWithStatusMock.mockResolvedValue({ orders: [baseOrder], error: null });
    getBuyerReturnsMock.mockResolvedValue([{
      id: 'ret-1', orderId: 'order-1', orderNumber: 'BT-1001', buyerId: 'buyer-1', sellerId: 'seller-1',
      buyerName: 'Buyer', sellerName: 'Demo Seller', status: 'approved', reason: 'other', notes: '',
      evidenceUrls: [], items: [], refundAmountCents: null, orderTotalCents: 4200, sellerResponse: null,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
    }]);

    renderer = await renderScreen();
    expect(getBuyerReturnsMock).not.toHaveBeenCalled();
    await openReturnsTab(renderer);

    expect(getBuyerReturnsMock).toHaveBeenCalledTimes(1);
    const card = renderer.root.findAll(node => (node.type as unknown) === 'TouchableOpacity'
      && typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('Return for order BT-1001'))[0];
    expect(card).toBeTruthy();
    await act(async () => { card.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/return-detail?returnId=ret-1');
  });

  it('shows an error with retry when returns fail to load', async () => {
    getBuyerOrdersWithStatusMock.mockResolvedValue({ orders: [baseOrder], error: null });
    getBuyerReturnsMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);

    renderer = await renderScreen();
    await openReturnsTab(renderer);

    const errorState = renderer.root.findAll(node => (node.type as unknown) === 'EmptyState' && node.props.title === "Couldn't load your returns.")[0];
    expect(errorState).toBeTruthy();
    await act(async () => {
      errorState.props.action.onPress();
      await flushPromises();
    });
    expect(getBuyerReturnsMock).toHaveBeenCalledTimes(2);
    expect(renderer.root.findAll(node => (node.type as unknown) === 'EmptyState' && node.props.title === 'No returns')).toHaveLength(1);
  });

  it('Track Shipment opens the tracking screen, View Order Details opens the order', async () => {
    getBuyerOrdersWithStatusMock.mockResolvedValue({
      orders: [{ ...baseOrder, status: 'shipped', cancellationReason: null, trackingNumber: '1Z999', trackingCarrier: 'UPS', trackingStatus: 'in_transit' }],
      error: null,
    });
    renderer = await renderScreen();
    const track = renderer.root.findAll(node => (node.type as unknown) === 'TouchableOpacity' && node.props.accessibilityLabel === 'Track shipment')[0];
    await act(async () => { track.props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/buyer-order-tracking?id=order-1');
    expect(routerMock.push).not.toHaveBeenCalledWith('/buyer-order-detail?id=order-1');
  });
});
