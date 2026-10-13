import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authState, waitlistMock, prefsMock } = vi.hoisted(() => ({
  authState: { signedIn: true },
  waitlistMock: {
    join: vi.fn(async () => ({ joined: true })),
    leave: vi.fn(async () => ({ left: true })),
    check: vi.fn(async () => ({ joined: false })),
  },
  prefsMock: { get: vi.fn(async () => ({ sizes: {}, likedBrandIds: [], styleInterests: [], surveyCompletedAt: null, updatedAt: null })) },
}));
const { stableApi } = vi.hoisted(() => {
  let cached: unknown = null;
  return { stableApi: { get: (base: any) => cached ?? (cached = { ...base, waitlist: waitlistMock, buyer: { ...base.buyer, preferences: prefsMock } }) } };
});

const {
  addToCartMock,
  alertMock,
  apiMock,
  createBuyNowSessionMock,
  getCartMock,
  invalidatePaymentCacheMock,
  previewCatalogEnabledMock,
  previewCatalogProductMock,
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
      recentlyViewed: { record: vi.fn(async () => {}) },
    },
    reviews: {
      forProduct: vi.fn(),
    },
    publicSellers: {
      recordStoreVisit: vi.fn(),
    },
  },
  createBuyNowSessionMock: vi.fn(),
  getCartMock: vi.fn(),
  invalidatePaymentCacheMock: vi.fn(),
  previewCatalogEnabledMock: vi.fn(),
  previewCatalogProductMock: vi.fn(),
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
      spring: () => ({ start: (cb?: () => void) => cb?.() }),
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
    NativeModules: {},
    TurboModuleRegistry: { get: () => null },
    AccessibilityInfo: { isReduceMotionEnabled: async () => true, addEventListener: () => ({ remove: () => {} }), announceForAccessibility: () => {} },
    Easing: { inOut: (v: unknown) => v, out: (v: unknown) => v, cubic: () => 0, ease: () => 0, bezier: () => () => 0 },
    FlatList: nativeComponent('FlatList'),
    Keyboard: { dismiss: () => {}, addListener: () => ({ remove: () => {} }) },
    Linking: { openURL: async () => {} },
    Share: { share: async () => ({}) },
    TextInput: nativeComponent('TextInput'),
    KeyboardAvoidingView: nativeComponent('KeyboardAvoidingView'),
    TouchableWithoutFeedback: nativeComponent('TouchableWithoutFeedback'),
    Switch: nativeComponent('Switch'),
    PixelRatio: { get: () => 3, getFontScale: () => 1, roundToNearestPixel: (n: number) => n },
    I18nManager: { isRTL: false },
    InteractionManager: { runAfterInteractions: (fn: () => void) => { fn(); return { cancel: () => {} }; } },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isSignedIn: authState.signedIn, userId: authState.signedIn ? 'buyer-1' : null }),
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

vi.mock('expo-blur', () => ({ BlurView: 'BlurView' }));

vi.mock('react-native-svg', () => {
  const el = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
  return {
    default: el('Svg'), Svg: el('Svg'), Line: el('SvgLine'), Path: el('SvgPath'), Rect: el('SvgRect'), Circle: el('SvgCircle'),
    G: el('SvgG'), Defs: el('SvgDefs'), LinearGradient: el('SvgLinearGradient'), RadialGradient: el('SvgRadialGradient'),
    Stop: el('SvgStop'), Polyline: el('SvgPolyline'), Polygon: el('SvgPolygon'), Ellipse: el('SvgEllipse'),
    Text: el('SvgText'), ClipPath: el('SvgClipPath'), Mask: el('SvgMask'),
  };
});

vi.mock('expo-router', () => ({
  useGlobalSearchParams: () => ({}),
  useFocusEffect: () => {},
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
    default: { View: el('AnimatedView'), Text: el('AnimatedText'), createAnimatedComponent: (c: unknown) => c },
    createAnimatedComponent: (c: unknown) => c,
    useSharedValue: sharedValue,
    useAnimatedProps: (fn: () => Record<string, unknown>) => fn(),
    withDelay: (_d: number, v: unknown) => v,
    withSequence: (...v: unknown[]) => v[v.length - 1],
    withRepeat: (v: unknown) => v,
    cancelAnimation: () => {},
    runOnJS: (fn: unknown) => fn,
    interpolate: () => 0,
    Extrapolation: { CLAMP: 'clamp' },
    FadeIn: { duration: () => ({}) },
    FadeOut: { duration: () => ({}) },
    useReducedMotion: () => false,
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

// Stable like the real useMemo'd client (a new object per render re-runs effects).
vi.mock('@/hooks/useApi', () => ({ useApi: () => stableApi.get(apiMock) }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false, isBuyerDevPreview: () => false, isSellerDevPreview: () => false }));

vi.mock('@/components/ProductReviewsSection', () => ({ ProductReviewsSection: () => null }));

vi.mock('@/lib/previewCatalog', () => ({
  isPreviewCatalogEnabled: previewCatalogEnabledMock,
  getPreviewCatalogProduct: previewCatalogProductMock,
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    accent: '#727A84',
    primary: '#C7CDD5',
  }),
}));

