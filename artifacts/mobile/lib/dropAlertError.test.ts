import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));

import { ApiError } from './networkNotice';
import { dropAlertErrorCopy } from './dropAlertError';

describe('dropAlertErrorCopy', () => {
  it('asks to sign in only on 401', () => {
    expect(dropAlertErrorCopy(new ApiError(401, JSON.stringify({ error: 'Unauthorized' }))).title)
      .toBe('Sign in to get drop alerts');
  });

  it('shows the real server error otherwise', () => {
    const copy = dropAlertErrorCopy(new ApiError(409, JSON.stringify({ error: 'This drop has already ended' })));
    expect(copy.title).not.toMatch(/Sign in/);
    expect(copy.message).toContain('already ended');
  });

  it('uses a network message for 5xx and non-HTTP errors', () => {
    expect(dropAlertErrorCopy(new ApiError(500, 'boom')).message).toBe('Check your connection and try again.');
    const net = dropAlertErrorCopy(new TypeError('Network request failed'));
    expect(net.title).not.toMatch(/Sign in/);
    expect(net.message).toBe('Check your connection and try again.');
  });
});
