import React from 'react';
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({
    getQueryData: () => undefined,
    setQueryData: vi.fn(),
    fetchQuery: ({ queryFn }: { queryFn: () => Promise<unknown> }) => queryFn(),
  }),
}));
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, authState, focusState, paramsState, scrollToMock } = vi.hoisted(() => ({
  paramsState: { params: { id: 'order-1' } as Record<string, string> },
  scrollToMock: vi.fn(),
  apiMock: {
    buyer: {
      orders: {
        get: vi.fn(),
        cancel: vi.fn(),
      },
    },
    returns: {
      listBuyer: vi.fn(),
    },
  },
  authState: { userId: 'buyer-a' as string | null },
  focusState: {
    callback: undefined as (() => void | (() => void)) | undefined,
    cleanup: undefined as (() => void) | undefined,
  },
}));

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
    // A ref-able ScrollView so the screen's scrollTo() can be observed.
    ScrollView: React.forwardRef(function MockScrollView(props: Record<string, unknown>, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ scrollTo: scrollToMock }));
      return React.createElement('ScrollView', props, props.children as React.ReactNode);
    }),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    NativeModules: {},
    KeyboardAvoidingView: nativeComponent('KeyboardAvoidingView'),
    TurboModuleRegistry: { get: () => null },
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false) },
    Animated: {
      Value: class { constructor(_v?: number) {} setValue(_v: number) {} },
      View: nativeComponent('Animated.View'),
      event: () => () => {},
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
      sequence: () => ({ start: (cb?: () => void) => cb?.() }),
      loop: () => ({ start: () => {}, stop: () => {} }),
    },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
  };
});

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: authState.userId }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn(),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => paramsState.params,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react') as typeof import('react');
    focusState.callback = callback;
    React.useEffect(() => {
      const cleanup = callback();
      focusState.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      return () => {
        focusState.cleanup?.();
        focusState.cleanup = undefined;
      };
    }, [callback]);
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => apiMock,
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ primary: '#C7CDD5' }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#0A0A0B',
      card: '#18181B',
      cardElevated: '#222226',
      border: '#303044',
      text: '#F7F7FA',
      muted: '#AAAABC',
      subtle: '#77778A',
      accent: '#C7CDD5',
      accentDim: '#34383E',
      accentLight: '#F8FAFC',
      onAccent: '#FFFFFF',
      secondary: '#7D8793',
      secondaryDim: '#172554',
      primaryGradient: ['#17191D', '#727A84'],
      success: '#10B981',
      warning: '#F97316',
      error: '#F87171',
    },
  }),
}));

vi.mock('@/components/ScreenHeader', () => {
  const native = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return { ScreenHeader: native('ScreenHeader') };
});

vi.mock('@/components/BrandthreadUI', () => {
  const native = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);

  return {
    BrandthreadCard: native('BrandthreadCard'),
    BrandthreadScreen: native('BrandthreadScreen'),
    GradientCard: native('GradientCard'),
    PressableScale: native('PressableScale'),
    PrimaryButton: native('PrimaryButton'),
    SecondaryButton: native('SecondaryButton'),
    StatusBadge: native('StatusBadge'),
  };
});

// Real tokens (ELEVATION, TYPE, …) under the suite's pinned overrides, so a
// new token used by a shared component doesn't break this mock.
vi.mock('@/lib/theme', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/theme')>()),
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
  FONT: { regular: 'System', semibold: 'System', bold: 'System', medium: 'System' },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, pill: 999 },
  COMP: { buttonH: 52, tabBarH: 64 },
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xxl: 40 },
  GUTTER: 16,
  WEB_SAFE_AREA_TOP: 47,
  CONTENT_MAX_WIDTH: 720,
  GRID_MAX_WIDTH: 1080,
  BREAKPOINT: { tablet: 768, desktopWeb: 1024 },
}));

import BuyerOrderDetailScreen from '@/app/buyer-order-detail';

async function flushPromises() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

function orderRow(extra: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'BT-1001',
    ownerId: 'seller-1',
    sellerDisplayName: 'Seller',
    status: 'shipped',
    subtotalCents: 4200,
    shippingCents: 0,
    totalCents: 4200,
    stripePaymentIntentId: 'pi-1',
    shippingAddress: { name: 'Buyer', street: '1 Main Street', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
    createdAt: '2026-08-31T12:00:00.000Z',
    items: [{ productName: 'Everyday Tee', variantLabel: 'M', quantity: 1, priceCents: 4200 }],
    ...extra,
  };
}

