import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));

import { shouldPoll, shouldRefreshOnResume } from './useFocusedInterval';

const on = { focused: true, appActive: true, enabled: true };

describe('shouldPoll', () => {
  it('polls only when focused, foregrounded and enabled', () => {
    expect(shouldPoll(on)).toBe(true);
    expect(shouldPoll({ ...on, focused: false })).toBe(false);
    expect(shouldPoll({ ...on, appActive: false })).toBe(false);
    expect(shouldPoll({ ...on, enabled: false })).toBe(false);
  });
});

describe('shouldRefreshOnResume', () => {
  it('refreshes once when the app returns to the foreground on a focused screen', () => {
    expect(shouldRefreshOnResume(false, on)).toBe(true);
  });

  it('does not refresh on plain focus changes or while still blocked', () => {
    expect(shouldRefreshOnResume(true, on)).toBe(false);
    expect(shouldRefreshOnResume(false, { ...on, focused: false })).toBe(false);
    expect(shouldRefreshOnResume(false, { ...on, enabled: false })).toBe(false);
    expect(shouldRefreshOnResume(false, { ...on, appActive: false })).toBe(false);
  });
});
