import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-updates', () => ({ isEnabled: false }));
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() }, Platform: { OS: 'ios' } }));
vi.mock('@/lib/monitoring', () => ({ addMonitoringBreadcrumb: vi.fn() }));
vi.mock('@/lib/appConfig', () => ({ loadAppConfig: vi.fn(async () => null) }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: vi.fn(() => true) }));

const {
  CRITICAL_RELOAD_MIN_BACKGROUND_MS,
  FOREGROUND_CHECK_INTERVAL_MS,
  isCriticalUpdate,
  shouldCheckOnForeground,
  shouldReloadForCritical,
} = await import('./otaUpdates');

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

describe('critical updates', () => {
  it('is critical when the server lists the update id', () => {
    expect(isCriticalUpdate({ id: 'abc-123' }, ['abc-123'])).toBe(true);
    expect(isCriticalUpdate({ id: 'abc-123' }, ['other'])).toBe(false);
  });

  it('is critical when the update app config says so', () => {
    expect(isCriticalUpdate({ id: 'x', extra: { expoClient: { extra: { critical: true } } } }, [])).toBe(true);
    expect(isCriticalUpdate({ id: 'x', extra: { critical: true } }, [])).toBe(true);
    expect(isCriticalUpdate({ id: 'x', extra: { expoClient: { extra: { critical: 'true' } } } }, [])).toBe(false);
  });

  it('ignores missing manifests', () => {
    expect(isCriticalUpdate(undefined, ['x'])).toBe(false);
    expect(isCriticalUpdate(null, [])).toBe(false);
  });

  it('reloads only on return from a long enough stay in the background', () => {
    const now = 100 * CRITICAL_RELOAD_MIN_BACKGROUND_MS;
    const longAgo = now - CRITICAL_RELOAD_MIN_BACKGROUND_MS;
    expect(shouldReloadForCritical('active', true, longAgo, now)).toBe(true);
    expect(shouldReloadForCritical('active', true, now - 1000, now)).toBe(false);
    expect(shouldReloadForCritical('active', false, longAgo, now)).toBe(false);
    expect(shouldReloadForCritical('active', true, null, now)).toBe(false);
    expect(shouldReloadForCritical('inactive', true, longAgo, now)).toBe(false);
  });
});
