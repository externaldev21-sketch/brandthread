import { describe, expect, it } from 'vitest';

import { ApiError } from '../lib/networkNotice';
import { apiErrorCode, apiErrorMessage } from '../lib/freelancer';

describe('freelancer API error presentation', () => {
  it('shows the server message without the "API 4xx:" wire-format prefix', () => {
    const error = new ApiError(409, JSON.stringify({ error: { code: 'FREELANCER_NOT_PAYABLE', message: 'Add a payout method first.' } }));
    expect(apiErrorMessage(error)).toBe('Add a payout method first.');
    expect(apiErrorCode(error)).toBe('FREELANCER_NOT_PAYABLE');
  });

  it('never leaks the audit/e2e fake-API "not seeded" placeholder text', () => {
    const error = new ApiError(404, JSON.stringify({ error: { code: 'NOT_SEEDED', message: 'Not part of the demo data' } }));
    expect(apiErrorMessage(error)).not.toContain('demo data');
    expect(apiErrorMessage(error)).not.toContain('API 404');
  });

  it('never leaks a raw 5xx/network error', () => {
    expect(apiErrorMessage(new ApiError(500, 'stack trace'))).not.toContain('stack trace');
    expect(apiErrorMessage(new Error('boom'))).not.toBe('boom');
  });
});
