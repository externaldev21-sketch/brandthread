import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product, ProductFilter } from '@/services/productTypes';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  getProductsMock, getProductStatsMock, archiveProductMock, unarchiveProductMock,
  deleteProductMock, restoreProductMock, duplicateProductMock,
  routerMock, showUndoMock, alertMock,
} = vi.hoisted(() => ({
  getProductsMock: vi.fn(),
  getProductStatsMock: vi.fn(),
  archiveProductMock: vi.fn(),
  unarchiveProductMock: vi.fn(),
  deleteProductMock: vi.fn(),
  restoreProductMock: vi.fn(),
  duplicateProductMock: vi.fn(),
  routerMock: { push: vi.fn() },
  showUndoMock: vi.fn(),
  alertMock: vi.fn(),
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
    View: nativeComponent('View'),
    Text: nativeComponent('Text'),
    ScrollView: nativeComponent('ScrollView'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    Pressable: nativeComponent('Pressable'),
    // Real RN Modal mounts its children regardless of `visible`; the mock
    // mirrors that so ActionSheet/FilterModal/SortModal content is always
    // reachable in the tree, same as on device.
    Modal: nativeComponent('Modal'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    Alert: { alert: alertMock },
    Share: { share: vi.fn() },
    LayoutAnimation: {
      configureNext: vi.fn(),
      Presets: { easeInEaseOut: {} },
    },
    UIManager: { setLayoutAnimationEnabledExperimental: vi.fn() },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
    Animated: {
      Value: class {
        constructor(public _value: number) {}
        setValue() {}
      },
      View: nativeComponent('Animated.View'),
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
      spring: () => ({ start: (cb?: () => void) => cb?.() }),
    },
  };
});

vi.mock('@shopify/flash-list', () => {
  const React = require('react') as typeof import('react');
  return {
    FlashList: ({
      data, renderItem, ListHeaderComponent, ListEmptyComponent,
    }: {
      data?: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
    }) => React.createElement(
      'FlashList',
      null,
      ListHeaderComponent ?? null,
      ...(data && data.length > 0
        ? data.map((item, index) => renderItem({ item, index }))
        : [ListEmptyComponent ?? null]),
    ),
  };
});

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name, color }: { name: string; color?: string }) =>
    React.createElement('Feather', { name, color }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Warning: 'warning' },
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

const THEME = {
  background: '#07070F', surface: '#0B0B14', card: '#12121F', cardElevated: '#18182E',
  border: '#303044', borderSubtle: '#22222E', text: '#F4F4FF', muted: '#AAAABC', subtle: '#77778A',
  accent: '#C7CDD5', accentDim: '#34383E', accentLight: '#F8FAFC', onAccent: '#0A0A0B',
  secondary: '#22D3EE', secondaryDim: '#164E63', success: '#10B981', warning: '#F97316', error: '#F87171',
};

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: THEME }),
}));

vi.mock('@/lib/money', () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  integerPercent: (num: number, denom: number) => Math.round((num / denom) * 100),
}));

vi.mock('@/lib/theme', () => ({
  BG: '#0A0A0B',
  CARD: '#18181B',
  CARD_GLASS: 'rgba(24, 24, 27, 0.58)',
  FG: '#F7F7FA',
  ACCENT: '#F7F7FA',
  MUTED: 'rgba(247,247,250,0.58)',
  SUBTLE: 'rgba(247,247,250,0.50)',
  BORDER: 'rgba(255,255,255,0.07)',
  RED: '#F87171',
  SUCCESS: '#10B981',
  ORANGE: '#F97316',
  GOLD: '#F59E0B',
  FONT: { regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, xl: 22, pill: 999 },
  COMP: { tabBarH: 64, iconBtn: 40, minTouchTarget: 44 },
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xl: 28, xxl: 40 },
}));

vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  const native = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return {
    PrimaryButton: (props: Record<string, unknown>) =>
      React.createElement('TouchableOpacity', { ...props, accessibilityLabel: props.label }, props.label as React.ReactNode),
    SearchBar: native('SearchBar'),
    FilterChip: ({ label, active, onPress, count }: { label: string; active: boolean; onPress: () => void; count?: number }) =>
      React.createElement(
        'TouchableOpacity',
        { onPress, accessibilityLabel: count !== undefined ? `${label}, ${count}` : label, accessibilityState: { selected: active } },
        React.createElement('Text', null, label),
      ),
    PressableScale: (props: Record<string, unknown>) =>
      React.createElement('TouchableOpacity', props, props.children as React.ReactNode),
    useUndoToast: () => ({ showUndo: showUndoMock }),
  };
});

vi.mock('@/components/layout', () => {
  const React = require('react') as typeof import('react');
  return {
    EmptyState: ({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) =>
      React.createElement(
        'View',
        null,
        React.createElement('Text', null, message),
        actionLabel ? React.createElement('TouchableOpacity', { onPress: onAction, accessibilityLabel: actionLabel }, actionLabel) : null,
      ),
    GridSkeleton: () => React.createElement('View', { testID: 'grid-skeleton' }),
    useGridColumns: () => 2,
    useBreakpoint: () => ({ width: 393, height: 852, isTablet: false, isLandscape: false }),
    useCenteredGridPadding: () => 16,
  };
});

vi.mock('@/components/buyer-nav/buyerTabBarMetrics', () => ({
  useTabBarMetrics: () => ({ occupiedHeight: 90 }),
}));

vi.mock('@/components/motion/SheetRise', () => {
  const React = require('react') as typeof import('react');
  return {
    SheetRise: (props: Record<string, unknown>) =>
      React.createElement('View', props, props.children as React.ReactNode),
  };
});

vi.mock('@/components/products/ProductCard', () => {
  const React = require('react') as typeof import('react');
  return {
    ProductCard: ({ product, onPress, onMore }: {
      product: Product;
      onPress: (p: Product) => void;
      onMore: (p: Product) => void;
    }) =>
      React.createElement(
        'View',
        { testID: `card-${product.id}` },
        React.createElement('Text', null, product.name),
        React.createElement('TouchableOpacity', { accessibilityLabel: `open-${product.id}`, onPress: () => onPress(product) }),
        React.createElement('TouchableOpacity', { accessibilityLabel: `more-${product.id}`, onPress: () => onMore(product) }),
      ),
  };
});

vi.mock('@/services/productService', () => ({
  getProducts: getProductsMock,
  getProductStats: getProductStatsMock,
  archiveProduct: archiveProductMock,
  unarchiveProduct: unarchiveProductMock,
  deleteProduct: deleteProductMock,
  restoreProduct: restoreProductMock,
  duplicateProduct: duplicateProductMock,
}));

import ProductsScreen from '@/app/(tabs)/products';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Rack Tee',
    status: 'active',
    category: 'T-shirt',
    media: [],
    variants: [],
    inventory: { totalStock: 20, lowStockThreshold: 5 },
    pricing: { priceCents: 4500, compareAtPriceCents: null },
    totalSales: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Product;
}

const activeProduct = makeProduct({ id: 'p-active', name: 'Active Hoodie', status: 'active' });
const draftProduct = makeProduct({ id: 'p-draft', name: 'Draft Jacket', status: 'draft' });

const DEFAULT_STATS = {
  active: 1, draft: 1, archived: 0, lowStock: 0, outOfStock: 0, preOrder: 0, totalInventoryValueCents: 0,
};

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

async function flushPromises() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(ProductsScreen));
    await flushPromises();
  });
  return renderer;
}

function findByLabel(renderer: ReactTestRenderer, label: string) {
  const matches = renderer.root.findAll(
    node => (node.props as Record<string, unknown>)?.accessibilityLabel === label,
  );
  if (matches.length === 0) throw new Error(`No node found with accessibilityLabel "${label}"`);
  return matches[0];
}

