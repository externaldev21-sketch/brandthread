/**
 * Full-screen behavioral test for the seller Orders tab: loading, success,
 * empty and error states, driven by mocking api.orders.list() directly and
 * mounting the real screen component.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { nativeComponent } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
}));

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  FlatList: nativeComponent('FlatList'),
  Modal: nativeComponent('Modal'),
  RefreshControl: nativeComponent('RefreshControl'),
  ScrollView: nativeComponent('ScrollView'),
  Share: { share: vi.fn() },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: nativeComponent('Text'),
  TextInput: nativeComponent('TextInput'),
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
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: nativeComponent('LinearGradient'),
}));

let routerPush = vi.fn();
vi.mock('expo-router', () => ({
  // Real useFocusEffect only fires on focus, not every render. A test always
  // has exactly one screen "focused" once on mount, so useEffect(..., [])
  // models that without re-running (and looping) on every re-render.
  useFocusEffect: (cb: () => void | (() => void)) => {
    React.useEffect(() => cb(), []); // eslint-disable-line react-hooks/exhaustive-deps
  },
  useRouter: () => ({ push: routerPush, back: vi.fn(), replace: vi.fn() }),
  useScrollToTop: () => {},
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockUserId: string | null = 'seller-1';
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: mockUserId, isLoaded: true, isSignedIn: !!mockUserId }),
}));

vi.mock('@/components/BrandthreadUI', () => ({
  FilterChip: nativeComponent('FilterChip'),
  SearchBar: nativeComponent('SearchBar'),
}));

vi.mock('@/components/layout', () => ({
  SkeletonBlock: nativeComponent('SkeletonBlock'),
  EmptyState: (props: { message: string; variant?: string }) =>
    React.createElement('EmptyState', props, props.message),
  useCenteredContentPadding: () => 16,
}));

vi.mock('@/components/orders/OrderStatusTimeline', () => ({
  OrderStatusTimeline: nativeComponent('OrderStatusTimeline'),
}));

vi.mock('@/components/buyer-nav/buyerTabBarMetrics', () => ({
  useTabBarMetrics: () => ({ occupiedHeight: 0 }),
}));

vi.mock('@/components/SwipeActionRow', () => ({
  default: nativeComponent('SwipeActionRow'),
}));

vi.mock('@/components/motion/SheetRise', () => ({
  SheetRise: nativeComponent('SheetRise'),
}));

vi.mock('@shopify/flash-list', () => ({
  FlashList: (props: any) => {
    const Header = props.ListHeaderComponent;
    const Empty = props.ListEmptyComponent;
    const data = props.data ?? [];
    return React.createElement(
      'FlashList',
      null,
      Header ? React.createElement(Header) : null,
      data.length === 0
        ? (Empty ? React.createElement(Empty) : null)
        : data.map((item: any, index: number) =>
            React.createElement(
              React.Fragment,
              { key: props.keyExtractor ? props.keyExtractor(item, index) : index },
              props.renderItem({ item, index }),
            ),
          ),
    );
  },
}));

vi.mock('@/services/orderService', () => ({
  filterOrders: (orders: unknown[]) => orders,
  sortOrders: (orders: unknown[]) => orders,
}));

vi.mock('@/lib/orderBadgeStore', () => ({
  clearBadge: vi.fn(),
}));

vi.mock('@/lib/money', () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#000', surface: '#111', text: '#fff', muted: '#888', subtle: '#666',
      error: '#f00', success: '#0f0', warning: '#fa0', accent: '#90f', accentLight: '#a9f',
      accentDim: '#502090', secondary: '#0ff', secondaryDim: '#044', border: '#333',
      card: '#181818', cardGlass: '#1818188', cardElevatedGlass: '#222', heroGradient: ['#111', '#222'],
      primaryGradient: ['#111', '#222'], onAccent: '#fff',
    },
  }),
  getOnAccentTextStyle: () => ({ color: '#000' }),
}));

vi.mock('@/lib/theme', () => ({
  FONT: { regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
  FS: { xs: 12, sm: 14, md: 16, base: 15, lg: 20, xl: 24, xxl: 32 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 40 },
  RADIUS: { sm: 8, md: 12, lg: 16, pill: 999 },
  COMP: { iconBtn: 36 },
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xl: 32 },
  ANIM: {},
  GRAD_DARK_FADE: ['rgba(10,10,11,0)', 'rgba(10,10,11,1)'],
}));

let mockOrdersList: () => Promise<any[]>;
vi.mock('@/hooks/useApi', () => ({
  useApi: () => ({
    orders: {
      list: () => mockOrdersList(),
      updateStatus: vi.fn(),
    },
  }),
}));

import OrdersScreen from '@/app/(tabs)/orders';

function textContent(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((node: any) => typeof node.type === 'string')
    .map(node => (Array.isArray(node.children) ? node.children.filter((c: any) => typeof c === 'string').join('') : ''))
    .join('\n');
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function apiOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'BT-1001',
    status: 'pending',
    totalCents: 4999,
    customerName: 'Buyer Name',
    customerEmail: 'buyer@example.com',
    itemCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('seller Orders screen states', () => {
  afterEach(() => {
    mockUserId = 'seller-1';
  });

  it('shows skeleton rows while the initial request is in flight', async () => {
    let resolveList!: (rows: any[]) => void;
    mockOrdersList = () => new Promise(resolve => { resolveList = resolve; });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<OrdersScreen />);
    });

    const skeletons = renderer.root.findAll((node: any) => node.type === 'SkeletonBlock');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(renderer.root.findAll((node: any) => node.type === 'EmptyState').length).toBe(0);

    // Resolve so the pending promise doesn't leak into the next test.
    await act(async () => { resolveList([]); await flush(); });
  });

  it('renders real order data once the request resolves', async () => {
    mockOrdersList = async () => [apiOrderRow({ orderNumber: 'BT-2002', customerName: 'Jordan Lee', totalCents: 12000 })];

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<OrdersScreen />);
    });
    await flush();

    const skeletons = renderer.root.findAll((node: any) => node.type === 'SkeletonBlock');
    expect(skeletons.length).toBe(0);

    const text = textContent(renderer);
    expect(text).toContain('BT-2002');
    expect(text).toContain('Jordan Lee');
    expect(text).toContain('$120.00');
  });

  it('shows the empty state for a seller with zero orders', async () => {
    mockOrdersList = async () => [];

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<OrdersScreen />);
    });
    await flush();

    const empty = renderer.root.findAll((node: any) => node.type === 'EmptyState');
    expect(empty.length).toBe(1);
    expect(empty[0].props.message).toContain('Your orders will show up here');
    expect(empty[0].props.variant).not.toBe('error');
  });

  it('shows a retry banner and error empty state when the request fails', async () => {
    mockOrdersList = async () => { throw new Error('network down'); };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<OrdersScreen />);
    });
    await flush();

    const text = textContent(renderer);
    expect(text).toMatch(/refresh orders/i);

    const empty = renderer.root.findAll((node: any) => node.type === 'EmptyState');
    expect(empty.length).toBe(1);
    expect(empty[0].props.variant).toBe('error');
  });
});
