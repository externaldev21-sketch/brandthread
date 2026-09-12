import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

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
  StyleSheet: { create: (styles: unknown) => styles },
  Text: nativeComponent('Text'),
  TextInput: nativeComponent('TextInput'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  View: nativeComponent('View'),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: nativeComponent('LinearGradient'),
}));

vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: 'seller-1' }),
}));

vi.mock('@/components/AIBrainFAB', () => ({
  default: () => null,
}));

vi.mock('@/components/BrandthreadUI', () => {
  const components = [
    'BrandthreadCard',
    'GradientCard',
    'PrimaryButton',
    'SecondaryButton',
    'IconButton',
    'FilterChip',
    'StatusBadge',
    'SectionHeader',
    'EmptyState',
    'StatCard',
    'SearchBar',
    'BrandedLoader',
  ];
  return Object.fromEntries(components.map(name => [name, nativeComponent(name)]));
});

vi.mock('@/components/SwipeActionRow', () => ({
  default: nativeComponent('SwipeActionRow'),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#c7cdd5',
      accentDim: '#34383e',
      accentLight: '#f8fafc',
      secondary: '#22d3ee',
      secondaryDim: '#164e63',
    },
  }),
  getOnAccentTextStyle: () => ({ color: '#000' }),
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => ({ orders: { list: vi.fn(), updateStatus: vi.fn() } }),
}));

vi.mock('@/lib/orderBadgeStore', () => ({
  clearBadge: vi.fn(),
}));

vi.mock('@/lib/money', () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

vi.mock('@/lib/theme', () => ({
  BG: '#09090b',
  SCREEN_BG: 'transparent',
  SURFACE: '#18181b',
  CARD: '#18181b',
  CARD_GLASS: 'rgba(18, 18, 31, 0.45)',
  CARD_ELEVATED_GLASS: 'rgba(24, 24, 46, 0.65)',
  SURFACE_GLASS: 'rgba(12, 12, 23, 0.65)',
  SKELETON_GLASS: 'rgba(255,255,255,0.05)',
  CARD_ELEVATED: '#27272a',
  BORDER: '#3f3f46',
  BORDER_ACTIVE: '#71717a',
  FG: '#fafafa',
  MUTED: '#a1a1aa',
  SUBTLE: '#71717a',
  SUCCESS: '#22c55e',
  SUCCESS_DIM: '#14532d',
  BLUE: '#60a5fa',
  BLUE_DIM: '#1e3a8a',
  ORANGE: '#f59e0b',
  ORANGE_DIM: '#78350f',
  RED: '#ef4444',
  RED_DIM: '#7f1d1d',
  GOLD: '#facc15',
  GRAD_CARD_GLOW: [],
  GRAD_DARK_FADE: [],
  FONT: { regular: 'System', semibold: 'System', bold: 'System' },
  FS: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 32 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  RADIUS: { sm: 8, md: 12, lg: 16, pill: 999 },
  COMP: {},
  ICON: { sm: 16, md: 20, lg: 24, xl: 32, xxl: 40 },
  ANIM: {},
  PURPLE: '#c7cdd5',
  PURPLE_LIGHT: '#f8fafc',
  PURPLE_DIM: '#34383e',
  CYAN: '#22d3ee',
  CYAN_DIM: '#164e63',
}));

vi.mock('@/services/orderService', () => ({
  filterOrders: (orders: unknown[]) => orders,
  sortOrders: (orders: unknown[]) => orders,
}));

import { apiRowToOrder, OrderCard } from '@/app/(tabs)/orders';

const sellerRowProps = {
  selected: false,
  selectionMode: false,
  onPress: vi.fn(),
  onLongPress: vi.fn(),
  onMarkProcessing: vi.fn(),
  onMarkReady: vi.fn(),
  onShip: vi.fn(),
};

function textContent(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((node: any) => node.type === 'Text')
    .map(node => node.children.map(String).join(''))
    .join('\n');
}

function apiOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-cancelled',
    orderNumber: 'BT-1001',
    status: 'cancelled',
    totalCents: 4999,
    customerName: 'Buyer Name',
    customerEmail: 'buyer@example.com',
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T11:00:00.000Z',
    ...overrides,
  };
}

describe('seller cancelled order rows', () => {
  it('keeps the API cancellation reason and shows its human-readable label', () => {
    const listResponse = [
      apiOrder({ cancellationReason: 'customer_request' }),
      apiOrder({ id: 'order-cancelled-without-reason', orderNumber: 'BT-1002' }),
    ];
    const orders = listResponse.map(apiRowToOrder);

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <>
          {orders.map(order => (
            <OrderCard key={order.id} order={order} {...sellerRowProps} />
          ))}
        </>,
      );
    });

    expect(orders[0].cancellation?.reason).toBe('customer_request');
    expect(textContent(renderer)).toContain('Cancelled · Customer request');
    expect(textContent(renderer)).not.toContain('Cancelled · undefined');
    expect(textContent(renderer)).not.toContain('Cancelled · null');
    expect(textContent(renderer)).not.toContain('Cancelled · No reason provided');
  });
});