vi.mock('@/lib/api', () => ({
  invalidateSellerPaymentStatusCache: invalidatePaymentCacheMock,
  useApi: () => stableApi.get(apiMock),
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

vi.mock('@/components/products/ProductVideo', () => ({ ProductVideo: () => null }));
vi.mock('@/components/ProductQuestionsSection', () => ({ ProductQuestionsSection: () => null }));
vi.mock('@/components/products/CompleteTheFit', () => ({ CompleteTheFit: () => null }));
vi.mock('@/components/first-run-tips/FirstRunTip', () => ({ FirstRunTip: () => null }));
vi.mock('@/components/products/LaunchCountdown', () => ({ LaunchCountdown: () => null }));
vi.mock('@/components/products/PreOrderShipBy', () => ({ PreOrderShipBy: () => null }));
vi.mock('@/components/products/StockCounter', () => ({ StockCounter: () => null }));
vi.mock('@/components/SaveHeart', () => ({ SaveHeart: () => null }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('expo-video', () => ({ useVideoPlayer: () => ({}), VideoView: () => null }));
vi.mock('@/components/ui/Snackbar', () => ({
  Snackbar: (props: Record<string, unknown>) => React.createElement('Snackbar', props),
}));
vi.mock('@react-navigation/native', () => ({ NavigationContext: React.createContext(undefined), useIsFocused: () => true, useFocusEffect: () => {}, useNavigation: () => ({}) }));

import BuyerProductDetailScreen from '@/app/buyer-product-detail';
import { invalidateBuyerPreferences } from '@/hooks/useBuyerPreferences';


// Field Shell Jacket: S in stock, M sold out, L in stock. No size chart, so
// the auto-select uses the saved outerwear size directly.
const jacket = {
  id: 'product-1',
  ownerId: 'seller-1',
  sellerDisplayName: 'Northline',
  name: 'Field Shell Jacket',
  category: 'Outerwear',
  description: '',
  images: [],
  variants: [
    { id: 'v-s', size: 'S', priceCents: 22000, stock: 4 },
    { id: 'v-m', size: 'M', priceCents: 22000, stock: 0 },
    { id: 'v-l', size: 'L', priceCents: 22000, stock: 2 },
  ],
};

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

const sizeChip = (r: ReactTestRenderer, label: string) =>
  r.root.find((n: any) => n.type === 'Pressable' && n.props.testID === `option-opt_size-size_${label}`);
const notifyButton = (r: ReactTestRenderer) => r.root.findAll((n: any) => n.props?.testID === 'product-notify-me' && typeof n.props.onPress === 'function')[0];
const snackbar = (r: ReactTestRenderer) => r.root.findByType('Snackbar' as never);

async function renderScreen(params: Record<string, string> = { productId: 'product-1' }) {
  useLocalSearchParamsMock.mockReturnValue(params);
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<BuyerProductDetailScreen />); await flush(); });
  await act(async () => { await flush(); });
  return renderer;
}

describe('buyer product detail: sold-out size restock reminder', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateBuyerPreferences();
    authState.signedIn = true;
    apiMock.publicProducts.get.mockResolvedValue(jacket);
    apiMock.publicProducts.related.mockResolvedValue([]);
    apiMock.publicProducts.taggedVideos.mockResolvedValue([]);
    apiMock.buyer.sellerPaymentStatus.mockResolvedValue({ ready: true });
    apiMock.reviews.forProduct.mockResolvedValue({ reviews: [], avgRating: 0, totalCount: 0 });
    apiMock.publicSellers.recordStoreVisit.mockResolvedValue(undefined);
    getCartMock.mockResolvedValue({ items: [] });
    previewCatalogEnabledMock.mockReturnValue(false);
    waitlistMock.check.mockImplementation(async () => ({ joined: false }));
    prefsMock.get.mockImplementation(async () => ({ sizes: {}, likedBrandIds: [], styleInterests: [], surveyCompletedAt: null, updatedAt: null }));
  });

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
  });

  it('a sold-out size chip keeps its sold-out state but can be selected, which shows Notify me and keeps Add to cart disabled', async () => {
    renderer = await renderScreen();
    const m = sizeChip(renderer, 'M');
    expect(m.props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(m.props.accessibilityLabel).toBe('Size, M, sold out');
    expect(m.props.accessibilityHint).toBe('Select to set a restock reminder');
    expect(m.props.disabled).toBe(false);
    expect(notifyButton(renderer)).toBeUndefined();

    await act(async () => { m.props.onPress(); await flush(); });
    expect(sizeChip(renderer, 'M').props.accessibilityState.selected).toBe(true);
    expect(textContent(notifyButton(renderer))).toContain('Notify me when back in stock');
    expect(waitlistMock.check).toHaveBeenCalledWith('v-m');
    expect(renderer.root.findByProps({ testID: 'product-add-to-cart' }).props.disabled).toBe(true);
  });

  it('Notify me joins the waitlist, shows "Reminder set", and tapping again leaves it with "Reminder removed"', async () => {
    renderer = await renderScreen();
    await act(async () => { sizeChip(renderer!, 'M').props.onPress(); await flush(); });

    await act(async () => { await notifyButton(renderer!).props.onPress(); await flush(); });
    expect(waitlistMock.join).toHaveBeenCalledWith('product-1', 'v-m');
    expect(snackbar(renderer).props).toMatchObject({ visible: true, message: 'Reminder set' });
    expect(textContent(notifyButton(renderer))).toContain('Reminder set');
    expect(alertMock).not.toHaveBeenCalled();

    await act(async () => { await notifyButton(renderer!).props.onPress(); await flush(); });
    expect(waitlistMock.leave).toHaveBeenCalledWith('product-1', 'v-m');
    expect(snackbar(renderer).props).toMatchObject({ visible: true, message: 'Reminder removed' });
    expect(textContent(notifyButton(renderer))).toContain('Notify me when back in stock');
  });

  it('signed out: Notify me opens sign-in without calling the waitlist API', async () => {
    authState.signedIn = false;
    renderer = await renderScreen();
    await act(async () => { sizeChip(renderer!, 'M').props.onPress(); await flush(); });
    await act(async () => { await notifyButton(renderer!).props.onPress(); await flush(); });
    expect(waitlistMock.join).not.toHaveBeenCalled();
    expect(waitlistMock.check).not.toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/sign-in' }));
  });
});

