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

  it('routes a buyer_to_buyer conversation notification to the buyer conversation screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('msg-1', { targetType: 'conversation', targetId: 'convo-abc', type: 'new_friend_message' }));
    expect(router.push).toHaveBeenCalledWith('/buyer-conversation?id=convo-abc');
  });

  it('routes an order-message conversation notification to the seller conversation screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('msg-2', { targetType: 'conversation', targetId: 'convo-xyz', type: 'new_order_message' }));
    expect(router.push).toHaveBeenCalledWith('/seller-conversation?id=convo-xyz');
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

  it('routes a buyer order update on targetType "order" to the buyer order screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('ship-1', { targetType: 'order', targetId: 'ord-1', type: 'order_shipped' }));
    expect(router.push).toHaveBeenCalledWith('/buyer-order-detail?id=ord-1');
  });

  it('still routes a seller order push (new order, buyer cancelled) to the seller order screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('new-1', { targetType: 'order', targetId: 'ord-2', type: 'new_order_received' }));
    handler(targetResponse('cxl-1', { targetType: 'order', targetId: 'ord-3', type: 'order_cancelled_by_buyer' }));
    expect(router.push).toHaveBeenNthCalledWith(1, '/order-detail?id=ord-2');
    expect(router.push).toHaveBeenNthCalledWith(2, '/order-detail?id=ord-3');
  });

  it('routes a return status notification to the return detail screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('return-1', { targetType: 'return', targetId: 'ret-abc' }));
    expect(router.push).toHaveBeenCalledWith('/return-detail?returnId=ret-abc');
  });

  it('opens social pushes at the same exact place the Activity row does', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('c-1', { targetType: 'post', targetId: 'p1', type: 'post_comment', commentId: 'c9' }));
    handler(targetResponse('m-1', { targetType: 'post', targetId: 'p1', type: 'mention', commentId: 'c10' }));
    handler(targetResponse('l-1', { targetType: 'post', targetId: 'p1', type: 'post_like' }));
    handler(targetResponse('s-1', { targetType: 'story', targetId: 's1', type: 'story_like' }));
    handler(targetResponse('f-1', { targetType: 'user', targetId: 'u1', type: 'new_follower' }));
    handler(targetResponse('t-1', { targetType: 'thread_cash_transfer', targetId: 't1', type: 'thread_cash_received' }));
    expect(router.push.mock.calls.map((call) => call[0])).toEqual([
      '/buyer-post-comments?postId=p1&commentId=c9',
      '/buyer-post-comments?postId=p1&commentId=c10',
      '/buyer-post-viewer?postId=p1',
      '/buyer-story-viewer?storyId=s1&allStoryIds=s1',
      '/buyer-other-profile?userId=u1',
      '/thread-cash',
    ]);
  });

  it('routes a payout notification to the payouts screen', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('payout-1', { targetType: 'payout', targetId: 'po_123' }));
    expect(router.push).toHaveBeenCalledWith('/payouts');
  });

  it('opens a community message push in the community chat, never a DM', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);
    handler(targetResponse('c1', { type: 'community_message', targetType: 'community', targetId: 'g1', communityId: 'g1' }));
    handler(targetResponse('c2', { targetType: 'community', targetId: 'g 2' }));
    handler(targetResponse('c3', { type: 'community_message', communityId: 'g3' }));
    expect(router.push.mock.calls.map(([href]) => href)).toEqual([
      '/community-chat?id=g1',
      '/community-chat?id=g%202',
      '/community-chat?id=g3',
    ]);
  });
});
