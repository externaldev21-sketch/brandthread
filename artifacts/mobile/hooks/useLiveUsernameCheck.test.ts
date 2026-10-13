import { describe, expect, it } from 'vitest';
import { liveUsernameToCheck, LIVE_USERNAME_DEBOUNCE_MS } from './useLiveUsernameCheck';

describe('liveUsernameToCheck', () => {
  it('skips the saved handle, case-insensitively', () => {
    expect(liveUsernameToCheck('Maya', 'maya')).toBeNull();
    expect(liveUsernameToCheck(' maya ', 'maya')).toBeNull();
  });
  it('skips handles that fail the format check', () => {
    expect(liveUsernameToCheck('ma', 'maya')).toBeNull();
    expect(liveUsernameToCheck('', 'maya')).toBeNull();
    expect(liveUsernameToCheck('a'.repeat(31), 'maya')).toBeNull();
  });
  it('returns the lowercased handle to check', () => {
    expect(liveUsernameToCheck('Maya_2', 'maya')).toBe('maya_2');
  });
  it('waits about 400ms after typing', () => {
    expect(LIVE_USERNAME_DEBOUNCE_MS).toBe(400);
  });
});
