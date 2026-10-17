import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

const store = new Map<string, string>();
const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
    removeItem: vi.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
  },
}));
vi.mock('./serviceConfig', () => ({ serviceRequest }));
// AppState's CommonJS native bridge cannot run in Node. Exercise the real
// queue/replay logic here; lifecycle scheduling belongs to the native pump.
vi.mock('./engagementRetryQueue', async (importOriginal) => ({
  ...await importOriginal<typeof import('./engagementRetryQueue')>(),
  startEngagementRetryQueuePump: vi.fn(() => () => {}),
}));

import { ApiError } from './networkNotice';
import {
  __resetEngagementRetryQueueForTests,
  enqueueEngagementRetry,
  getQueuedEngagementActions,
  processEngagementRetryQueue,
  setEngagementRetryExecutor,
} from './engagementRetryQueue';
import { startEngagementRetryFallback } from './engagementRetryFallback';

describe('app-wide engagement retry fallback', () => {
  beforeEach(() => {
    store.clear();
    serviceRequest.mockReset();
    __resetEngagementRetryQueueForTests();
  });

  it('replays a queued like without the feed mounted', async () => {
    serviceRequest.mockRejectedValueOnce(new ApiError(408, '{}'));
    const stop = startEngagementRetryFallback();
    await enqueueEngagementRetry({ kind: 'like', targetId: 'post-1', payload: { value: 'remove' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(getQueuedEngagementActions()).toHaveLength(1);

    serviceRequest.mockResolvedValueOnce({ action: 'unliked' });
    await processEngagementRetryQueue();
    expect(getQueuedEngagementActions()).toHaveLength(0);
    const [path, init] = serviceRequest.mock.calls.at(-1)!;
    expect(path).toBe('/api/posts/post-1/interact');
    expect(JSON.parse(init.body)).toEqual({ type: 'like', value: 'remove' });
    stop();
  });

  it('leaves kinds that need the feed queued, untouched', async () => {
    const stop = startEngagementRetryFallback();
    await enqueueEngagementRetry({ kind: 'follow', targetId: 'seller-1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(getQueuedEngagementActions()).toHaveLength(1);
    expect(getQueuedEngagementActions()[0].attempts).toBe(0);
    expect(serviceRequest).not.toHaveBeenCalled();

    // The feed's executor still takes precedence once registered.
    const feedExecutor = vi.fn(async () => {});
    setEngagementRetryExecutor(feedExecutor);
    await processEngagementRetryQueue();
    expect(feedExecutor).toHaveBeenCalledTimes(1);
    expect(getQueuedEngagementActions()).toHaveLength(0);
    stop();
  });
});
