import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  addToCartMock,
  alertMock,
  apiMock,
  createBuyNowSessionMock,
  getCartMock,
  invalidatePaymentCacheMock,
  routerMock,
  useLocalSearchParamsMock,
} = vi.hoisted(() => ({
  addToCartMock: vi.fn(),
  alertMock: vi.fn(),
  apiMock: {
    publicProducts: {
      get: vi.fn(),
      related: vi.fn(),
      taggedVideos: vi.fn(),
    },
    buyer: {
      sellerPaymentStatus: vi.fn(),
    },
    reviews: {
      forProduct: vi.fn(),
    },
  },
  createBuyNowSessionMock: vi.fn(),
  getCartMock: vi.fn(),
  invalidatePaymentCacheMock: vi.fn(),
  routerMock: {
    back: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  },
  useLocalSearchParamsMock: vi.fn(),
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

  class MockAnimatedValue {
    interpolate() {
      return this;
    }

    setValue() {}
  }

  // Real RN Pressable accepts a function-as-children render prop (passed a
  // press/hover/focus state); PressableScale (components/BrandthreadUI.tsx,
  // used by Snackbar/ListRow) relies on that to animate its wrapper.
  function MockPressable(props: Record<string, unknown>) {
    const { children, ...rest } = props;
    const content = typeof children === 'function'
      ? (children as (state: { pressed: boolean }) => React.ReactNode)({ pressed: false })
      : (children as React.ReactNode);
    return React.createElement('Pressable', rest, content);
  }

  return {
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Alert: { alert: alertMock },
    Animated: {
      FlatList: nativeComponent('AnimatedFlatList'),
      Image: nativeComponent('AnimatedImage'),
      Value: MockAnimatedValue,
      event: vi.fn(),
      View: nativeComponent('AnimatedView'),
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
      sequence: () => ({ start: (cb?: () => void) => cb?.() }),
      loop: () => ({ start: () => {}, stop: () => {} }),
    },
    Dimensions: {
      get: () => ({ width: 390, height: 844 }),
    },
    Image: nativeComponent('Image'),
    Modal: nativeComponent('Modal'),
    PanResponder: {
      create: () => ({ panHandlers: {} }),
    },
    Pressable: MockPressable,
    RefreshControl: nativeComponent('RefreshControl'),
    ScrollView: nativeComponent('ScrollView'),
    StyleSheet: {
      absoluteFill: {},
      create: (styles: unknown) => styles,
      hairlineWidth: 1,
    },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isSignedIn: true }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name, color }: { name: string; color?: string }) =>
    React.createElement('Feather', { name, color }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('LinearGradient', props, children),
}));

vi.mock('expo-image', () => ({
  Image: Object.assign(
    (props: Record<string, unknown>) => React.createElement('Image', props),
    { prefetch: vi.fn(async () => {}) },
  ),
}));

vi.mock('react-native-svg', () => ({
  default: (props: Record<string, unknown>) => React.createElement('Svg', props, props.children as React.ReactNode),
  Line: (props: Record<string, unknown>) => React.createElement('SvgLine', props),
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: useLocalSearchParamsMock,
  usePathname: () => '/buyer-product-detail',
  useRouter: () => routerMock,
}));

vi.mock('react-native-reanimated', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  const sharedValue = (initial: unknown) => {
    const shared = { value: initial, set(next: unknown) { shared.value = next; } };
    return shared;
  };

  return {
    default: { View: el('AnimatedView') },
    useSharedValue: sharedValue,
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withSpring: (v: unknown) => v,
    withTiming: (v: unknown) => v,
    Easing: { out: (v: unknown) => v, cubic: () => {}, bezier: (..._points: number[]) => (t: number) => t },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#C7CDD5',
      accentDim: '#34383E',
      accentLight: '#F8FAFC',
      onAccent: '#0A0A0B',
      primaryGradient: ['#727A84', '#F8FAFC'],
      secondary: '#22D3EE',
      secondaryDim: '#164E63',
      warning: '#F97316',
      error: '#F87171',
      shadowColor: '#C7CDD5',
    },
  }),
  getOnAccentTextStyle: () => ({}),
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => apiMock,
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    accent: '#727A84',
    primary: '#C7CDD5',
  }),
}));

