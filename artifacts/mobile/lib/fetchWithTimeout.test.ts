import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './networkNotice';
import { fetchWithTimeout } from './fetchWithTimeout';

function hangingFetch() {
  return vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    });
  }));
}

describe('fetchWithTimeout', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('turns a hung request into ApiError(408) at the deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const pending = fetchWithTimeout('https://x.test', {}, 1000);
    const assertion = expect(pending).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it('still honours the caller\'s own abort, and does not report it as a timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    const pending = fetchWithTimeout('https://x.test', { signal: controller.signal }, 60_000);
    controller.abort();
    const error = await pending.catch((e) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.name).toBe('AbortError');
  });

  it('passes a normal response through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const res = await fetchWithTimeout('https://x.test', {}, 1000);
    expect(res.status).toBe(200);
  });
});
