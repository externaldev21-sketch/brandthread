import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => ({ serviceRequest: vi.fn() }));
vi.mock('../lib/serviceConfig', () => request);

import { confirmOrderDelivery, declineOrderCard, getCallAvailability, payOrderCard, type PayDeps } from './manufacturerOrderFlow';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const unpaid = { id: ORDER_ID, status: 'pending_payment', manufacturerPayoutReady: true };

function deps(overrides: Partial<PayDeps> = {}) {
  const calls: string[] = [];
  const base: PayDeps = {
    createReturnUrl: (id) => `brandthread://sample-detail?id=${id}&paymentReturn=1`,
    createCheckoutSession: vi.fn(async () => { calls.push('session'); return { sessionId: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1', paymentStatus: 'unpaid' }; }),
    openCheckout: vi.fn(async () => { calls.push('open'); return { type: 'success' }; }),
    confirmPayment: vi.fn(async () => { calls.push('confirm'); return {}; }),
  };
  return { deps: { ...base, ...overrides }, calls };
}

describe('payOrderCard — payment state transitions', () => {
  it('opens Stripe Checkout with the app return URL and confirms only after a successful return', async () => {
    const { deps: d, calls } = deps();
    await expect(payOrderCard(unpaid, d)).resolves.toEqual({ status: 'paid' });
    expect(calls).toEqual(['session', 'open', 'confirm']);
    expect(d.openCheckout).toHaveBeenCalledWith('https://checkout.stripe.com/c/cs_1', `brandthread://sample-detail?id=${ORDER_ID}&paymentReturn=1`);
  });

  it('leaves the card unpaid when the seller closes checkout', async () => {
    for (const type of ['cancel', 'dismiss']) {
      const { deps: d, calls } = deps({ openCheckout: vi.fn(async () => ({ type })) });
      const outcome = await payOrderCard(unpaid, d);
      expect(outcome.status).toBe('cancelled');
      expect(calls).not.toContain('confirm');
    }
  });

  it('confirms an already-settled session without reopening checkout', async () => {
    const { deps: d, calls } = deps({ createCheckoutSession: vi.fn(async () => ({ sessionId: 'cs_1', url: null, paymentStatus: 'paid' })) });
    await expect(payOrderCard(unpaid, d)).resolves.toEqual({ status: 'paid' });
    expect(calls).toEqual(['confirm']);
  });

  it('reports a pending confirmation instead of failing when Stripe has not settled yet', async () => {
    const { deps: d } = deps({ confirmPayment: vi.fn(async () => { throw new Error('Payment has not succeeded'); }) });
    const outcome = await payOrderCard(unpaid, d);
    expect(outcome.status).toBe('pending');
  });

  it('blocks payment until the manufacturer can receive payouts', async () => {
    const { deps: d, calls } = deps();
    const outcome = await payOrderCard({ ...unpaid, manufacturerPayoutReady: false }, d);
    expect(outcome.status).toBe('blocked');
    expect(calls).toEqual([]);
    const server = deps({ createCheckoutSession: vi.fn(async () => { throw new Error('Manufacturer payouts are not ready'); }) });
    expect((await payOrderCard(unpaid, server.deps)).status).toBe('blocked');
  });

  it('never charges a cancelled or already-paid card', async () => {
    const { deps: d, calls } = deps();
    expect((await payOrderCard({ ...unpaid, status: 'cancelled' }, d)).status).toBe('blocked');
    expect((await payOrderCard({ ...unpaid, status: 'processing' }, d)).status).toBe('paid');
    expect(calls).toEqual([]);
  });

  it('surfaces a plain-English error when checkout cannot be created', async () => {
    const { deps: d } = deps({ createCheckoutSession: vi.fn(async () => { throw new Error('Network request failed'); }) });
    const outcome = await payOrderCard(unpaid, d);
    expect(outcome).toMatchObject({ status: 'error' });
    expect((outcome as { message: string }).message).toMatch(/Secure checkout/);
  });
});

describe('card and tracker requests', () => {
  beforeEach(() => request.serviceRequest.mockReset());

  it('declines, confirms delivery and checks call availability through the API', async () => {
    request.serviceRequest.mockResolvedValue({});
    await declineOrderCard(ORDER_ID, '  Found another maker ');
    expect(request.serviceRequest).toHaveBeenCalledWith(`/api/manufacturers/orders/${ORDER_ID}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Found another maker' }) });
    await confirmOrderDelivery(ORDER_ID);
    expect(request.serviceRequest).toHaveBeenLastCalledWith(`/api/manufacturers/orders/${ORDER_ID}/confirm-delivery`, { method: 'POST', body: '{}' });
    request.serviceRequest.mockResolvedValueOnce({ configured: false });
    await expect(getCallAvailability()).resolves.toBe(false);
    request.serviceRequest.mockRejectedValueOnce(new Error('offline'));
    await expect(getCallAvailability()).resolves.toBe(false);
  });

  it('rejects malformed order ids before calling the API', async () => {
    await expect(confirmOrderDelivery('not-an-id')).rejects.toThrow('not valid');
    expect(request.serviceRequest).not.toHaveBeenCalled();
  });
});
