import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  },
}));

import {
  flushPendingBuyerOnboardingSync,
  isRecoverableBuyerOnboardingSyncError,
  pendingBuyerOnboardingSyncKey,
  queueBuyerOnboardingSync,
  syncBuyerOnboarding,
} from './buyerOnboardingSync';
import { ApiError } from './networkNotice';

function createApi() {
  return {
    auth: {
      saveBuyerPreferences: vi.fn(async (_styleInterests: string[], _expectedClerkId: string) => ({ ok: true })),
      completeOnboarding: vi.fn(async (_accountType: 'buyer', _expectedClerkId: string) => ({ onboardingComplete: true })),
    },
  };
}

describe('buyer onboarding pending sync', () => {
  beforeEach(() => storage.clear());

  it('re-sends preferences and completion, then clears the pending payload', async () => {
    const api = createApi();
    await queueBuyerOnboardingSync('buyer-1', ['Minimal', 'Vintage']);

    await expect(flushPendingBuyerOnboardingSync('buyer-1', api)).resolves.toBe(true);
    expect(api.auth.saveBuyerPreferences).toHaveBeenCalledWith(['Minimal', 'Vintage'], 'buyer-1');
    expect(api.auth.completeOnboarding).toHaveBeenCalledWith('buyer', 'buyer-1');
    expect(storage.has(pendingBuyerOnboardingSyncKey('buyer-1'))).toBe(false);
  });

  it('only treats transport and server failures as recoverable', () => {
    expect(isRecoverableBuyerOnboardingSyncError(new Error('offline'))).toBe(true);
    expect(isRecoverableBuyerOnboardingSyncError(new ApiError(503, '{"error":"busy"}'))).toBe(true);
    expect(isRecoverableBuyerOnboardingSyncError(
      new ApiError(409, '{"error":"incomplete","code":"ONBOARDING_PROFILE_INCOMPLETE"}'),
    )).toBe(false);
    expect(isRecoverableBuyerOnboardingSyncError(new ApiError(401, '{"error":"unauthorized"}'))).toBe(false);
  });

  it('keeps the pending payload when a retry fails', async () => {
    const api = createApi();
    api.auth.saveBuyerPreferences.mockRejectedValueOnce(new Error('offline'));
    await queueBuyerOnboardingSync('buyer-2', ['Streetwear']);

    await expect(flushPendingBuyerOnboardingSync('buyer-2', api)).rejects.toThrow('offline');
    expect(storage.has(pendingBuyerOnboardingSyncKey('buyer-2'))).toBe(true);
  });

  it('does not clear a queued payload until both requests succeed', async () => {
    const api = createApi();
    api.auth.completeOnboarding.mockRejectedValueOnce(new Error('conflict'));
    await queueBuyerOnboardingSync('buyer-3', ['Luxury']);

    await expect(syncBuyerOnboarding('buyer-3', ['Luxury'], api)).rejects.toThrow('conflict');
    expect(storage.has(pendingBuyerOnboardingSyncKey('buyer-3'))).toBe(true);
  });
});