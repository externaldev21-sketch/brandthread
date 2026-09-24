import { describe, expect, it, vi } from 'vitest';
import { createNotificationResponseHandler } from './notificationNavigation';

function response(identifier: string) {
  return {
    notification: {
      request: {
        identifier,
        content: {
          data: {
            type: 'subscription_trial_will_end',
            route: '/subscription',
          },
        },
      },
    },
  };
}

function targetResponse(identifier: string, data: Record<string, unknown>) {
  return {
    notification: {
      request: {
        identifier,
        content: { data },
      },
    },
  };
}

describe('notification response navigation', () => {
  it('routes both warm and cold taps to Subscription only once', () => {
    const router = { push: vi.fn() };
    const handledResponseIds = new Set<string>();
    const handleWarmResponse = createNotificationResponseHandler(router, handledResponseIds);
    const handleColdResponse = createNotificationResponseHandler(router, handledResponseIds);
    const trialWarning = response('trial-warning-123');

    handleWarmResponse(trialWarning);
    handleColdResponse(trialWarning);

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/subscription');
  });

  it('does not treat a different notification as a stale redirect', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);

    handler(response('trial-warning-123'));
    handler(response('trial-warning-456'));

    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenNthCalledWith(1, '/subscription');
    expect(router.push).toHaveBeenNthCalledWith(2, '/subscription');
  });

  it('routes a conversation notification to the chat thread', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('msg-1', { targetType: 'conversation', targetId: 'convo-abc' }));
    expect(router.push).toHaveBeenCalledWith('/chat/convo-abc');
  });

  it('routes a drop-live notification to the buyer drop detail screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('drop-1', { targetType: 'drop', targetId: 'drop-abc' }));
    expect(router.push).toHaveBeenCalledWith('/buyer-drop-detail?id=drop-abc');
  });

  it('routes a buyer-facing product alert (price drop / back in stock) to the buyer product screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('price-1', { targetType: 'product', targetId: 'prod-abc', type: 'price_drop' }));
    expect(router.push).toHaveBeenCalledWith('/buyer-product-detail?productId=prod-abc');
  });

  it('routes a low-stock alert on the same product targetType to the seller product screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('stock-1', { targetType: 'product', targetId: 'prod-abc', type: 'low_stock' }));
    expect(router.push).toHaveBeenCalledWith('/product-detail?id=prod-abc');
  });

  it('routes a return status notification to the return detail screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('return-1', { targetType: 'return', targetId: 'ret-abc' }));
    expect(router.push).toHaveBeenCalledWith('/return-detail?returnId=ret-abc');
  });

  it('routes a payout notification to the payouts screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('payout-1', { targetType: 'payout', targetId: 'po_123' }));
    expect(router.push).toHaveBeenCalledWith('/payouts');
  });
});