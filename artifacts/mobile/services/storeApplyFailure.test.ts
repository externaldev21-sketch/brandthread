import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/networkNotice';

const { fromLogoMock, fromMoodboardMock } = vi.hoisted(() => ({
  fromLogoMock: vi.fn(),
  fromMoodboardMock: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {},
}));

vi.mock('@/lib/api', () => ({
  api: {
    store: {
      fromLogo: fromLogoMock,
      fromMoodboard: fromMoodboardMock,
    },
  },
}));

import {
  generateFromLogo,
  generateFromMoodBoard,
  StoreApplyError,
  STORE_VISUAL_IMPORT_SIZE_MESSAGE,
  getStoreApplyFailure,
} from './storeService';

describe('store apply failure guidance', () => {
  beforeEach(() => {
    fromLogoMock.mockReset();
    fromMoodboardMock.mockReset();
  });

  it.each([
    new ApiError(413, JSON.stringify({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' },
      requestId: 'req-test',
    })),
    new ApiError(400, JSON.stringify({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' },
      requestId: 'req-test',
    })),
  ])('gives actionable resize guidance for oversized visual imports', (error) => {
    expect(getStoreApplyFailure(error)).toEqual({
      kind: 'payload-too-large',
      message: STORE_VISUAL_IMPORT_SIZE_MESSAGE,
    });
  });

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

  it('does not hide an oversized logo response behind the analysis fallback', async () => {
    const error = new ApiError(413, JSON.stringify({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' },
    }));
    fromLogoMock.mockRejectedValueOnce(error);

    await expect(generateFromLogo('file:///logo.png', 'oversized-base64')).rejects.toBe(error);
    expect(fromLogoMock).toHaveBeenCalledTimes(1);
  });

  it('does not hide an oversized mood board response behind the analysis fallback', async () => {
    const error = new ApiError(413, JSON.stringify({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' },
    }));
    fromMoodboardMock.mockRejectedValueOnce(error);

    await expect(
      generateFromMoodBoard(['file:///mood.png'], ['oversized-base64']),
    ).rejects.toBe(error);
    expect(fromMoodboardMock).toHaveBeenCalledTimes(1);
  });
});
