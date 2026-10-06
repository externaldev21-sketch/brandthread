import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  StyleSheet: { create: (styles: unknown) => styles },
  Linking: { openURL: vi.fn() },
  Platform: { OS: 'ios' },
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: Object.assign(nativeComponent('Feather'), { glyphMap: {} }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

const routerReplace = vi.fn();
const searchParams = vi.hoisted(() => ({ current: { orderIds: 'order-1,order-2' } as { orderIds?: string } }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => searchParams.current,
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, back: vi.fn(), canGoBack: () => false }),
}));

vi.mock('@/components/ScreenHeader', () => ({
  ScreenHeader: ({ title }: any) => React.createElement('ScreenHeader', { title }),
}));

vi.mock('@/components/layout/EmptyState', () => ({
  EmptyState: (props: any) => React.createElement('EmptyState', props),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({ label, onPress, disabled, loading, variant, size }: any) =>
    React.createElement('Button', { label, onPress, disabled, loading, variant, size, accessibilityLabel: label }),
}));

vi.mock('@/hooks/useSellerTabBarInset', () => ({
  useSellerTabBarInset: () => 96,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn().mockResolvedValue(false),
  shareAsync: vi.fn(),
}));

vi.mock('@/lib/theme', () => ({
  FONT: { regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
  ICON: { xs: 14, sm: 16, md: 20, lg: 24, xl: 28, xxl: 36 },
  COMP: { buttonH: 52, buttonHSm: 44, inputH: 52, tabBarH: 72, headerH: 56, cardRadius: 18, iconBtn: 44, minTouchTarget: 44 },
  BG: '#000000', CARD: '#101012', CARD_GLASS: '#1A1A1D', FG: '#FAFAFA', ACCENT: '#F7F7FA',
  MUTED: '#999999', SUBTLE: '#6B6B70', BORDER: '#2A2A2E',
  RED: '#F87171', SUCCESS: '#10B981', ORANGE: '#F59E0B', GOLD: '#D4AF37',
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#F7F7FA', success: '#10B981', error: '#F87171', muted: '#999', text: '#FAFAFA',
    },
  }),
}));

vi.mock('@/components/BrandthreadUI', () => ({
  BrandthreadCard: nativeComponent('BrandthreadCard'),
  PrimaryButton: ({ label, onPress, disabled, loading }: any) =>
    React.createElement('PrimaryButton', { label, onPress, disabled, loading, accessibilityLabel: label }),
  SecondaryButton: ({ label, onPress, disabled, loading }: any) =>
    React.createElement('SecondaryButton', { label, onPress, disabled, loading, accessibilityLabel: label }),
  SectionHeader: ({ title }: any) => React.createElement('SectionHeader', {}, title),
  PressableScale: nativeComponent('PressableScale'),
}));

const orderGetMock = vi.fn();
const updateStatusMock = vi.fn();
const apiStub = {
  orders: {
    get: (...args: unknown[]) => orderGetMock(...args),
    updateStatus: (...args: unknown[]) => updateStatusMock(...args),
  },
};
vi.mock('@/lib/api', () => ({
  useApi: () => apiStub,
}));

vi.mock('@/app/order-detail', () => ({
  adaptApiOrder: (raw: any) => raw,
}));

const getShippingRatesMock = vi.fn();
const purchaseShippingLabelMock = vi.fn();
vi.mock('@/services/orderService', () => ({
  getShippingRates: (...args: unknown[]) => getShippingRatesMock(...args),
  purchaseShippingLabel: (...args: unknown[]) => purchaseShippingLabelMock(...args),
}));

import FulfillBatchScreen from '@/app/fulfill-batch';

function order(id: string, orderNumber: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    orderNumber,
    customer: { name: `Customer ${orderNumber}`, shippingAddress: { name: 'x', line1: '1 Main', city: 'LA', state: 'CA', zip: '90001', country: 'US' } },
    lineItems: [],
    fulfillment: { fromAddress: undefined },
    labels: [],
    ...overrides,
  };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function findByLabel(renderer: ReactTestRenderer, type: string, label: string) {
  return renderer.root.findAll(node => node.type === type && node.props.label === label)[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.current = { orderIds: 'order-1,order-2' };
});

