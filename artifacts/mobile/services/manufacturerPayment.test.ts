import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));

import {
  confirmSamplePayment,
  createSampleCheckoutSession,
  getBulkWalletOptions,
  getProductionOrder,
  getSample,
  payBulkOrderFromWallet,
} from './manufacturerService';

describe('manufacturer order payment service contracts', () => {
  beforeEach(() => serviceRequest.mockReset());

  it('creates and confirms a hosted sample checkout session', async () => {
    serviceRequest
      .mockResolvedValueOnce({ sessionId: 'cs_1', url: 'https://checkout.stripe.test/cs_1', paymentStatus: 'unpaid' })
      .mockResolvedValueOnce({ id: 'sample_1', status: 'payment_received', priceCents: 1200, createdAt: '2026-01-01', updatedAt: '2026-01-01' });

    await expect(createSampleCheckoutSession('sample_1', 'brandthread://sample-detail?id=sample_1'))
      .resolves.toMatchObject({ sessionId: 'cs_1' });
    await expect(confirmSamplePayment('sample_1')).resolves.toMatchObject({ id: 'sample_1', status: 'paid' });
    expect(serviceRequest).toHaveBeenNthCalledWith(1, '/api/sample-orders/sample_1/checkout-session', expect.objectContaining({ method: 'POST' }));
    expect(serviceRequest).toHaveBeenNthCalledWith(2, '/api/sample-orders/sample_1/pay', expect.objectContaining({ method: 'POST' }));
  });

  it('surfaces checkout confirmation failure so the screen can retry', async () => {
    serviceRequest.mockRejectedValueOnce(new Error('Payment has not succeeded'));
    await expect(confirmSamplePayment('sample_1')).rejects.toThrow('Payment has not succeeded');
  });

  it('loads eligible bulk wallets and pays only through the chosen wallet', async () => {
    serviceRequest
      .mockResolvedValueOnce({ orderId: 'bulk_1', requiredCents: 5000, wallets: [{ id: 'wallet_1', dropId: 'drop_1', availableCents: 6000, eligible: true }] })
      .mockResolvedValueOnce({ id: 'bulk_1', orderType: 'bulk', status: 'payment_received', priceCents: 5000, quantity: 10, createdAt: '2026-01-01', updatedAt: '2026-01-01' });
    await expect(getBulkWalletOptions('bulk_1')).resolves.toMatchObject({ requiredCents: 5000 });
    await expect(payBulkOrderFromWallet('bulk_1', 'wallet_1')).resolves.toMatchObject({ id: 'bulk_1', status: 'active' });
    expect(serviceRequest).toHaveBeenNthCalledWith(1, '/api/sample-orders/bulk_1/payment-options');
    expect(serviceRequest).toHaveBeenNthCalledWith(2, '/api/sample-orders/bulk_1/pay-from-wallet', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps insufficient-wallet errors available for retry UI', async () => {
    serviceRequest.mockRejectedValueOnce(new Error('Wallet funds unavailable'));
    await expect(payBulkOrderFromWallet('bulk_1', 'wallet_1')).rejects.toThrow('Wallet funds unavailable');
  });

  it('preserves manufacturer payout availability on seller order details', async () => {
    serviceRequest
      .mockResolvedValueOnce({
        id: 'sample_1',
        orderType: 'sample',
        status: 'pending_payment',
        manufacturerHasStripe: true,
        manufacturerPayoutReady: false,
        priceCents: 2500,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      })
      .mockResolvedValueOnce({ imageUrls: [] })
      .mockResolvedValueOnce({
        id: 'bulk_1',
        orderType: 'bulk',
        status: 'pending_payment',
        manufacturerHasStripe: true,
        manufacturerPayoutReady: true,
        priceCents: 5000,
        quantity: 10,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      });

    await expect(getSample('sample_1')).resolves.toMatchObject({ manufacturerPayoutReady: false });
    await expect(getProductionOrder('bulk_1')).resolves.toMatchObject({ manufacturerPayoutReady: true });
  });
});