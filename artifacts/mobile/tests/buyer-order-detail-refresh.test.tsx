import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, authState, focusState } = vi.hoisted(() => ({
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
    ScrollView: nativeComponent('ScrollView'),
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
  useLocalSearchParams: () => ({ id: 'order-1' }),
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

vi.mock('@/components/BrandthreadUI', () => {
  const native = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);

  return {
    BrandthreadCard: native('BrandthreadCard'),
    BrandthreadHeader: native('BrandthreadHeader'),
    BrandthreadScreen: native('BrandthreadScreen'),
    GradientCard: native('GradientCard'),
    PrimaryButton: native('PrimaryButton'),
    SecondaryButton: native('SecondaryButton'),
    StatusBadge: native('StatusBadge'),
  };
});

vi.mock('@/lib/theme', () => ({
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
  CONTENT_MAX_WIDTH: 720,
  GRID_MAX_WIDTH: 1080,
  BREAKPOINT: { tablet: 768, desktopWeb: 1024 },
}));

import BuyerOrderDetailScreen from '@/app/buyer-order-detail';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function orderRow({
  orderNumber,
  productName,
  status = 'processing',
  sellerName = 'Seller',
}: {
  orderNumber: string;
  productName: string;
  status?: string;
  sellerName?: string;
}) {
  return {
    id: 'order-1',
    orderNumber,
    ownerId: 'seller-1',
    sellerDisplayName: sellerName,
    status,
    subtotalCents: 4200,
    shippingCents: 0,
    totalCents: 4200,
    stripePaymentIntentId: 'pi-1',
    shippingAddress: {
      name: 'Buyer',
      street: '1 Main Street',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      country: 'US',
    },
    createdAt: '2026-08-31T12:00:00.000Z',
    items: [{
      productName,
      variantLabel: 'M',
      quantity: 1,
      priceCents: 4200,
    }],
  };
}

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

function renderedText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll(node => (node.type as unknown) === 'Text')
    .map(node => textContent(node.props.children))
    .join(' ');
}

function orderHeader(renderer: ReactTestRenderer) {
  return renderer.root.find(node => (node.type as unknown) === 'BrandthreadHeader');
}

function statusBadge(renderer: ReactTestRenderer) {
  return renderer.root.find(node => (node.type as unknown) === 'StatusBadge');
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<BuyerOrderDetailScreen />);
    await flushPromises();
  });
  return renderer;
}

async function refocusScreen() {
  await act(async () => {
    focusState.cleanup?.();
    focusState.cleanup = focusState.callback?.() as (() => void) | undefined;
    await flushPromises();
  });
}

describe('buyer order detail refresh lifecycle', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T12:00:00.000Z'));
    authState.userId = 'buyer-a';
    focusState.callback = undefined;
    focusState.cleanup = undefined;
    apiMock.buyer.orders.get.mockReset();
    apiMock.buyer.orders.cancel.mockReset();
    apiMock.returns.listBuyer.mockReset();
    apiMock.returns.listBuyer.mockResolvedValue([]);
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = undefined;
    }
    vi.useRealTimers();
  });

  it('keeps the existing order visible while a focused refresh updates the indicator and timestamp', async () => {
    const initial = deferred<ReturnType<typeof orderRow>>();
    const refreshed = deferred<ReturnType<typeof orderRow>>();
    apiMock.buyer.orders.get
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refreshed.promise);

    renderer = await renderScreen();
    initial.resolve(orderRow({ orderNumber: 'BT-1001', productName: 'Everyday Tee' }));
    await act(async () => {
      await flushPromises();
    });

    expect(orderHeader(renderer).props.title).toBe('Order BT-1001');
    expect(statusBadge(renderer).props.label).toBe('PROCESSING');
    expect(renderedText(renderer)).toContain('Last updated just now');

    vi.setSystemTime(new Date('2026-08-31T12:02:00.000Z'));
    await act(async () => {
      renderer?.update(<BuyerOrderDetailScreen />);
      await flushPromises();
    });
    expect(renderedText(renderer)).toContain('Last updated 2m ago');

    await refocusScreen();
    expect(orderHeader(renderer).props.title).toBe('Order BT-1001');
    expect(renderedText(renderer)).toContain('Everyday Tee');
    expect(renderedText(renderer)).toContain('Updating order status…');
    expect(renderedText(renderer)).not.toContain('Last updated');

    refreshed.resolve(orderRow({
      orderNumber: 'BT-1001',
      productName: 'Everyday Tee',
      status: 'shipped',
    }));
    await act(async () => {
      await flushPromises();
    });

    expect(statusBadge(renderer).props.label).toBe('SHIPPED');
    expect(renderedText(renderer)).not.toContain('Updating order status…');
    expect(renderedText(renderer)).toContain('Last updated just now');
  });

  it('cancels an outdated focus request so a prior account cannot repopulate the detail screen', async () => {
    const initialBuyerA = deferred<ReturnType<typeof orderRow>>();
    const outdatedBuyerA = deferred<ReturnType<typeof orderRow>>();
    const buyerB = deferred<ReturnType<typeof orderRow>>();
    apiMock.buyer.orders.get
      .mockReturnValueOnce(initialBuyerA.promise)
      .mockReturnValueOnce(outdatedBuyerA.promise)
      .mockReturnValueOnce(buyerB.promise);

    renderer = await renderScreen();
    initialBuyerA.resolve(orderRow({
      orderNumber: 'BT-A',
      productName: 'Buyer A Private Tee',
      sellerName: 'Seller A',
    }));
    await act(async () => {
      await flushPromises();
    });
    expect(orderHeader(renderer).props.title).toBe('Order BT-A');

    await refocusScreen();
    expect(renderedText(renderer)).toContain('Buyer A Private Tee');

    authState.userId = 'buyer-b';
    await act(async () => {
      renderer?.update(<BuyerOrderDetailScreen />);
      await flushPromises();
    });

    expect(renderedText(renderer)).not.toContain('Buyer A Private Tee');
    expect(renderedText(renderer)).not.toContain('Seller A');
    expect(renderer.root.findAll(node => (node.type as unknown) === 'BrandthreadHeader')).toHaveLength(0);

    outdatedBuyerA.resolve(orderRow({
      orderNumber: 'BT-A',
      productName: 'Buyer A Late Response',
      sellerName: 'Seller A',
    }));
    await act(async () => {
      await flushPromises();
    });
    expect(renderedText(renderer)).not.toContain('Buyer A Late Response');
    expect(renderedText(renderer)).not.toContain('Seller A');

    buyerB.resolve(orderRow({
      orderNumber: 'BT-B',
      productName: 'Buyer B Private Tee',
      sellerName: 'Seller B',
    }));
    await act(async () => {
      await flushPromises();
    });

    expect(orderHeader(renderer).props.title).toBe('Order BT-B');
    expect(renderedText(renderer)).toContain('Buyer B Private Tee');
    expect(renderedText(renderer)).not.toContain('Buyer A');
    expect(renderedText(renderer)).not.toContain('Seller A');
  });
});