vi.mock('@/lib/api', () => ({
  invalidateSellerPaymentStatusCache: invalidatePaymentCacheMock,
}));

vi.mock('@/lib/money', () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

vi.mock('@/lib/theme', () => ({
  BG: '#07070F',
  SCREEN_BG: 'transparent',
  SURFACE: '#111113',
  CARD: '#12121F',
  CARD_ELEVATED: '#18182E',
  SURFACE_GLASS: 'rgba(17, 17, 19, 0.72)',
  CARD_GLASS: 'rgba(24, 24, 27, 0.58)',
  CARD_ELEVATED_GLASS: 'rgba(34, 34, 38, 0.72)',
  SKELETON_GLASS: 'rgba(255,255,255,0.05)',
  BORDER: '#303044',
  BORDER_ACTIVE: '#F7F7FA',
  BORDER_FOCUS: '#F7F7FA',
  FG: '#F4F4FF',
  MUTED: '#AAAABC',
  GREEN_BRIGHT: '#39FF88',
  BLUE: '#3B82F6',
  BLUE_DIM: '#1E3A5F',
  SHADOW: { shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 },
  SHADOW_SM: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4 },
  ANIM: { fast: 150, normal: 250, slow: 400, spring: { tension: 60, friction: 10 } },
  SUBTLE: '#77778A',
  ON_DARK: '#FFFFFF',
  SUCCESS: '#10B981',
  SUCCESS_DIM: '#103D31',
  ORANGE: '#F97316',
  ORANGE_DIM: '#3F2A00',
  RED: '#F87171',
  RED_DIM: '#3F2020',
  GOLD: '#F59E0B',
  GRAD_SUCCESS_G: ['#10B981', '#34D399'],
  FONT: {
    regular: 'System',
    medium: 'System',
    semibold: 'System',
    bold: 'System',
  },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, pill: 999 },
  COMP: { buttonH: 52 },
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xl: 28, xxl: 40 },
  GUTTER: 16,
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

vi.mock('@/services/cartService', () => ({
  addToCart: addToCartMock,
  createBuyNowSession: createBuyNowSessionMock,
  getCart: getCartMock,
  replaceCartItemVariant: vi.fn(),
}));

// The screen fires a fire-and-forget ViewContent pixel/CAPI event on mount;
// stub it out (real expo-crypto isn't loadable in this test environment).
vi.mock('@/lib/marketingPixels', () => ({
  trackAndRelayConversionEvent: vi.fn(() => false),
}));

import BuyerProductDetailScreen from '@/app/buyer-product-detail';

const product = {
  id: 'product-1',
  ownerId: 'seller-1',
  sellerDisplayName: 'Demo Seller',
  name: 'Everyday Tee',
  description: 'A soft cotton tee.',
  images: [],
  variants: [
    {
      id: 'variant-1',
      size: 'M',
      priceCents: 4200,
      stock: 5,
    },
  ],
};

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

function findTouchableByText(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  // The design-system migration moved some of these onto Chip/Button, which
  // render a Pressable instead of a raw TouchableOpacity — same tap behavior,
  // different host element type.
  const touchables = renderer.root.findAll(
    (node: any) =>
      (node.type === 'TouchableOpacity' || node.type === 'Pressable') &&
      typeof node.props.onPress === 'function' &&
      textContent(node.props.children).includes(text),
  );
  // Prefer an exact label match (a size chip "M") over any control whose
  // label merely contains the text (e.g. "Message seller").
  const match = touchables.find((node) => textContent(node.props.children).trim() === text) ?? touchables[0];
  if (!match) throw new Error(`Could not find TouchableOpacity/Pressable containing "${text}"`);
  return match;
}

async function flushPromises() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<BuyerProductDetailScreen />);
    await flushPromises();
  });
  return renderer;
}

