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
  Alert: { alert: vi.fn() },
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  ScrollView: nativeComponent('ScrollView'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  TextInput: nativeComponent('TextInput'),
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  Image: nativeComponent('Image'),
  Linking: { openURL: vi.fn() },
  StyleSheet: { create: (styles: unknown) => styles },
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
  Animated: {
    Value: class { constructor(_v?: number) {} setValue() {} interpolate() { return 0; } },
    View: nativeComponent('Animated.View'),
    timing: () => ({ start: (cb?: () => void) => cb?.() }),
    spring: () => ({ start: (cb?: () => void) => cb?.() }),
    parallel: (_anims: unknown[]) => ({ start: (cb?: () => void) => cb?.() }),
  },
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: Object.assign(nativeComponent('Feather'), { glyphMap: {} }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ orderId: 'order-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn().mockResolvedValue(false),
  shareAsync: vi.fn(),
}));

const cameraPermissionState = { granted: true };
vi.mock('expo-camera', () => ({
  CameraView: nativeComponent('CameraView'),
  useCameraPermissions: () => [cameraPermissionState, vi.fn().mockResolvedValue({ granted: true })],
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/theme', () => ({
  FONT: { regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
  ICON: { xs: 14, sm: 16, md: 20, lg: 24, xl: 28, xxl: 36 },
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#0A0A0B', card: '#18181B', border: '#222', text: '#FAFAFA',
      muted: '#999', subtle: '#888', accent: '#F7F7FA', accentDim: '#F7F7FA22',
      success: '#10B981', warning: '#F97316', error: '#F87171', onAccent: '#0A0A0B',
    },
  }),
}));

vi.mock('@/components/BrandthreadUI', () => ({
  BrandthreadCard: nativeComponent('BrandthreadCard'),
  GradientCard: nativeComponent('GradientCard'),
  PrimaryButton: ({ label, onPress, disabled, loading }: any) =>
    React.createElement('PrimaryButton', { label, onPress, disabled, loading, accessibilityLabel: label }),
  SecondaryButton: ({ label, onPress, disabled, loading }: any) =>
    React.createElement('SecondaryButton', { label, onPress, disabled, loading, accessibilityLabel: label }),
  SectionHeader: ({ title }: any) => React.createElement('SectionHeader', {}, title),
}));

vi.mock('@/components/layout', () => ({
  Header: nativeComponent('Header'),
}));

const updateStatusMock = vi.fn().mockResolvedValue({});
const orderGetMock = vi.fn();
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

vi.mock('@/lib/money', () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

const getShippingRatesMock = vi.fn();
const purchaseShippingLabelMock = vi.fn();
const addTrackingMock = vi.fn().mockResolvedValue({});
const getPackagePresetsMock = vi.fn();
const createPackagePresetMock = vi.fn();
const deletePackagePresetMock = vi.fn();
const updateFulfillmentChecklistMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/services/orderService', () => ({
  getShippingRates: (...args: unknown[]) => getShippingRatesMock(...args),
  purchaseShippingLabel: (...args: unknown[]) => purchaseShippingLabelMock(...args),
  addTracking: (...args: unknown[]) => addTrackingMock(...args),
  getPackagePresets: (...args: unknown[]) => getPackagePresetsMock(...args),
  createPackagePreset: (...args: unknown[]) => createPackagePresetMock(...args),
  deletePackagePreset: (...args: unknown[]) => deletePackagePresetMock(...args),
  updateFulfillmentChecklist: (...args: unknown[]) => updateFulfillmentChecklistMock(...args),
}));

vi.mock('@/lib/packingSlip', () => ({
  sharePackingSlip: vi.fn().mockResolvedValue(undefined),
}));

import FulfillOrderScreen from '@/app/fulfill-order';

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: '1001',
    sellerName: 'Threadhaus',
    customer: {
      name: 'Jordan Kim',
      shippingAddress: { name: 'Jordan Kim', line1: '1 Main St', city: 'LA', state: 'CA', zip: '90001', country: 'US' },
    },
    lineItems: [
      { id: 'li1', productId: 'p1', productName: 'Hoodie', variant: 'Black / L', quantity: 1, unitPriceCents: 9800, discountAmountCents: 0, taxAmountCents: 0, totalCents: 9800, fulfillmentSource: 'seller', isPreOrder: false },
      { id: 'li2', productId: 'p2', productName: 'Tee', variant: 'White / M', quantity: 2, unitPriceCents: 2500, discountAmountCents: 0, taxAmountCents: 0, totalCents: 5000, fulfillmentSource: 'seller', isPreOrder: false },
    ],
    fulfillment: { id: 'f1', orderId: 'order-1', groups: [], type: 'seller', status: 'unfulfilled', isPicked: false, isPacked: false, fromAddress: undefined },
    labels: [],
    notes: [],
    ...overrides,
  };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function findByLabel(renderer: ReactTestRenderer, type: string, label: string) {
  return renderer.root.findAll(node => node.type === type && node.props.label === label)[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  getPackagePresetsMock.mockResolvedValue([
    { id: 'preset-1', name: 'Small Box', weightOz: 16, lengthIn: '10.00', widthIn: '8.00', heightIn: '4.00' },
  ]);
  getShippingRatesMock.mockResolvedValue([
    { id: 'rate-1', carrier: 'USPS', service: 'Priority', priceCents: 500, estimatedDays: 3, estimatedDelivery: 'Jan 1', trackingIncluded: true, insuranceIncluded: false, isRecommended: false },
  ]);
  purchaseShippingLabelMock.mockResolvedValue({
    id: 'lbl-1', orderId: 'order-1', carrier: 'USPS', service: 'Priority',
    trackingNumber: '9400111899', labelUrl: 'https://example.com/label.pdf',
    priceCents: 500, status: 'active', isDemo: false, purchasedAt: '2026-01-01T00:00:00.000Z',
  });
  updateStatusMock.mockResolvedValue({});
});

