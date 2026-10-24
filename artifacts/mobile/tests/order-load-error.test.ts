import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyOrderLoadError, isInvalidOrderId, ORDER_LOAD_FALLBACK } from '@/lib/orderLoadError';
import { FRIENDLY_NETWORK_MESSAGE } from '@/lib/friendlyError';
import { ApiError } from '@/lib/networkNotice';

const read = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const UUID = '3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b21';

describe('return request: bad link vs. network error', () => {
  it('a missing or non-UUID id is an invalid link (preview ids allowed)', () => {
    expect(isInvalidOrderId(undefined)).toBe(true);
    expect(isInvalidOrderId('')).toBe(true);
    expect(isInvalidOrderId('undefined')).toBe(true);
    expect(isInvalidOrderId('abc')).toBe(true);
    expect(isInvalidOrderId(UUID)).toBe(false);
    expect(isInvalidOrderId('preview-order-1', true)).toBe(false);
  });

  it('a 404 / 403 is "not found", never the connection message', () => {
    expect(classifyOrderLoadError(new ApiError(404, JSON.stringify({ error: 'Order not found' })))).toEqual({ kind: 'not_found' });
    expect(classifyOrderLoadError(new Error('API 403: Forbidden'))).toEqual({ kind: 'not_found' });
  });

  it('a real network failure says check your connection', () => {
    expect(classifyOrderLoadError(new TypeError('Network request failed'))).toEqual({ kind: 'error', message: FRIENDLY_NETWORK_MESSAGE });
  });

  it('a server error gets the screen fallback, not raw text', () => {
    expect(classifyOrderLoadError(new Error('API 500: Internal Server Error'))).toEqual({ kind: 'error', message: ORDER_LOAD_FALLBACK });
  });

  it('the screen shows the classified message instead of a hard-coded connection line', () => {
    const src = read('app/buyer-return-request.tsx');
    expect(src).toContain('description={loadErrorMessage}');
    expect(src).toContain('This return link isn’t valid');
    expect(src).toContain('We couldn’t find that order');
    expect(src).not.toMatch(/30 \* 24 \* 60 \* 60 \* 1000/);
    expect(src).toContain('openReturnWindow(order)');
  });
});
