import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue(null),
    userId: null,
  }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getAllKeys: vi.fn().mockResolvedValue([]),
    getItem: vi.fn().mockResolvedValue(null),
    multiRemove: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
    setItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  api,
  invalidateSellerPaymentStatusCache,
  SELLER_PAYMENT_STATUS_CACHE_TTL_MS,
  type SellerPaymentStatus,
} from './api';

const fetchMock = vi.fn();

function paymentResponse(status: SellerPaymentStatus): Response {
  return {
    ok: true,
    json: async () => status,
    text: async () => JSON.stringify(status),
  } as Response;
}

describe('seller payment status cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T12:00:00.000Z'));
    invalidateSellerPaymentStatusCache();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one request for repeated checks while keeping sellers independent', async () => {
    fetchMock
      .mockResolvedValueOnce(paymentResponse({ ready: true }))
      .mockResolvedValueOnce(paymentResponse({ ready: false, reason: 'Not enabled' }));

    const firstCheck = api.buyer.sellerPaymentStatus('seller-a');
    const duplicateCheck = api.buyer.sellerPaymentStatus('seller-a');
    const [first, duplicate] = await Promise.all([firstCheck, duplicateCheck]);

    expect(first).toEqual({ ready: true });
    expect(duplicate).toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const otherSeller = await api.buyer.sellerPaymentStatus('seller-b');
    expect(otherSeller).toEqual({ ready: false, reason: 'Not enabled' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/v1/buyer/seller-payment-status/seller-a'),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/v1/buyer/seller-payment-status/seller-b'),
      expect.any(Object),
    );

    vi.advanceTimersByTime(SELLER_PAYMENT_STATUS_CACHE_TTL_MS - 1);
    await expect(api.buyer.sellerPaymentStatus('seller-a')).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches again after the 60-second window expires', async () => {
    fetchMock
      .mockResolvedValueOnce(paymentResponse({ ready: true }))
      .mockResolvedValueOnce(paymentResponse({ ready: false, reason: 'Disconnected' }));

    await expect(api.buyer.sellerPaymentStatus('seller-a')).resolves.toEqual({ ready: true });
    vi.advanceTimersByTime(SELLER_PAYMENT_STATUS_CACHE_TTL_MS);

    await expect(api.buyer.sellerPaymentStatus('seller-a')).resolves.toEqual({
      ready: false,
      reason: 'Disconnected',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forces fresh checks after targeted and full-cache invalidation', async () => {
    fetchMock
      .mockResolvedValueOnce(paymentResponse({ ready: true }))
      .mockResolvedValueOnce(paymentResponse({ ready: false }))
      .mockResolvedValueOnce(paymentResponse({ ready: true }))
      .mockResolvedValueOnce(paymentResponse({ ready: true, reason: 'Reconnected' }))
      .mockResolvedValueOnce(paymentResponse({ ready: false, reason: 'Still offline' }));

    await api.buyer.sellerPaymentStatus('seller-a');
    invalidateSellerPaymentStatusCache('seller-a');
    await expect(api.buyer.sellerPaymentStatus('seller-a')).resolves.toEqual({ ready: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await api.buyer.sellerPaymentStatus('seller-b');
    invalidateSellerPaymentStatusCache();
    await expect(api.buyer.sellerPaymentStatus('seller-a')).resolves.toEqual({
      ready: true,
      reason: 'Reconnected',
    });
    await expect(api.buyer.sellerPaymentStatus('seller-b')).resolves.toEqual({
      ready: false,
      reason: 'Still offline',
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('does not cache failed requests', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(paymentResponse({ ready: true }));

    await expect(api.buyer.sellerPaymentStatus('seller-a')).rejects.toThrow('offline');
    await expect(api.buyer.sellerPaymentStatus('seller-a')).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});