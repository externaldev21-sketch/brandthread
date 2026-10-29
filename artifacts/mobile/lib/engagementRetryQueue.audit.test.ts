import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
    removeItem: vi.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
  },
}));

vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) } }));

import { ApiError } from './networkNotice';
import {
  __resetEngagementRetryQueueForTests,
  enqueueEngagementRetry,
  getQueuedEngagementActions,
  processEngagementRetryQueue,
  setEngagementRetryExecutor,
} from './engagementRetryQueue';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('engagement retry queue — taps queued while a replay is in flight', () => {
  beforeEach(() => {
    store.clear();
    __resetEngagementRetryQueueForTests();
  });

  it('keeps an action enqueued while a pass is awaiting the network', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const replayed: string[] = [];
    let first = true;
    setEngagementRetryExecutor(async (action) => {
      if (first) { first = false; await gate; throw new ApiError(503, '{}'); }
      replayed.push(action.targetId);
    });
    await enqueueEngagementRetry({ kind: 'like', targetId: 'post-1' }); // starts a pass, parked on the gate
    await tick();
    // Offline tap on another post while that pass is still running.
    await enqueueEngagementRetry({ kind: 'like', targetId: 'post-2' });
    release();
    await tick();
    await tick();
    const ids = getQueuedEngagementActions().map((a) => a.targetId).sort();
    expect(ids).toContain('post-2');
    expect(ids).toContain('post-1');
    const persisted = JSON.parse([...store.values()].at(-1)!) as { targetId: string }[];
    expect(persisted.map((a) => a.targetId).sort()).toEqual(['post-1', 'post-2']);
  });

  it('a re-tap during the pass wins over the pass’s retry copy of the same target', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    setEngagementRetryExecutor(async () => { await gate; throw new ApiError(503, '{}'); });
    await enqueueEngagementRetry({ kind: 'like', targetId: 'post-1', payload: { value: 'add' } });
    await tick();
    await enqueueEngagementRetry({ kind: 'like', targetId: 'post-1', payload: { value: 'remove' } });
    release();
    await tick();
    await tick();
    const pending = getQueuedEngagementActions();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ value: 'remove' });
    await processEngagementRetryQueue();
  });
});