const layout = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 393, height: 200 } } });

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<BuyerOrderDetailScreen />);
    await flushPromises();
  });
  return renderer;
}

async function layOut(renderer: ReactTestRenderer, contentY: number, sectionY: number | null) {
  await act(async () => {
    renderer.root.find(n => (n.type as unknown) === 'View' && n.props.testID === 'buyer-order-detail-content').props.onLayout(layout(contentY));
    if (sectionY != null) {
      renderer.root.find(n => (n.type as unknown) === 'View' && n.props.testID === 'order-tracking-section').props.onLayout(layout(sectionY));
    }
    await flushPromises();
  });
}

describe('buyer order detail: focus=tracking', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    authState.userId = 'buyer-a';
    scrollToMock.mockReset();
    apiMock.buyer.orders.get.mockReset();
    apiMock.returns.listBuyer.mockReset();
    apiMock.returns.listBuyer.mockResolvedValue([]);
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => { renderer?.unmount(); });
      renderer = undefined;
    }
  });

  it('scrolls to the tracking section once it has laid out', async () => {
    paramsState.params = { id: 'order-1', focus: 'tracking' };
    apiMock.buyer.orders.get.mockResolvedValue(orderRow({ trackingNumber: '1Z999', carrier: 'UPS', trackingStatus: 'in_transit' }));
    renderer = await renderScreen();

    await layOut(renderer, 16, 900);
    expect(scrollToMock).toHaveBeenCalledTimes(1);
    expect(scrollToMock).toHaveBeenCalledWith({ y: 16 + 900 - 8, animated: true });

    // Later re-layouts (e.g. the refresh indicator) don't yank the scroll back.
    await layOut(renderer, 40, 950);
    expect(scrollToMock).toHaveBeenCalledTimes(1);
  });

  it('opens normally without the focus param', async () => {
    paramsState.params = { id: 'order-1' };
    apiMock.buyer.orders.get.mockResolvedValue(orderRow({ trackingNumber: '1Z999', carrier: 'UPS', trackingStatus: 'in_transit' }));
    renderer = await renderScreen();

    await layOut(renderer, 16, 900);
    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it('opens normally when there is no tracking section yet', async () => {
    paramsState.params = { id: 'order-1', focus: 'tracking' };
    apiMock.buyer.orders.get.mockResolvedValue(orderRow({ status: 'processing' }));
    renderer = await renderScreen();

    expect(renderer.root.findAll(n => (n.type as unknown) === 'View' && n.props.testID === 'order-tracking-section')).toHaveLength(0);
    await layOut(renderer, 16, null);
    expect(scrollToMock).not.toHaveBeenCalled();
  });
});

describe('buyer order detail: cancelled order', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    paramsState.params = { id: 'order-1' };
    apiMock.buyer.orders.get.mockReset();
    apiMock.returns.listBuyer.mockReset();
    apiMock.returns.listBuyer.mockResolvedValue([]);
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => { renderer?.unmount(); });
      renderer = undefined;
    }
  });

  const texts = (r: ReactTestRenderer) => r.root.findAll(n => (n.type as unknown) === 'Text').map(n => textContent(n.props.children));

  it('shows the cancellation card once, without the duplicate progress pill', async () => {
    apiMock.buyer.orders.get.mockResolvedValue(orderRow({ status: 'cancelled', cancellationReason: 'out_of_stock', isCustomerVisible: true }));
    renderer = await renderScreen();

    const all = texts(renderer);
    expect(all.filter(t => t === 'Order cancelled')).toHaveLength(1);
    expect(all).not.toContain('Order progress');
  });

  it('keeps the progress pill when there is no cancellation card', async () => {
    apiMock.buyer.orders.get.mockResolvedValue(orderRow({ status: 'cancelled', cancellationReason: null }));
    renderer = await renderScreen();

    const all = texts(renderer);
    expect(all).toContain('Order progress');
    expect(all.filter(t => t === 'Order cancelled')).toHaveLength(1);
  });
});