describe('fulfill-order step gating', () => {
  it('gates Continue on all items being checked, then saves isPicked and advances to step 2', async () => {
    orderGetMock.mockResolvedValue(makeOrder());
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<FulfillOrderScreen />);
    });
    await flush();

    const continueBtn = findByLabel(renderer, 'PrimaryButton', 'Continue');
    expect(continueBtn.props.disabled).toBe(true);

    const itemRows = renderer.root.findAllByType('TouchableOpacity' as any);
    for (const row of itemRows) {
      await act(async () => { row.props.onPress(); });
    }

    const continueBtnAfter = findByLabel(renderer, 'PrimaryButton', 'Continue');
    expect(continueBtnAfter.props.disabled).toBe(false);

    await act(async () => { await continueBtnAfter.props.onPress(); });
    await flush();

    expect(updateFulfillmentChecklistMock).toHaveBeenCalledWith('order-1', { isPicked: true });
    expect(renderer.root.findAll(node => (node.type as any) === 'SectionHeader').some(n => String(n.children).includes('Saved packages'))).toBe(true);
  });
});

describe('fulfill-order package step', () => {
  async function advanceToPackageStep(renderer: ReactTestRenderer) {
    const itemRows = renderer.root.findAllByType('TouchableOpacity' as any);
    for (const row of itemRows) {
      await act(async () => { row.props.onPress(); });
    }
    const continueBtn = findByLabel(renderer, 'PrimaryButton', 'Continue');
    await act(async () => { await continueBtn.props.onPress(); });
    await flush();
  }

  it('gates Continue until a preset or custom package is chosen', async () => {
    orderGetMock.mockResolvedValue(makeOrder());
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FulfillOrderScreen />); });
    await flush();
    await advanceToPackageStep(renderer);

    const continueBtn = findByLabel(renderer, 'PrimaryButton', 'Continue');
    expect(continueBtn.props.disabled).toBe(true);

    const presetChip = renderer.root.findAll(node => (node.type as any) === 'TouchableOpacity' && String((node.children[0] as any)?.props?.children ?? '').includes('Small Box'))[0]
      ?? renderer.root.findAllByType('TouchableOpacity' as any)[0];
    await act(async () => { presetChip.props.onPress(); });

    const continueBtnAfter = findByLabel(renderer, 'PrimaryButton', 'Continue');
    expect(continueBtnAfter.props.disabled).toBe(false);
  });
});

describe('fulfill-order shipping label purchase', () => {
  async function advanceToShippingStep(renderer: ReactTestRenderer) {
    const itemRows = renderer.root.findAllByType('TouchableOpacity' as any);
    for (const row of itemRows) {
      await act(async () => { row.props.onPress(); });
    }
    await act(async () => { await findByLabel(renderer, 'PrimaryButton', 'Continue').props.onPress(); });
    await flush();
    const presetChip = renderer.root.findAllByType('TouchableOpacity' as any)[0];
    await act(async () => { presetChip.props.onPress(); });
    await act(async () => { await findByLabel(renderer, 'PrimaryButton', 'Continue').props.onPress(); });
    await flush();
  }

  it('purchases a label and skips manual tracking, marking the order shipped without addTracking', async () => {
    orderGetMock.mockResolvedValue(makeOrder());
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FulfillOrderScreen />); });
    await flush();
    await advanceToShippingStep(renderer);

    expect(getShippingRatesMock).toHaveBeenCalled();

    const rateRow = renderer.root.findAllByType('TouchableOpacity' as any).find(n => typeof n.props.onPress === 'function' && !n.props.disabled);
    await act(async () => { await rateRow!.props.onPress(); });
    await flush();

    expect(purchaseShippingLabelMock).toHaveBeenCalledWith('order-1', expect.objectContaining({ id: 'rate-1' }), 'fulfill-order-1');

    await act(async () => { await findByLabel(renderer, 'PrimaryButton', 'Continue').props.onPress(); });
    await flush();

    const shipBtn = findByLabel(renderer, 'PrimaryButton', 'Mark as Shipped');
    await act(async () => { await shipBtn.props.onPress(); });
    await flush();

    expect(addTrackingMock).not.toHaveBeenCalled();
    expect(updateStatusMock).toHaveBeenCalledWith('order-1', 'shipped');
  });

  it('falls back to manual tracking entry and adds tracking before marking shipped', async () => {
    getShippingRatesMock.mockRejectedValue(new Error('Shipping rates are unavailable'));
    orderGetMock.mockResolvedValue(makeOrder());
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FulfillOrderScreen />); });
    await flush();
    await advanceToShippingStep(renderer);

    // Rates failed, so the screen should already be in manual mode.
    const trackingInput = renderer.root.findAllByType('TextInput' as any).find(n => n.props.placeholder === 'Tracking number');
    expect(trackingInput).toBeTruthy();
    await act(async () => { trackingInput!.props.onChangeText('1Z999AA10123456784'); });

    const continueBtn = findByLabel(renderer, 'PrimaryButton', 'Continue');
    await act(async () => { await continueBtn.props.onPress(); });
    await flush();

    const shipBtn = findByLabel(renderer, 'PrimaryButton', 'Mark as Shipped');
    await act(async () => { await shipBtn.props.onPress(); });
    await flush();

    expect(addTrackingMock).toHaveBeenCalledWith('order-1', 'USPS', '1Z999AA10123456784');
    expect(updateStatusMock).toHaveBeenCalledWith('order-1', 'shipped');
  });
});
