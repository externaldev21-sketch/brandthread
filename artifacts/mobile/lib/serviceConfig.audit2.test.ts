/**
 * whenConfigured() raced configuration against an 8s reject timer and never
 * cleared that timer when configuration won, leaving a pending timer behind
 * every early request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/networkNotice', () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, public body: string) { super(body); } },
  dismissNetworkNotice: vi.fn(),
  reportNetworkError: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  createApi: vi.fn(),
  signedOutGate: vi.fn(async () => null),
  signedOutPreviewAnswer: vi.fn(async () => null),
  storeContextHeaders: () => ({}),
  versionApiPath: (p: string) => p,
}));
vi.mock('@/lib/guestApiPolicy', () => ({ isSignedInOnlyPath: () => false }));
vi.mock('@/lib/devPreview', () => ({ isSellerDevPreview: () => false }));
vi.mock('@/lib/requestResilience', () => ({
  AUTO_RETRY_DELAY_MS: 1,
  isTransientFailure: () => false,
  slowRequests: { start: () => () => {} },
}));

import { configureServices, serviceRequest } from './serviceConfig';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('whenConfigured timer', () => {
  it('is cleared once configuration arrives first', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })));
    const pending = serviceRequest('/api/thing');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1); // the 8s wait
    configureServices(async () => 'token');
    await expect(pending).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
