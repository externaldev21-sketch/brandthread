import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  Modal: nativeComponent('Modal'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  TouchableWithoutFeedback: nativeComponent('TouchableWithoutFeedback'),
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@/components/ui/Icon', () => ({ Icon: nativeComponent('Icon') }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#999', accent: '#fff', border: '#333', cardElevated: '#222', error: '#f88' } }),
}));
vi.mock('@/components/CachedImage', () => ({ CachedImage: nativeComponent('CachedImage') }));
vi.mock('@/components/ui/ErrorState', () => ({ ErrorState: nativeComponent('ErrorState') }));
vi.mock('@/components/ui/BottomSheet', () => ({ Sheet: nativeComponent('Sheet') }));
vi.mock('@/lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/buy-now/VariantPickerSheet', () => ({ VariantPickerSheet: nativeComponent('VariantPickerSheet') }));
vi.mock('@/components/buy-now/OrderSuccessSheet', () => ({ OrderSuccessSheet: nativeComponent('OrderSuccessSheet') }));

const { browser, api, cart } = vi.hoisted(() => ({
  browser: {
    openAuthSessionAsync: vi.fn(),
    openBrowserAsync: vi.fn(),
  },
  api: {
    buyer: {
      addresses: { list: vi.fn() },
      checkout: { createSession: vi.fn(), verifySession: vi.fn() },
    },
    auth: { me: vi.fn() },
  },
  cart: {
    getCart: vi.fn(async () => ({ items: [] })),
    createBuyNowSession: vi.fn(async () => {}),
    getBuyerProduct: vi.fn(),
  },
}));
vi.mock('expo-web-browser', () => browser);
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/services/cartService', () => cart);

import { BuyNowFlow } from './BuyNowFlow';
import type { BuyerProduct, BuyerProductVariant } from '@/services/cartTypes';

const variant: BuyerProductVariant = {
  id: 'v1', title: 'M', optionValues: [], priceCents: 5000, inventoryQuantity: 3, isAvailable: true,
};
const product: BuyerProduct = {
  id: 'p1', sellerId: 's1', sellerName: 'Northline', sellerHandle: 'northline', name: 'Shell Jacket', description: '',
  priceCents: 5000, imageUris: [], category: 'Outerwear', isPreOrder: false, cancellationPolicy: '', refundPolicy: '',
  isActive: true, tags: [], options: [], variants: [variant],
};
const address = { id: 'a1', isDefault: true, recipientName: 'Ada', street: '1 Main', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US', phone: '555' };

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

async function renderAndPay() {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<BuyNowFlow product={product} variant={variant} onClose={vi.fn()} />); });
  await flush();
  const sheet = tree.root.findByType('Sheet' as never);
  expect(sheet.props.primaryAction?.label).toBe('Pay $50.00');
  await act(async () => { void sheet.props.primaryAction.onPress(); });
  await flush();
  return tree;
}
const errorText = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());

beforeEach(() => {
  vi.clearAllMocks();
  api.buyer.addresses.list.mockResolvedValue([address]);
  api.auth.me.mockResolvedValue({ email: 'ada@example.com' });
  api.buyer.checkout.createSession.mockResolvedValue({ sessionId: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
  browser.openBrowserAsync.mockResolvedValue({ type: 'cancel' });
});
afterEach(() => { vi.useRealTimers(); });

describe('BuyNowFlow hosted checkout result (audit)', () => {
  it('a closed browser is not proof of cancellation: a paid session shows the order', async () => {
    api.buyer.checkout.verifySession.mockResolvedValue({ status: 'complete', paymentStatus: 'paid', amountTotal: 5000, orderId: 'o1', orderNumber: '1001', declineReason: null });
    const tree = await renderAndPay();
    expect(api.buyer.checkout.verifySession).toHaveBeenCalledWith('cs_1');
    const success = tree.root.findAllByType('OrderSuccessSheet' as never);
    expect(success).toHaveLength(1);
    expect(success[0].props.order.orderNumber).toBe('1001');
    // The payment method isn't known after Stripe's hosted page — never invented.
    expect(success[0].props.order.paymentMethodLabel).toBeUndefined();
    expect(errorText(tree)).not.toContain('Payment was cancelled');
  });

  it('opens an auth session that returns to the app on Stripe\'s redirect', async () => {
    api.buyer.checkout.verifySession.mockResolvedValue({ status: 'complete', paymentStatus: 'paid', amountTotal: 5000, orderId: 'o1', orderNumber: '1001', declineReason: null });
    await renderAndPay();
    expect(browser.openAuthSessionAsync).toHaveBeenCalledWith('https://checkout.stripe.test/cs_1', expect.stringContaining('checkout-return'));
  });

  it('a failed verification after payment says it is still confirming, not that checkout never started', async () => {
    browser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'brandthread://checkout-return?session_id=cs_1' });
    browser.openBrowserAsync.mockResolvedValue({ type: 'success', url: 'brandthread://checkout-return?session_id=cs_1' });
    api.buyer.checkout.verifySession.mockRejectedValue(new Error('network'));
    const tree = await renderAndPay();
    expect(errorText(tree)).toContain('still confirming your payment');
    expect(errorText(tree)).not.toContain('could not start secure checkout');
  });

  it('still reports a real cancel once Stripe confirms no payment', async () => {
    vi.useFakeTimers();
    api.buyer.checkout.verifySession.mockResolvedValue({ status: 'open', paymentStatus: 'unpaid', amountTotal: null, orderId: null, orderNumber: null, declineReason: null });
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<BuyNowFlow product={product} variant={variant} onClose={vi.fn()} />); });
    await flush();
    const sheet = tree.root.findByType('Sheet' as never);
    await act(async () => { void sheet.props.primaryAction.onPress(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await flush();
    expect(errorText(tree)).toContain('Payment was cancelled.');
  });
});
