import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  classifyNetworkError,
  dismissNetworkNotice,
  getNetworkNotice,
  reportNetworkError,
} from '@/lib/networkNotice';

describe('network notice lifecycle', () => {
  afterEach(() => {
    dismissNetworkNotice();
    vi.useRealTimers();
  });

  it('does not present rate limiting as an offline or server outage', () => {
    expect(classifyNetworkError(new ApiError(429, 'Too many requests'))).toBeNull();
  });

  it('does not present unrelated programming TypeErrors as offline', () => {
    expect(classifyNetworkError(new TypeError('Cannot read properties of undefined'))).toBeNull();
  });

  it('expires a transient connectivity notice', () => {
    vi.useFakeTimers();
    reportNetworkError(new TypeError('Failed to fetch'));

    expect(getNetworkNotice()?.kind).toBe('offline');
    vi.advanceTimersByTime(10_000);
    expect(getNetworkNotice()).toBeNull();
  });
});