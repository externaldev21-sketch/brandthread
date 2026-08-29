import { describe, expect, it } from 'vitest';
import { visibleOrderForBuyer, visibleOrdersForBuyer } from './buyerOrdersVisibility';
import type { BuyerOrderView } from '@/services/orderTypes';

const buyerAOrder = {
  id: 'order-a',
  orderNumber: 'BT-A',
} as BuyerOrderView;

describe('buyer orders screen account switching', () => {
  it('hides Buyer A rows immediately while Buyer B has a delayed or failed request', () => {
    const renderedForA = visibleOrdersForBuyer([buyerAOrder], 'buyer-a', 'buyer-a');
    expect(renderedForA.map(order => order.id)).toEqual(['order-a']);

    // Clerk changes the active session before Buyer B's request settles.
    const whileBuyerBRequestIsPending = visibleOrdersForBuyer([buyerAOrder], 'buyer-a', 'buyer-b');
    expect(whileBuyerBRequestIsPending).toEqual([]);

    // Buyer B's failed request resolves to their own empty cache.
    const afterBuyerBRequestFails = visibleOrdersForBuyer([], 'buyer-b', 'buyer-b');
    expect(afterBuyerBRequestFails).toEqual([]);
  });

  it('hides Buyer A order details immediately when the active account changes', () => {
    expect(visibleOrderForBuyer(buyerAOrder, 'buyer-a', 'buyer-a')?.id).toBe('order-a');

    // Buyer B's detail request is still pending, but Buyer A's shipping and
    // order details are already ineligible to render.
    expect(visibleOrderForBuyer(buyerAOrder, 'buyer-a', 'buyer-b')).toBeNull();

    // A failed Buyer B request cannot restore the prior account's detail.
    expect(visibleOrderForBuyer(null, 'buyer-b', 'buyer-b')).toBeNull();
  });
});
