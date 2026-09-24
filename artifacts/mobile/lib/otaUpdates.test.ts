import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-updates', () => ({ isEnabled: false }));
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() }, Platform: { OS: 'ios' } }));
vi.mock('@/lib/monitoring', () => ({ addMonitoringBreadcrumb: vi.fn() }));

const { FOREGROUND_CHECK_INTERVAL_MS, shouldCheckOnForeground } = await import('./otaUpdates');

describe('foreground update checks', () => {
  const now = 10 * FOREGROUND_CHECK_INTERVAL_MS;

  it('checks when the app comes back after the interval', () => {
    expect(shouldCheckOnForeground('active', now - FOREGROUND_CHECK_INTERVAL_MS, now, false)).toBe(true);
  });

  it('does not check too often, while backgrounded, or while a check is running', () => {
    expect(shouldCheckOnForeground('active', now - 1000, now, false)).toBe(false);
    expect(shouldCheckOnForeground('background', 0, now, false)).toBe(false);
    expect(shouldCheckOnForeground('active', 0, now, true)).toBe(false);
  });
});
