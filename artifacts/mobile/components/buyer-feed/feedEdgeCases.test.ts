import { describe, expect, it } from 'vitest';
import { isGuestFollowing } from './guestFollowing';
import { captionNeedsMore } from './captionLayout';

describe('feed edge cases', () => {
  it('guest Following never hits the protected feed', () => {
    expect(isGuestFollowing('following', null)).toBe(true);
    expect(isGuestFollowing('following', undefined)).toBe(true);
    expect(isGuestFollowing('following', 'user_1')).toBe(false);
    expect(isGuestFollowing('for-you', null)).toBe(false);
  });
  it('long caption fixture gets more/less toggle; short does not', () => {
    const long = 'A deliberately long caption fixture verifies the two-line preview and the separate expansion control without changing any real post or creator content.';
    expect(captionNeedsMore(long)).toBe(true);
    expect(captionNeedsMore('stay silent')).toBe(false);
  });
});
