/**
 * Full-screen behavioral test for the seller Inventory screen: loading,
 * success, empty (new seller) and error states, driven by mocking
 * services/inventoryService directly and mounting the real screen.
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
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  ScrollView: nativeComponent('ScrollView'),
  FlatList: (props: any) => {
    const Empty = props.ListEmptyComponent;
    const data = props.data ?? [];
    return React.createElement(
      'FlatList',
      null,
      data.length === 0
        ? Empty ?? null
        : data.map((item: any, index: number) =>
            React.createElement(
              React.Fragment,
              { key: props.keyExtractor ? props.keyExtractor(item, index) : index },
              props.renderItem({ item, index }),
            ),
          ),
    );
  },
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  TextInput: nativeComponent('TextInput'),
  StyleSheet: { create: (styles: unknown) => styles },
  RefreshControl: nativeComponent('RefreshControl'),
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  Alert: { alert: vi.fn() },
  Share: { share: vi.fn() },
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    React.useEffect(() => cb(), []); // eslint-disable-line react-hooks/exhaustive-deps
  },
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: 'seller-1' }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: nativeComponent('LinearGradient'),
}));

vi.mock('@/lib/theme', () => {
  const color = (name: string) => name;
  return {
    BG: '#000', SURFACE: '#111', CARD: '#181818', CARD_ELEVATED: '#222',
    BORDER: '#333', BORDER_ACTIVE: '#444', FG: '#fff', MUTED: '#888', SUBTLE: '#666',
    PURPLE: '#90f', PURPLE_LIGHT: '#a9f', PURPLE_DIM: '#502090',
    CYAN: '#0ff', CYAN_DIM: '#044', SUCCESS: '#0f0', SUCCESS_DIM: '#040',
    BLUE: '#09f', BLUE_DIM: '#036', ORANGE: '#fa0', ORANGE_DIM: '#630',
    RED: '#f00', RED_DIM: '#600', GOLD: '#fd0',
    GRAD_PRIMARY: ['#111', '#222'], GRAD_CARD_GLOW: ['#111', '#222'],
    FONT: { regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
    FS: { xs: 12, sm: 14, md: 16, base: 15, lg: 20, xl: 24, xxl: 32 },
    SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 40 },
    RADIUS: { sm: 8, md: 12, lg: 16, pill: 999 },
    ICON: { xs: 12, sm: 16, md: 20, lg: 24, xl: 32 },
  };
});

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ foreground: '#fff', mutedForeground: '#888' }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: { primaryGradient: ['#111', '#222'], onAccent: '#fff' },
  }),
  getOnAccentTextStyle: () => ({ color: '#000' }),
}));

vi.mock('@/components/BrandthreadUI', () => ({
  BrandthreadCard: nativeComponent('BrandthreadCard'),
  GradientCard: nativeComponent('GradientCard'),
  PrimaryButton: nativeComponent('PrimaryButton'),
  SecondaryButton: nativeComponent('SecondaryButton'),
  IconButton: nativeComponent('IconButton'),
  FilterChip: nativeComponent('FilterChip'),
  StatusBadge: nativeComponent('StatusBadge'),
  SectionHeader: nativeComponent('SectionHeader'),
  EmptyState: (props: { title: string; description: string; action?: { label: string } }) =>
    React.createElement('EmptyState', props, `${props.title} :: ${props.description}`),
  StatCard: nativeComponent('StatCard'),
  SearchBar: nativeComponent('SearchBar'),
}));

let mockOverview: () => Promise<any>;
let mockItems: () => Promise<any[]>;
let mockAlerts: () => Promise<any[]>;

vi.mock('@/services/inventoryService', () => ({
  getInventoryOverview: () => mockOverview(),
  getInventoryItems: () => mockItems(),
  searchInventory: async () => [],
  filterInventory: (items: any[]) => items,
  getAlerts: () => mockAlerts(),
  getTransfers: async () => [],
  getIncoming: async () => [],
  getCounts: async () => [],
  getEvents: async () => [],
  getValuation: async () => null,
  dismissAlert: vi.fn(),
  exportInventoryCsv: async () => '',
}));

import InventoryScreen from '@/app/inventory';

function emptyOverview() {
  return {
    totalOnHand: 0, totalAvailable: 0, totalReserved: 0, totalIncoming: 0,
    totalCommitted: 0, totalDamaged: 0, lowStockCount: 0, outOfStockCount: 0,
    inventoryValueCents: 0, locationCount: 0, unitsInProduction: 0, recentAdjustmentCount: 0,
  };
}

function inventoryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1', productId: 'prod-1', productName: 'Test Hoodie', variantLabel: 'M / Black',
    sku: 'SKU-1', onHand: 40, available: 35, reserved: 5, incoming: 0, committed: 0, damaged: 0,
    unavailable: 0, oversellPolicy: 'block', status: 'available', lowStockThreshold: 10,
    inventoryValueCents: 168000,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('seller Inventory screen states', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading spinner while the initial request is in flight', async () => {
    let resolveOverview!: (v: any) => void;
    mockOverview = () => new Promise(resolve => { resolveOverview = resolve; });
    mockItems = async () => [];
    mockAlerts = async () => [];

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<InventoryScreen />);
    });

    expect(renderer.root.findAll((node: any) => node.type === 'ActivityIndicator').length).toBeGreaterThan(0);
    expect(renderer.root.findAll((node: any) => node.type === 'EmptyState').length).toBe(0);

    await act(async () => { resolveOverview(emptyOverview()); await flush(); });
  });

  it('renders real product data once the request resolves', async () => {
    mockOverview = async () => ({
      ...emptyOverview(),
      totalOnHand: 40, totalAvailable: 35, lowStockCount: 0, outOfStockCount: 0,
      inventoryValueCents: 168000,
    });
    mockItems = async () => [inventoryItem()];
    mockAlerts = async () => [];

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<InventoryScreen />);
    });
    await flush();

    expect(renderer.root.findAll((node: any) => node.type === 'ActivityIndicator').length).toBe(0);

    const text = renderer.root
      .findAll((node: any) => node.type === 'Text')
      .map((node: any) => (Array.isArray(node.children) ? node.children.join('') : ''))
      .join('\n');
    expect(text).toContain('40'); // On-hand stat
    expect(text).toContain('Inventory');
  });

  it('shows an "Add product" empty state for a new seller with zero products', async () => {
    mockOverview = async () => emptyOverview();
    mockItems = async () => [];
    mockAlerts = async () => [];

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<InventoryScreen />);
    });
    await flush();

    const empties = renderer.root.findAll((node: any) => node.type === 'EmptyState');
    expect(empties.length).toBeGreaterThan(0);
    expect(empties[0].props.title).toMatch(/no products yet/i);
    expect(empties[0].props.action?.label).toBe('Add product');
  });

  it('shows a Retry error state when the initial request fails outright', async () => {
    mockOverview = async () => { throw new Error('network down'); };
    mockItems = async () => { throw new Error('network down'); };
    mockAlerts = async () => { throw new Error('network down'); };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<InventoryScreen />);
    });
    await flush();

    const empties = renderer.root.findAll((node: any) => node.type === 'EmptyState');
    expect(empties.length).toBe(1);
    expect(empties[0].props.title).toMatch(/couldn.t load inventory/i);
    expect(empties[0].props.action?.label).toBe('Retry');
  });
});
