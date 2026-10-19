import { describe, expect, it } from 'vitest';
import { queryClient } from '../queryClient';

describe('query retries never loop on authentication failures', () => {
  const retry = queryClient.getDefaultOptions().queries!.retry as (count: number, error: Error) => boolean;
  it.each([400, 401, 403, 404, 409, 422, 429, 500])('does not retry HTTP %s', status => {
    expect(retry(0, Object.assign(new Error('HTTP failure'), { status }))).toBe(false);
  });
  it.each([408, 502, 503, 504])('allows only one transient HTTP %s retry', status => {
    const error = Object.assign(new Error('temporary'), { status });
    expect(retry(0, error)).toBe(true);
    expect(retry(1, error)).toBe(false);
  });
});
