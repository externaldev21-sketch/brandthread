import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));

import {
  confirmSamplePayment,
  createSampleCheckoutSession,
  getBulkWalletOptions,
  getProductionOrder,
  getManufacturersByIds,
  getSample,
  getSamples,
  payBulkOrderFromWallet,
  submitSampleReview,
  addSampleRevision,
  uploadSampleImage,
} from './manufacturerService';

describe('manufacturer order payment service contracts', () => {
  beforeEach(() => serviceRequest.mockReset());

  it('creates and confirms a hosted sample checkout session', async () => {
    serviceRequest
      .mockResolvedValueOnce({ sessionId: 'cs_1', url: 'https://checkout.stripe.test/cs_1', paymentStatus: 'unpaid' })
      .mockResolvedValueOnce({ id: 'sample_1', status: 'payment_received', priceCents: 1200, revision: 2, createdAt: '2026-01-01', updatedAt: '2026-01-01' });

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
      .mockResolvedValueOnce({ id: 'bulk_1', orderType: 'bulk', status: 'payment_received', priceCents: 5000, quantity: 10, revision: 2, createdAt: '2026-01-01', updatedAt: '2026-01-01' });
    await expect(getBulkWalletOptions('bulk_1')).resolves.toMatchObject({ requiredCents: 5000 });
    await expect(payBulkOrderFromWallet('bulk_1', 'wallet_1')).resolves.toMatchObject({ id: 'bulk_1', status: 'active' });
    expect(serviceRequest).toHaveBeenNthCalledWith(1, '/api/sample-orders/bulk_1/payment-options');
    expect(serviceRequest).toHaveBeenNthCalledWith(2, '/api/sample-orders/bulk_1/pay-from-wallet', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps insufficient-wallet errors available for retry UI', async () => {
    serviceRequest.mockRejectedValueOnce(new Error('Wallet funds unavailable'));
    await expect(payBulkOrderFromWallet('bulk_1', 'wallet_1')).rejects.toThrow('Wallet funds unavailable');
  });

  it('sends the persisted revision for seller decisions and returns upload revisions', async () => {
    serviceRequest
      .mockResolvedValueOnce({ id: 'sample_1', manufacturerId: 'b7d2c2d0-a3ae-4d65-90e4-d777f1f1bca1', orderType: 'sample', status: 'approved', priceCents: 1200, revision: 4, createdAt: '2026-01-01', updatedAt: '2026-01-01' })
      .mockResolvedValueOnce({ id: 'review_1', rating: 5 })
      .mockResolvedValueOnce({ id: 'sample_1', orderType: 'sample', status: 'revision_requested', priceCents: 1200, revision: 5, createdAt: '2026-01-01', updatedAt: '2026-01-01' })
      .mockResolvedValueOnce({ imageUrls: ['https://signed/image.jpg'], revision: 6 });

    await submitSampleReview('sample_1', 3, {
      decision: 'approved', overallRating: 5, qualityRating: 5, fitRating: 5, materialRating: 5,
      colorRating: 5, printRating: 5, packagingRating: 5, notes: '', imageUris: [],
    });
    await addSampleRevision('sample_1', 4, { title: 'Sleeve', notes: '', priority: 'medium', imageUris: [], fileIds: [] });
    await expect(uploadSampleImage('sample_1', 'image/jpeg', new Uint8Array([1]))).resolves
      .toEqual({ imageUrls: ['https://signed/image.jpg'], revision: 6 });

    expect(serviceRequest).toHaveBeenNthCalledWith(1, '/api/sample-orders/sample_1/sample-detail',
      expect.objectContaining({ body: expect.stringContaining('"expectedRevision":3') }));
    expect(serviceRequest).toHaveBeenNthCalledWith(2, '/api/manufacturers/public/b7d2c2d0-a3ae-4d65-90e4-d777f1f1bca1/reviews',
      expect.objectContaining({ body: expect.stringContaining('"sampleOrderId":"sample_1"') }));
    expect(serviceRequest).toHaveBeenNthCalledWith(3, '/api/sample-orders/sample_1/sample-detail',
      expect.objectContaining({ body: expect.stringContaining('"expectedRevision":4') }));
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
        revision: 1,
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
        revision: 1,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      });

    await expect(getSample('sample_1')).resolves.toMatchObject({ manufacturerPayoutReady: false });
    await expect(getProductionOrder('bulk_1')).resolves.toMatchObject({ manufacturerPayoutReady: true });
  });

  it('treats every status after payment as paid and maps the completion date', async () => {
    const base = { orderType: 'sample', priceCents: 2500, revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
    serviceRequest.mockResolvedValueOnce([
      { ...base, id: 'unpaid', status: 'pending_payment' },
      { ...base, id: 'paid', status: 'payment_received' },
      { ...base, id: 'sewing', status: 'cut_and_sew' },
      { ...base, id: 'shipped', status: 'shipped', shippedAt: '2026-02-01T00:00:00.000Z' },
      { ...base, id: 'delivered', status: 'delivered', shippedAt: '2026-02-01T00:00:00.000Z', deliveredAt: '2026-02-05T00:00:00.000Z' },
      { ...base, id: 'approved', status: 'approved' },
      { ...base, id: 'reversed', status: 'delivered', paymentReviewState: 'reversed' },
      { ...base, id: 'cancelled', status: 'cancelled' },
    ]);
    const samples = Object.fromEntries((await getSamples()).map((sample) => [sample.id, sample]));
    expect(samples.unpaid.paymentStatus).toBe('pending');
    expect(samples.cancelled.paymentStatus).toBe('pending');
    expect(samples.reversed.paymentStatus).toBe('pending');
    for (const id of ['paid', 'sewing', 'shipped', 'delivered', 'approved']) {
      expect(samples[id].paymentStatus).toBe('paid');
    }
    expect(samples.delivered).toMatchObject({
      estimatedCompletionDate: '2026-02-05T00:00:00.000Z',
      shippedDate: '2026-02-01T00:00:00.000Z',
      deliveredDate: '2026-02-05T00:00:00.000Z',
    });
    expect(samples.paid.estimatedCompletionDate).toBeUndefined();
  });
});

describe('getManufacturersByIds', () => {
  beforeEach(() => serviceRequest.mockReset());
  const a = 'b7d2c2d0-a3ae-4d65-90e4-d777f1f1bca1';
  const b = 'c8e3d3e1-b4bf-4e76-a1f5-e888f2f2cdb2';

  it('dedupes ids and fetches them in a single request', async () => {
    serviceRequest.mockResolvedValueOnce([
      { id: a, businessName: 'Porto Knit', country: 'Portugal', photos: [] },
      { id: b, businessName: 'Lisbon Leather', country: 'Portugal', photos: [] },
    ]);
    const result = await getManufacturersByIds([a, b, a, '']);
    expect(serviceRequest).toHaveBeenCalledTimes(1);
    expect(serviceRequest).toHaveBeenCalledWith(`/api/manufacturers/partners?ids=${a},${b}`);
    expect(result.map((item) => [item.id, item.name])).toEqual([[a, 'Porto Knit'], [b, 'Lisbon Leather']]);
  });

  it('makes no request for an empty list', async () => {
    await expect(getManufacturersByIds([])).resolves.toEqual([]);
    expect(serviceRequest).not.toHaveBeenCalled();
  });
});