describe('buyer product detail when seller payments are unavailable', () => {
  let renderer!: ReactTestRenderer;

  beforeEach(() => {
    addToCartMock.mockReset();
    addToCartMock.mockResolvedValue({
      success: true,
      cart: { id: 'cart-1', items: [], savedItems: [], updatedAt: '2026-08-31T00:00:00.000Z' },
    });
    alertMock.mockReset();
    createBuyNowSessionMock.mockReset();
    getCartMock.mockReset();
    apiMock.publicProducts.get.mockReset();
    apiMock.publicProducts.get.mockResolvedValue(product);
    apiMock.publicProducts.related.mockReset();
    apiMock.publicProducts.related.mockResolvedValue([]);
    apiMock.publicProducts.taggedVideos.mockReset();
    apiMock.publicProducts.taggedVideos.mockResolvedValue([]);
    apiMock.buyer.sellerPaymentStatus.mockReset();
    apiMock.buyer.sellerPaymentStatus.mockResolvedValue({
      ready: false,
      reason: 'Seller has not finished setting up payments.',
    });
    apiMock.reviews.forProduct.mockReset();
    apiMock.reviews.forProduct.mockResolvedValue({ reviews: [], avgRating: 0, totalCount: 0 });
    invalidatePaymentCacheMock.mockReset();
    routerMock.back.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    useLocalSearchParamsMock.mockReturnValue({ productId: 'product-1' });
  });

  afterEach(async () => {
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('warns about payments, disables Buy Now, and still lets the buyer add the item to cart', async () => {
    renderer = await renderScreen();

    await act(async () => {
      findTouchableByText(renderer, 'M').props.onPress();
      await flushPromises();
    });

    const warning = renderer.root.findByProps({ accessibilityRole: 'alert' });
     expect(warning.props.style).toMatchObject({
       backgroundColor: '#F9731626',
       borderColor: '#F9731644',
    });
    expect(textContent(warning)).toContain('Payments unavailable');
    expect(textContent(warning)).toContain('You can still add this item to your cart.');

    const buyNow = renderer.root.findByProps({ accessibilityLabel: 'Payments unavailable' });
    expect(buyNow.props.disabled).toBe(true);
    expect(textContent(buyNow)).toContain('Payments unavailable');

    // The add-to-cart control is an icon-only IconButton (was previously a
    // TouchableOpacity with a visually-hidden "Add to Cart" text node) —
    // both expose the same action via accessibilityLabel.
    const addToCart = renderer.root.findByProps({ accessibilityLabel: 'Add to cart' });
    expect(addToCart.props.disabled).toBe(false);

    await act(async () => {
      await addToCart.props.onPress();
      await flushPromises();
    });

    expect(addToCartMock).toHaveBeenCalledOnce();
    expect(textContent(renderer.root)).toContain('View bag');
    expect(routerMock.push).not.toHaveBeenCalledWith('/buyer-checkout?source=buynow');
  });

  it('keeps Add to Cart available when payment verification rejects, but blocks Buy Now with an unable-to-verify message', async () => {
    apiMock.buyer.sellerPaymentStatus.mockRejectedValue(new Error('payment status unavailable'));
    renderer = await renderScreen();

    await act(async () => {
      findTouchableByText(renderer, 'M').props.onPress();
      await flushPromises();
    });

    const addToCart = renderer.root.findByProps({ accessibilityLabel: 'Add to cart' });
    expect(addToCart.props.disabled).toBe(false);

    await act(async () => {
      await addToCart.props.onPress();
      await flushPromises();
    });

    expect(addToCartMock).toHaveBeenCalledOnce();
    expect(textContent(renderer.root)).toContain('View bag');

    const buyNow = renderer.root.findByProps({ accessibilityLabel: 'Buy now' });
    expect(buyNow.props.disabled).toBe(false);

    await act(async () => {
      await buyNow.props.onPress();
      await flushPromises();
    });

    expect(alertMock).toHaveBeenCalledWith(
      'Unable to verify payments',
      'We could not confirm this seller can accept payments. Check your connection and try again.',
    );
    expect(getCartMock).not.toHaveBeenCalled();
    expect(createBuyNowSessionMock).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalledWith('/buyer-checkout?source=buynow');
  });
});