describe('fulfill-batch per-row summary', () => {
  it('reports per-order success and failure for bulk mark-shipped with no silent partial failures', async () => {
    orderGetMock.mockImplementation((id: string) => Promise.resolve(order(id, id === 'order-1' ? '1001' : '1002')));
    updateStatusMock.mockImplementation((id: string) =>
      id === 'order-1' ? Promise.resolve({}) : Promise.reject(new Error('Order changed while cancelling')));

    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FulfillBatchScreen />); });
    await flush();

    const shipBtn = findByLabel(renderer, 'Button', 'Mark shipped');
    await act(async () => { await shipBtn.props.onPress(); });
    await flush();

    const text = renderer.root.findAll(n => (n.type as any) === 'SectionHeader').map(n => String(n.children)).join(' ');
    expect(text).toContain('1 succeeded, 1 failed');

    const messages = renderer.root.findAllByType('Text' as any).map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children));
    expect(messages).toContain('Marked shipped');
    expect(messages).toContain('Order changed while cancelling');
  });

  it('purchases labels for unlabeled orders and skips already-labeled ones', async () => {
    orderGetMock.mockImplementation((id: string) => Promise.resolve(
      id === 'order-1'
        ? order(id, '1001', { labels: [{ id: 'lbl-existing', status: 'active', labelUrl: 'https://example.com/existing.pdf' }] })
        : order(id, '1002'),
    ));
    getShippingRatesMock.mockResolvedValue([
      { id: 'rate-1', carrier: 'USPS', service: 'Priority', priceCents: 500, estimatedDays: 3, estimatedDelivery: 'Jan 1', trackingIncluded: true, insuranceIncluded: false, isRecommended: false },
    ]);
    purchaseShippingLabelMock.mockResolvedValue({
      id: 'lbl-new', orderId: 'order-2', carrier: 'USPS', service: 'Priority', trackingNumber: '999',
      labelUrl: 'https://example.com/new.pdf', priceCents: 500, status: 'active', isDemo: false, purchasedAt: 'now',
    });

    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FulfillBatchScreen />); });
    await flush();

    const printBtn = findByLabel(renderer, 'Button', 'Print labels');
    await act(async () => { await printBtn.props.onPress(); });
    await flush();

    expect(purchaseShippingLabelMock).toHaveBeenCalledTimes(1);
    expect(purchaseShippingLabelMock).toHaveBeenCalledWith('order-2', expect.objectContaining({ id: 'rate-1' }), 'fulfill-batch-order-2');

    const messages = renderer.root.findAllByType('Text' as any).map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children));
    expect(messages).toContain('Already labeled');
    expect(messages).toContain('USPS Priority purchased');
  });

  it('renders the two bulk actions as equal siblings (same variant and size)', async () => {
    orderGetMock.mockImplementation((id: string) => Promise.resolve(order(id, id)));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FulfillBatchScreen />); });
    await flush();
    const print = findByLabel(renderer, 'Button', 'Print labels');
    const ship = findByLabel(renderer, 'Button', 'Mark shipped');
    expect(print.props.variant).toBe(ship.props.variant);
    expect(print.props.size).toBe(ship.props.size);
    const header = renderer.root.findAll(n => (n.type as any) === 'ScreenHeader')[0];
    expect(header.props.title).toBe('Fulfill 2 orders');
  });
});

describe('fulfill-batch with nothing selected', () => {
  it('shows an empty state (no spinner, no actions) and a sentence-case title', async () => {
    searchParams.current = {};
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FulfillBatchScreen />); });
    await flush();
    expect(orderGetMock).not.toHaveBeenCalled();
    const header = renderer.root.findAll(n => (n.type as any) === 'ScreenHeader')[0];
    expect(header.props.title).toBe('Fulfill orders');
    const empty = renderer.root.findAll(n => (n.type as any) === 'EmptyState');
    expect(empty).toHaveLength(1);
    expect(empty[0].props.title).toBe('No orders selected');
    expect(renderer.root.findAll(n => (n.type as any) === 'ActivityIndicator')).toHaveLength(0);
    expect(findByLabel(renderer, 'Button', 'Mark shipped')).toBeUndefined();
    expect(findByLabel(renderer, 'SecondaryButton', 'Done')).toBeUndefined();
  });

  it('shows a retryable error when none of the selected orders load', async () => {
    orderGetMock.mockRejectedValue(new Error('offline'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FulfillBatchScreen />); });
    await flush();
    const empty = renderer.root.findAll(n => (n.type as any) === 'EmptyState')[0];
    expect(empty.props.variant).toBe('error');
    expect(empty.props.actionLabel).toBe('Retry');
    orderGetMock.mockImplementation((id: string) => Promise.resolve(order(id, id)));
    await act(async () => { empty.props.onAction(); });
    await flush();
    expect(findByLabel(renderer, 'Button', 'Mark shipped')).toBeDefined();
  });
});