describe('buyer product detail: saved size auto-select', () => {
  let renderer: ReactTestRenderer | undefined;
  const withSaved = (size: string) => prefsMock.get.mockImplementation(async () => ({
    sizes: { outerwear: size }, likedBrandIds: [], styleInterests: [], surveyCompletedAt: null, updatedAt: null,
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateBuyerPreferences();
    authState.signedIn = true;
    apiMock.publicProducts.get.mockResolvedValue(jacket);
    apiMock.publicProducts.related.mockResolvedValue([]);
    apiMock.publicProducts.taggedVideos.mockResolvedValue([]);
    apiMock.buyer.sellerPaymentStatus.mockResolvedValue({ ready: true });
    apiMock.reviews.forProduct.mockResolvedValue({ reviews: [], avgRating: 0, totalCount: 0 });
    apiMock.publicSellers.recordStoreVisit.mockResolvedValue(undefined);
    getCartMock.mockResolvedValue({ items: [] });
    previewCatalogEnabledMock.mockReturnValue(false);
  });

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
  });

  it('preselects the saved size when it is in stock', async () => {
    withSaved('L');
    renderer = await renderScreen();
    expect(sizeChip(renderer, 'L').props.accessibilityState.selected).toBe(true);
  });

  it('does not preselect a sold-out saved size', async () => {
    withSaved('M');
    renderer = await renderScreen();
    for (const label of ['S', 'M', 'L']) expect(sizeChip(renderer, label).props.accessibilityState.selected).toBe(false);
  });

  it('never overrides the cart-edit variant', async () => {
    withSaved('L');
    renderer = await renderScreen({ productId: 'product-1', editVariantId: 'v-s', editCartItemId: 'ci-1' });
    expect(sizeChip(renderer, 'S').props.accessibilityState.selected).toBe(true);
    expect(sizeChip(renderer, 'L').props.accessibilityState.selected).toBe(false);
  });

  it('applies once: a size the buyer taps afterwards stays', async () => {
    withSaved('L');
    renderer = await renderScreen();
    await act(async () => { sizeChip(renderer!, 'S').props.onPress(); await flush(); });
    await act(async () => { await flush(); });
    expect(sizeChip(renderer, 'S').props.accessibilityState.selected).toBe(true);
    expect(sizeChip(renderer, 'L').props.accessibilityState.selected).toBe(false);
  });

  it('guests get no preselect and no preferences request', async () => {
    authState.signedIn = false;
    renderer = await renderScreen();
    expect(prefsMock.get).not.toHaveBeenCalled();
    for (const label of ['S', 'M', 'L']) expect(sizeChip(renderer, label).props.accessibilityState.selected).toBe(false);
  });
});
