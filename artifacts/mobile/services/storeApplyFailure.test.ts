import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/networkNotice';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {},
}));

vi.mock('@/lib/api', () => ({
  api: {},
}));

import {
  StoreApplyError,
  getStoreApplyFailure,
} from './storeService';

describe('store apply failure guidance', () => {
  it.each([
    new TypeError('Failed to fetch'),
    new Error('Network request failed'),
    new Error('The request timed out'),
  ])('classifies %s as a connection problem with retry guidance', (error) => {
    expect(getStoreApplyFailure(error)).toEqual({
      kind: 'network',
      message: 'We could not reach Brandthread. Check your connection, then try again.',
    });
  });

  it.each([
    new ApiError(500, '{"error":"store unavailable"}'),
    new ApiError(422, '{"error":"invalid store design"}'),
    { status: 503, message: 'service unavailable' },
  ])('classifies HTTP failures as store service problems with retry guidance', (error) => {
    expect(getStoreApplyFailure(error)).toEqual({
      kind: 'server',
      message: 'Our store service could not save this design. Please try again in a moment.',
    });
  });

  it('preserves an existing classified failure when an apply flow wraps it', () => {
    const failure = {
      kind: 'network' as const,
      message: 'We could not reach Brandthread. Check your connection, then try again.',
    };

    expect(getStoreApplyFailure(new StoreApplyError(failure))).toEqual(failure);
  });
});