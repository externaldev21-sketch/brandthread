/**
 * DiscoverPager — focused tests for the immersive full-screen product feed.
 *
 * Follows the mocking conventions in components/CommerceSignal.test.tsx:
 * react-test-renderer + hand-rolled `vi.mock('react-native', ...)`, plus the
 * additional mocks this component's dependencies (Reanimated, expo-blur,
 * expo-linear-gradient, expo-image, expo-router, cart service) need.
 *
 * Covers:
 * - Renders one product per page (FlatList data -> one DiscoverCard per item)
 * - Correct API call shape for fetching the discover feed
 * - Empty state renders when the feed is empty
 * - Error state renders with a working retry that re-fetches
 * - Cart badge count reflects getCart()'s summed quantity
 * - Add-to-cart success triggers the fly-to-cart helpers with sane inputs
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── react-native ─────────────────────────────────────────────────────────────

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => {
    function C(props: Record<string, unknown>, ref: unknown) {
      return React.createElement(name, { ...props, ref }, props.children as React.ReactNode);
    }
    return React.forwardRef(C);
  };

  // Real RN Pressable accepts a function-as-children render prop (passed a
  // press/hover/focus state); PressableScale (components/BrandthreadUI.tsx)
  // relies on that to animate its wrapper, so the mock must support it too.
  const Pressable = React.forwardRef((props: any, ref: unknown) => {
    const { children, ...rest } = props;
    const content = typeof children === 'function' ? children({ pressed: false }) : children;
    return React.createElement('Pressable', { ...rest, ref }, content);
  });

  function FlatList(props: any) {
    const { data, renderItem, keyExtractor, ListHeaderComponent, ListFooterComponent, ItemSeparatorComponent, ...rest } = props;
    const items = (data ?? []).map((item: any, index: number) =>
      React.createElement(React.Fragment, { key: keyExtractor ? keyExtractor(item) : index },
        index > 0 && ItemSeparatorComponent ? React.createElement(ItemSeparatorComponent) : null,
        renderItem({ item, index }),
      ),
    );
    return React.createElement('FlatList', rest,
      ListHeaderComponent ?? null, items, ListFooterComponent ?? null);
  }

  return {
    Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    StyleSheet: {
      create: (s: unknown) => s,
      hairlineWidth: 1,
      absoluteFill: {},
      absoluteFillObject: {},
    },
    View: el('View'),
    Text: el('Text'),
    Pressable,
    TouchableOpacity: el('TouchableOpacity'),
    TouchableWithoutFeedback: el('TouchableWithoutFeedback'),
    ActivityIndicator: el('ActivityIndicator'),
    Modal: el('Modal'),
    Linking: { openURL: vi.fn(async () => {}) },
    FlatList,
    Animated: {
      Value: class { constructor(public _value: number) {} setValue() {} interpolate() { return this; } },
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
      spring: () => ({ start: (cb?: () => void) => cb?.() }),
      stagger: () => ({ start: (cb?: () => void) => cb?.() }),
      sequence: () => ({ start: (cb?: () => void) => cb?.() }),
      View: el('AnimatedView'),
      Text: el('AnimatedText'),
      createAnimatedComponent: (c: unknown) => c,
    },
    Easing: { out: () => () => 0, cubic: () => 0, inOut: () => () => 0 },
  };
});

// ─── react-native-reanimated ──────────────────────────────────────────────────

vi.mock('react-native-reanimated', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);

  function FlatList(props: any) {
    const { data, renderItem, keyExtractor, ListHeaderComponent, ListFooterComponent, ItemSeparatorComponent, ...rest } = props;
    const items = (data ?? []).map((item: any, index: number) =>
      React.createElement(React.Fragment, { key: keyExtractor ? keyExtractor(item) : index },
        index > 0 && ItemSeparatorComponent ? React.createElement(ItemSeparatorComponent) : null,
        renderItem({ item, index }),
      ),
    );
    return React.createElement('AnimatedFlatList', rest,
      ListHeaderComponent ?? null, items, ListFooterComponent ?? null);
  }

  const AnimatedDefault = { View: el('AnimatedView'), FlatList };
  return {
    default: AnimatedDefault,
    FlatList,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    useAnimatedScrollHandler: (handlers: unknown) => handlers,
    withSpring: (v: unknown) => v,
    withTiming: (v: unknown) => v,
    withRepeat: (v: unknown) => v,
    withSequence: (...v: unknown[]) => v[0],
    interpolate: (value: number, input: number[], output: number[]) => output[1] ?? output[0],
    Extrapolation: { CLAMP: 'clamp' },
  };
});

// ─── Other native/expo modules ────────────────────────────────────────────────

vi.mock('expo-blur', () => ({ BlurView: () => null }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('react-native-svg', () => ({ default: () => null, Line: () => null }));
vi.mock('expo-image', () => ({ Image: { prefetch: vi.fn(async () => {}) } }));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => require('react').createElement('Feather', { name }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#F7F7FA', onAccent: '#0A0A0B', text: '#FFFFFF', muted: 'rgba(255,255,255,0.5)',
      card: '#18181B', cardElevated: '#222226', border: 'rgba(255,255,255,0.07)', accentDim: 'rgba(255,255,255,0.05)',
      error: '#F87171', background: '#0A0A0B', surface: '#111113',
    },
  }),
}));

const pushMock = vi.fn();
const backMock = vi.fn();
vi.mock('@/contexts/ThreadPullTransitionContext', () => ({
  useThreadPull: () => ({ push: pushMock, back: backMock, replace: vi.fn() }),
}));

vi.mock('@/components/CachedImage', () => ({
  CachedImage: (props: any) => require('react').createElement('CachedImage', props),
}));

vi.mock('@/components/layout', () => ({
  CardSkeleton: () => require('react').createElement('CardSkeleton'),
}));

vi.mock('@/components/BrandthreadUI', () => ({
  EmptyState: ({ title, description, action }: any) => {
    const React = require('react');
    return React.createElement('EmptyState', {}, [
      React.createElement('Text', { key: 'title' }, title),
      description ? React.createElement('Text', { key: 'desc' }, description) : null,
      action
        ? React.createElement('TouchableOpacity', { key: 'action', onPress: action.onPress, accessibilityLabel: action.label }, action.label)
        : null,
    ]);
  },
  PressableScale: (props: Record<string, unknown>) => {
    const React = require('react');
    return React.createElement('TouchableOpacity', props, props.children as React.ReactNode);
  },
}));

vi.mock('@/components/buy-now/BuyNowFlow', () => ({
  BuyNowFlow: () => require('react').createElement('BuyNowFlow'),
}));
vi.mock('@/components/buy-now/VariantPickerSheet', () => ({
  VariantPickerSheet: () => require('react').createElement('VariantPickerSheet'),
}));

// ─── Cart flight (real pure module — assert calls on it) ─────────────────────

vi.mock('@/lib/cartFlight', () => ({
  getCartFlightVector: vi.fn(() => ({ x: 0, y: 0 })),
  getSuccessfulCartCount: vi.fn((result: any) => (result.success ? result.cart.items.reduce((t: number, i: any) => t + i.quantity, 0) : null)),
  measureCartTarget: vi.fn(async (_measure: unknown, fallback: unknown) => fallback),
  shouldAnimateCartSuccess: vi.fn(() => true),
}));

// ─── Cart service ──────────────────────────────────────────────────────────────

const getCartMock = vi.fn();
const addToCartMock = vi.fn();
const getBuyerProductMock = vi.fn();
vi.mock('@/services/cartService', () => ({
  getCart: (...args: unknown[]) => getCartMock(...args),
  addToCart: (...args: unknown[]) => addToCartMock(...args),
  getBuyerProduct: (...args: unknown[]) => getBuyerProductMock(...args),
}));

// ─── API client ────────────────────────────────────────────────────────────────

const discoverFeedMock = vi.fn();
// A stable module-level instance — the real useApi() memoizes per user, and a
// fresh object on every call would re-trigger every effect keyed off `api`.
const apiInstance = { discover: { feed: (...args: unknown[]) => discoverFeedMock(...args) } };
vi.mock('@/lib/api', () => ({
  useApi: () => apiInstance,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { DiscoverPager } from '../DiscoverPager';
import {
  getCartFlightVector, getSuccessfulCartCount, measureCartTarget, shouldAnimateCartSuccess,
} from '@/lib/cartFlight';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    rank: 1,
    productId: 'prod_1',
    brandId: 'brand_1',
    brandName: 'Acme Co',
    brandVerified: true,
    productName: 'Classic Tee',
    priceCents: 4500,
    compareAtPriceCents: null,
    images: ['https://example.test/a.jpg'],
    category: 'apparel',
    sellerScore: 90,
    ...overrides,
  };
}

async function render(node: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(node, {
      // Refs on host components (e.g. measureInWindow for the fly-to-cart
      // measurement) otherwise resolve to null under react-test-renderer.
      createNodeMock: () => ({ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(100, 700, 40, 40) }),
    });
    await Promise.resolve();
    await Promise.resolve();
  });
  return r;
}

function textContent(renderer: ReactTestRenderer): string[] {
  try {
    return renderer.root.findAllByType('Text' as React.ElementType).map(n => String(n.props.children));
  } catch {
    return [];
  }
}

beforeEach(() => {
  discoverFeedMock.mockReset();
  getCartMock.mockReset().mockResolvedValue({ id: 'cart_1', items: [], savedItems: [], updatedAt: '' });
  addToCartMock.mockReset();
  getBuyerProductMock.mockReset();
  pushMock.mockClear();
  backMock.mockClear();
  (getCartFlightVector as any).mockClear();
  (getSuccessfulCartCount as any).mockClear();
  (measureCartTarget as any).mockClear();
  (shouldAnimateCartSuccess as any).mockClear();
});

describe('DiscoverPager — data fetching', () => {
  it('calls api.discover.feed with limit and offset 0 on mount', async () => {
    discoverFeedMock.mockResolvedValue({ items: [makeItem()], computedAt: '', source: 'computed', nextOffset: null });
    const r = await render(<DiscoverPager />);
    expect(discoverFeedMock).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    r.unmount();
  });

  it('renders one product per page', async () => {
    discoverFeedMock.mockResolvedValue({
      items: [makeItem({ productId: 'p1', productName: 'Product One' }), makeItem({ productId: 'p2', productName: 'Product Two' })],
      computedAt: '', source: 'computed', nextOffset: null,
    });
    const r = await render(<DiscoverPager />);
    const texts = textContent(r);
    expect(texts).toContain('Product One');
    expect(texts).toContain('Product Two');
    r.unmount();
  });
});

describe('DiscoverPager — empty state', () => {
  it('renders an empty state when the feed has no items', async () => {
    discoverFeedMock.mockResolvedValue({ items: [], computedAt: '', source: 'empty', nextOffset: null });
    const r = await render(<DiscoverPager />);
    const texts = textContent(r);
    expect(texts.some(t => t.toLowerCase().includes('no trending products'))).toBe(true);
    r.unmount();
  });
});

describe('DiscoverPager — error state and retry', () => {
  it('renders an error state with retry, and retry re-fetches', async () => {
    discoverFeedMock.mockRejectedValueOnce(new Error('network down'));
    discoverFeedMock.mockResolvedValueOnce({ items: [makeItem()], computedAt: '', source: 'computed', nextOffset: null });

    const r = await render(<DiscoverPager />);
    expect(discoverFeedMock).toHaveBeenCalledTimes(1);

    const retryBtn = r.root.findByProps({ accessibilityLabel: 'Retry' });
    await act(async () => {
      retryBtn.props.onPress();
      await Promise.resolve();
    });

    expect(discoverFeedMock).toHaveBeenCalledTimes(2);
    r.unmount();
  });
});

describe('DiscoverPager — cart badge', () => {
  it('reflects getCart()\'s summed item quantity', async () => {
    discoverFeedMock.mockResolvedValue({ items: [makeItem()], computedAt: '', source: 'computed', nextOffset: null });
    getCartMock.mockResolvedValue({
      id: 'cart_1',
      items: [{ quantity: 2 }, { quantity: 3 }],
      savedItems: [],
      updatedAt: '',
    });

    const r = await render(<DiscoverPager />);
    const cartBtn = r.root.findByProps({ accessibilityLabel: 'Open cart, 5 items' });
    expect(cartBtn).toBeTruthy();
    r.unmount();
  });
});

describe('DiscoverPager — add to cart', () => {
  it('adds a single-variant product directly and triggers the cart-flight helpers with sane inputs', async () => {
    const item = makeItem();
    discoverFeedMock.mockResolvedValue({ items: [item], computedAt: '', source: 'computed', nextOffset: null });
    getBuyerProductMock.mockResolvedValue({
      id: 'prod_1', options: [], variants: [{ id: 'v1', priceCents: 4500, inventoryQuantity: 10, isAvailable: true, optionValues: [] }],
      imageUris: ['https://example.test/a.jpg'], name: 'Classic Tee', sellerId: 'brand_1', sellerName: 'Acme Co', sellerHandle: 'acme',
      isActive: true, isPreOrder: false, description: '', category: 'apparel', priceCents: 4500, tags: [],
    });
    addToCartMock.mockResolvedValue({ success: true, cart: { items: [{ quantity: 1 }] } });

    const r = await render(<DiscoverPager />);
    const addBtn = r.root.findByProps({ accessibilityLabel: 'Add to cart' });
    await act(async () => {
      addBtn.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addToCartMock).toHaveBeenCalledTimes(1);
    const call = addToCartMock.mock.calls[0][0];
    expect(call.variant.id).toBe('v1');
    expect(call.quantity).toBe(1);
    expect(call.attribution).toEqual({ channel: 'discover' });

    expect(measureCartTarget).toHaveBeenCalled();
    expect(getSuccessfulCartCount).toHaveBeenCalledWith({ success: true, cart: { items: [{ quantity: 1 }] } });
    r.unmount();
  });
});
