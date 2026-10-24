import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/networkNotice';
import {
  FRIENDLY_FORBIDDEN_MESSAGE,
  FRIENDLY_NETWORK_MESSAGE,
  FRIENDLY_RATE_LIMIT_MESSAGE,
  FRIENDLY_SIGNED_OUT_MESSAGE,
  FRIENDLY_TIMEOUT_MESSAGE,
  friendlyError,
} from '@/lib/friendlyError';

const FALLBACK = 'Could not schedule the live. Try again.';
const apiError = (status: number, message: string, code = 'X') =>
  new ApiError(status, JSON.stringify({ error: { code, message } }));

describe('friendlyError', () => {
  it('replaces 5xx ApiErrors with the caller fallback', () => {
    expect(friendlyError(apiError(500, 'Billing service unavailable.'), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(new ApiError(502, '<html>Bad gateway</html>'), FALLBACK)).toBe(FALLBACK);
  });

  it('replaces raw "API 500: …" Error messages with the fallback', () => {
    expect(friendlyError(new Error('API 500: Internal Server Error'), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(new Error('API 503: {"error":"down"}'), FALLBACK)).toBe(FALLBACK);
  });

  it('keeps specific, human 4xx validation messages', () => {
    expect(friendlyError(apiError(400, 'Title is required.'), FALLBACK)).toBe('Title is required.');
    expect(friendlyError(apiError(409, 'That code is already in use.'), FALLBACK)).toBe('That code is already in use.');
    expect(friendlyError(new Error('API 422: Start time must be in the future.'), FALLBACK)).toBe('Start time must be in the future.');
  });

  it('falls back when a 4xx message is technical, a bare reason phrase, or an error code', () => {
    expect(friendlyError(new ApiError(400, '{"bad":true'), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(new Error('API 404: Not Found'), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(new Error('API 400: VALIDATION_FAILED'), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(new Error('API 400: Cannot read properties of undefined'), FALLBACK)).toBe(FALLBACK);
  });

  it('maps auth, rate-limit and timeout statuses to short copy', () => {
    expect(friendlyError(new Error('API 401: Unauthorized'), FALLBACK)).toBe(FRIENDLY_SIGNED_OUT_MESSAGE);
    expect(friendlyError(new Error('API 403: Forbidden'), FALLBACK)).toBe(FRIENDLY_FORBIDDEN_MESSAGE);
    expect(friendlyError(apiError(403, 'Only hosts can invite co-hosts.'), FALLBACK)).toBe('Only hosts can invite co-hosts.');
    expect(friendlyError(new Error('API 429: Too Many Requests'), FALLBACK)).toBe(FRIENDLY_RATE_LIMIT_MESSAGE);
    expect(friendlyError(new Error('API 504: Gateway Timeout'), FALLBACK)).toBe(FRIENDLY_TIMEOUT_MESSAGE);
  });

  it('maps network failures to a connection message', () => {
    expect(friendlyError(new TypeError('Network request failed'), FALLBACK)).toBe(FRIENDLY_NETWORK_MESSAGE);
    expect(friendlyError(new TypeError('Failed to fetch'), FALLBACK)).toBe(FRIENDLY_NETWORK_MESSAGE);
  });

  it('keeps human non-API errors and falls back for empty or technical ones', () => {
    expect(friendlyError(new Error('Pick at least two designs to stack.'), FALLBACK)).toBe('Pick at least two designs to stack.');
    expect(friendlyError(new Error(''), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(new SyntaxError('Unexpected token < in JSON at position 0'), FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(undefined, FALLBACK)).toBe(FALLBACK);
    expect(friendlyError({ message: 'Code expired.' }, FALLBACK)).toBe('Code expired.');
  });
});