describe('seller products tab — "The Rack"', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    getProductsMock.mockReset();
    getProductStatsMock.mockReset().mockResolvedValue(DEFAULT_STATS);
    archiveProductMock.mockReset().mockResolvedValue(undefined);
    unarchiveProductMock.mockReset().mockResolvedValue(undefined);
    deleteProductMock.mockReset().mockResolvedValue(undefined);
    restoreProductMock.mockReset().mockResolvedValue(undefined);
    duplicateProductMock.mockReset().mockResolvedValue(undefined);
    routerMock.push.mockReset();
    showUndoMock.mockReset();
    alertMock.mockReset();
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => { renderer?.unmount(); });
      renderer = undefined;
    }
  });

  it('switching a status pill re-queries and re-renders only the matching products', async () => {
    getProductsMock.mockImplementation(async ({ filter }: { filter: ProductFilter }) => {
      if (filter === 'active') return [activeProduct];
      if (filter === 'draft') return [draftProduct];
      return [activeProduct, draftProduct];
    });

    renderer = await renderScreen();

    // Starts on "All" — both products render.
    expect(renderer.root.findAll(n => (n.type as unknown) === 'View' && (n.props as { testID?: string }).testID === 'card-p-active')).toHaveLength(1);
    expect(renderer.root.findAll(n => (n.type as unknown) === 'View' && (n.props as { testID?: string }).testID === 'card-p-draft')).toHaveLength(1);

    // Switch to the "Draft" pill.
    const draftPill = findByLabel(renderer, 'Draft, 1');
    await act(async () => {
      (draftPill.props as { onPress: () => void }).onPress();
      await flushPromises();
    });

    expect(getProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'draft' }));
    expect(renderer.root.findAll(n => (n.type as unknown) === 'View' && (n.props as { testID?: string }).testID === 'card-p-draft')).toHaveLength(1);
    expect(renderer.root.findAll(n => (n.type as unknown) === 'View' && (n.props as { testID?: string }).testID === 'card-p-active')).toHaveLength(0);

    // Switch to "Active" and confirm it flips back correctly.
    const activePill = findByLabel(renderer, 'Active, 1');
    await act(async () => {
      (activePill.props as { onPress: () => void }).onPress();
      await flushPromises();
    });
    expect(getProductsMock).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'active' }));
    expect(renderer.root.findAll(n => (n.type as unknown) === 'View' && (n.props as { testID?: string }).testID === 'card-p-active')).toHaveLength(1);
    expect(renderer.root.findAll(n => (n.type as unknown) === 'View' && (n.props as { testID?: string }).testID === 'card-p-draft')).toHaveLength(0);
  });

  it('deletes with an optimistic remove + undo, and restores the product on undo', async () => {
    getProductsMock.mockResolvedValue([activeProduct, draftProduct]);
    // Simulate the confirm Alert: immediately invoke the destructive "Delete" button.
    alertMock.mockImplementation((_title: string, _msg: string, buttons?: { text: string; onPress?: () => void }[]) => {
      buttons?.find(b => b.text === 'Delete')?.onPress?.();
    });

    renderer = await renderScreen();

    // Open the action sheet for the active product via its "more" affordance.
    const moreBtn = findByLabel(renderer, 'more-p-active');
    await act(async () => {
      (moreBtn.props as { onPress: () => void }).onPress();
      await flushPromises();
    });

    // Tap "Delete" inside the action sheet.
    const deleteAction = findByLabel(renderer, 'Delete, Active Hoodie');
    await act(async () => {
      (deleteAction.props as { onPress: () => void }).onPress();
      await flushPromises();
    });

    // Confirmed via the mocked Alert → optimistic remove, real delete call, undo offered.
    expect(deleteProductMock).toHaveBeenCalledWith('p-active');
    expect(renderer.root.findAll(n => (n.type as unknown) === 'View' && (n.props as { testID?: string }).testID === 'card-p-active')).toHaveLength(0);
    expect(showUndoMock).toHaveBeenCalledTimes(1);
    expect(showUndoMock.mock.calls[0][0].message).toContain('Active Hoodie');

    // Firing the undo callback restores the product and reloads the list.
    const undoArg = showUndoMock.mock.calls[0][0] as { undo: () => Promise<void> };
    getProductsMock.mockResolvedValue([activeProduct, draftProduct]);
    await act(async () => {
      await undoArg.undo();
      await flushPromises();
    });
    expect(restoreProductMock).toHaveBeenCalledWith('p-active');
    expect(getProductsMock.mock.calls.length).toBeGreaterThan(1);
  });
});
