/**
 * "Message {seller}" on the order-confirmed screen opens an ORDER thread. The
 * server keys order threads by contextOrderId (POST /api/conversations reuses
 * a thread only for the same contextOrderId, or for one with none), so the link
 * has to carry the verified order id — otherwise every later order reopens the
 * first order's thread, labelled with the first order's number.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock('expo-router', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: null, isSignedIn: false }) }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => ({}) }));
vi.mock('@/lib/storeReviewPrompt', () => ({ countRealOrders: () => 0, maybeRequestStoreReview: vi.fn() }));
vi.mock('@/lib/contextualPushPermission', () => ({ requestContextualPushPermission: vi.fn() }));
vi.mock('@/lib/orderConfetti', () => ({ hasPlayedOrderConfetti: async () => true, markOrderConfettiPlayed: vi.fn() }));
vi.mock('@/lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', subtle: '#555', border: '#333', accent: '#fff', cardElevated: '#111', background: '#000' } }),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/ui', () => ({ Button: () => null, SuccessCheck: () => null }));
vi.mock('@/components/ui/Avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: (props: Record<string, unknown>) => React.createElement('PressableScale', props, props.children as React.ReactNode),
}));
vi.mock('../CheckoutPrimitives', () => ({ Hairline: () => null }));
vi.mock('../OrderSummarySection', () => ({ groupDeliveryWindow: () => 'Arrives soon' }));
vi.mock('../AddToOrderOffer', () => ({ AddToOrderOffer: () => null }));
vi.mock('@/components/CoppedShareSheet', () => ({ CoppedShareSheet: () => null }));
vi.mock('@/lib/coppedCard', () => ({ coppedCardData: () => null }));

import { OrderConfirmation } from '../OrderConfirmation';

const session = {
  id: 'sess_1',
  deliveryGroups: [{
    sellerId: 'seller_1', sellerName: 'Orison Studio', selectedMethodId: 'm1',
    availableMethods: [{ id: 'm1', service: 'Standard', priceCents: 0, estimatedDays: 3 }],
    items: [{ id: 'i1', productName: 'Tee', quantity: 1, priceCents: 2500 }],
  }],
  contact: null, shippingAddress: null, paymentMethod: null,
} as never;

describe('OrderConfirmation — Message seller', () => {
  it('opens the thread for THIS order (contextOrderId = the verified order id)', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <OrderConfirmation
          session={session}
          verifiedOrders={[{ id: 'order_42', number: 'BT-1042', sellerId: 'seller_1' }]}
          finalizing={false}
          totalPaidCents={2500}
        />,
      );
    });
    const row = renderer.root.find((n) => (n.type as unknown) === 'PressableScale' && n.props.accessibilityLabel === 'Message Orison Studio');
    act(() => { row.props.onPress(); });
    expect(push).toHaveBeenCalledTimes(1);
    const href = String(push.mock.calls[0][0]);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('contextOrderId')).toBe('order_42');
    expect(params.get('contextOrderNumber')).toBe('BT-1042');
    expect(params.get('type')).toBe('buyer_to_seller_order');
  });
});
