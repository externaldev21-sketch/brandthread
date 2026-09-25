import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
  },
}));

vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) } }));

import { ApiError } from './networkNotice';
import {
  __resetEngagementRetryQueueForTests,
  enqueueEngagementRetry,
  getQueuedEngagementActions,
  isRetryableFailure,
  processEngagementRetryQueue,
  setEngagementRetryExecutor,
} from './engagementRetryQueue';

describe('engagement retry queue', () => {
  beforeEach(() => {
    store.clear();
    __resetEngagementRetryQueueForTests();
  });

  it('classifies offline/server failures as retryable and real rejections as not', () => {
    expect(isRetryableFailure(new ApiError(408, '{}'))).toBe(true);
    expect(isRetryableFailure(new ApiError(503, '{}'))).toBe(true);
    expect(isRetryableFailure(new Error('Network request failed'))).toBe(true);
    expect(isRetryableFailure(new ApiError(403, '{}'))).toBe(false);
    expect(isRetryableFailure(new ApiError(404, '{}'))).toBe(false);
  });

  it('replays a queued action once the executor succeeds, then drops it', async () => {
    let calls = 0;
    setEngagementRetryExecutor(async () => { calls += 1; });
    await enqueueEngagementRetry({ kind: 'like', targetId: 'post-1', payload: { value: 'add' } });
    // enqueue already triggers one processing pass
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
    expect(getQueuedEngagementActions()).toHaveLength(0);
  });

  it('keeps a retryable failure queued for the next pass', async () => {
    let attempt = 0;
    setEngagementRetryExecutor(async () => {
      attempt += 1;
      if (attempt === 1) throw new ApiError(408, '{}');
    });
    await enqueueEngagementRetry({ kind: 'save', targetId: 'post-2' });
    await new Promise((r) => setTimeout(r, 0));
    expect(getQueuedEngagementActions()).toHaveLength(1);
    expect(getQueuedEngagementActions()[0].attempts).toBe(1);

    await processEngagementRetryQueue();
    expect(attempt).toBe(2);
    expect(getQueuedEngagementActions()).toHaveLength(0);
  });

  it('drops a real rejection instead of retrying it forever', async () => {
    setEngagementRetryExecutor(async () => { throw new ApiError(403, '{}'); });
    await enqueueEngagementRetry({ kind: 'repost', targetId: 'post-3' });
    await new Promise((r) => setTimeout(r, 0));
    expect(getQueuedEngagementActions()).toHaveLength(0);
  });

  it('de-dupes rapid re-taps on the same target+kind to only the latest intent', async () => {
    setEngagementRetryExecutor(async () => { throw new ApiError(408, '{}'); });
    await enqueueEngagementRetry({ kind: 'like', targetId: 'post-4', payload: { value: 'add' } });
    await enqueueEngagementRetry({ kind: 'like', targetId: 'post-4', payload: { value: 'remove' } });
    await new Promise((r) => setTimeout(r, 0));
    const pending = getQueuedEngagementActions();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ value: 'remove' });
  });
});
