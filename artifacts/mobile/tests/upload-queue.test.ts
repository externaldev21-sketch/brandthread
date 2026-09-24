import { describe, expect, it, vi } from 'vitest';
import {
  uploadReducer,
  createUploadItem,
  isUploading,
  hasErrors,
  allDone,
  backoffDelayMs,
  shouldRetry,
  runUploadWithRetry,
  type UploadEvent,
  type UploadItemState,
} from '@/lib/uploadQueue';

describe('uploadReducer state machine', () => {
  it('starts an item as uploading with an incremented attempt count', () => {
    const state = uploadReducer({}, { type: 'start', id: 'a' });
    expect(state.a).toMatchObject({ status: 'uploading', progress: 0, attempts: 1 });
  });

  it('clamps progress updates to 0–100', () => {
    let state = uploadReducer({}, { type: 'start', id: 'a' });
    state = uploadReducer(state, { type: 'progress', id: 'a', progress: 150 });
    expect(state.a.progress).toBe(100);
    state = uploadReducer(state, { type: 'progress', id: 'a', progress: -20 });
    expect(state.a.progress).toBe(0);
  });

  it('moves to done on success and records the result', () => {
    let state = uploadReducer({}, { type: 'start', id: 'a' });
    state = uploadReducer(state, { type: 'success', id: 'a', result: { url: 'x' } });
    expect(state.a).toMatchObject({ status: 'done', progress: 100, result: { url: 'x' } });
  });

  it('moves to error on failure without discarding the attempt count', () => {
    let state = uploadReducer({}, { type: 'start', id: 'a' });
    state = uploadReducer(state, { type: 'failure', id: 'a', error: 'network down' });
    expect(state.a).toMatchObject({ status: 'error', error: 'network down', attempts: 1 });
  });

  it('a retry (start again) increments attempts and clears the previous error', () => {
    let state = uploadReducer({}, { type: 'start', id: 'a' });
    state = uploadReducer(state, { type: 'failure', id: 'a', error: 'oops' });
    state = uploadReducer(state, { type: 'start', id: 'a' });
    expect(state.a).toMatchObject({ status: 'uploading', attempts: 2, error: undefined });
  });

  it('reset returns an item to its pristine pending state', () => {
    let state = uploadReducer({}, { type: 'start', id: 'a' });
    state = uploadReducer(state, { type: 'failure', id: 'a', error: 'oops' });
    state = uploadReducer(state, { type: 'reset', id: 'a' });
    expect(state.a).toEqual(createUploadItem('a'));
  });

  it('remove deletes the item entirely', () => {
    let state = uploadReducer({}, { type: 'start', id: 'a' });
    state = uploadReducer(state, { type: 'remove', id: 'a' });
    expect(state.a).toBeUndefined();
  });

  it('is a pure function: unrelated items are untouched', () => {
    const before: Record<string, UploadItemState> = { b: createUploadItem('b') };
    const after = uploadReducer(before, { type: 'start', id: 'a' });
    expect(after.b).toBe(before.b);
  });
});

describe('upload state derivations', () => {
  it('isUploading is true while anything is pending or uploading', () => {
    expect(isUploading({ a: createUploadItem('a') })).toBe(true);
    expect(isUploading({ a: { ...createUploadItem('a'), status: 'uploading' } })).toBe(true);
    expect(isUploading({ a: { ...createUploadItem('a'), status: 'done' } })).toBe(false);
  });

  it('hasErrors flags any item in error state', () => {
    expect(hasErrors({ a: { ...createUploadItem('a'), status: 'error' } })).toBe(true);
    expect(hasErrors({ a: { ...createUploadItem('a'), status: 'done' } })).toBe(false);
  });

  it('allDone requires at least one item and all of them done', () => {
    expect(allDone({})).toBe(false);
    expect(allDone({ a: { ...createUploadItem('a'), status: 'done' } })).toBe(true);
    expect(allDone({
      a: { ...createUploadItem('a'), status: 'done' },
      b: { ...createUploadItem('b'), status: 'uploading' },
    })).toBe(false);
  });
});

describe('retry/backoff helpers', () => {
  it('backoffDelayMs grows exponentially and caps at 8000ms', () => {
    expect(backoffDelayMs(1)).toBe(500);
    expect(backoffDelayMs(2)).toBe(1000);
    expect(backoffDelayMs(3)).toBe(2000);
    expect(backoffDelayMs(10)).toBe(8000);
  });

  it('shouldRetry allows retries under the max attempt count only', () => {
    const errored = (attempts: number): UploadItemState => ({ id: 'a', status: 'error', progress: 0, attempts });
    expect(shouldRetry(errored(1))).toBe(true);
    expect(shouldRetry(errored(3))).toBe(false);
    expect(shouldRetry({ ...errored(1), status: 'done' })).toBe(false);
  });
});

describe('runUploadWithRetry', () => {
  it('resolves with the result on first-try success and emits start/success', async () => {
    const events: UploadEvent[] = [];
    const result = await runUploadWithRetry({
      id: 'a',
      upload: async (onProgress) => { onProgress(50); return { ok: true }; },
      onEvent: (e) => events.push(e),
    });
    expect(result).toEqual({ ok: true });
    expect(events.map(e => e.type)).toEqual(['start', 'progress', 'success']);
  });

  it('retries on failure and eventually succeeds, recording each attempt', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const events: UploadEvent[] = [];
    const promise = runUploadWithRetry({
      id: 'a',
      upload: async () => {
        calls += 1;
        if (calls < 2) throw new Error('flaky');
        return 'done!';
      },
      onEvent: (e) => events.push(e),
    });
    // Let the first attempt (which fails) run, then advance the backoff timer.
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result).toBe('done!');
    expect(calls).toBe(2);
    expect(events.filter(e => e.type === 'start')).toHaveLength(2);
    vi.useRealTimers();
  });

  it('gives up after maxAttempts and returns null', async () => {
    vi.useFakeTimers();
    const events: UploadEvent[] = [];
    const promise = runUploadWithRetry({
      id: 'a',
      upload: async () => { throw new Error('always fails'); },
      onEvent: (e) => events.push(e),
      maxAttempts: 2,
    });
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result).toBeNull();
    expect(events.filter(e => e.type === 'failure')).toHaveLength(2);
    vi.useRealTimers();
  });
});
