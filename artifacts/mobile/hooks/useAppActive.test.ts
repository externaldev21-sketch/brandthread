import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));

import { isForegroundState } from './useAppActive';

describe('isForegroundState', () => {
  it('treats only "active" (or unknown) as foreground', () => {
    expect(isForegroundState('active')).toBe(true);
    expect(isForegroundState(null)).toBe(true);
    expect(isForegroundState('background')).toBe(false);
    expect(isForegroundState('inactive')).toBe(false);
  });
});
