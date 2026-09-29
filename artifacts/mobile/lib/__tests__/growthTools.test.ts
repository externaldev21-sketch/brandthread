/**
 * Regression guard for the Growth-plan enforcement bypass: the flag must
 * default to ENFORCING (true) and only flip off in a dev build or with an
 * explicit opt-in env var — never a silent hardcoded `false` that ships to
 * production (that was the actual bug: GROWTH_PLAN_ENFORCEMENT_ENABLED was
 * hardcoded `false` for "temporary testing" and never restored).
 *
 * __DEV__ is stubbed `false` globally by vitest.config.ts, matching a real
 * production bundle, so these tests exercise the same code path a shipped
 * app runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('GROWTH_PLAN_ENFORCEMENT_ENABLED', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to enforcing (true) with no bypass env var set', async () => {
    vi.stubEnv('EXPO_PUBLIC_BT_GROWTH_BYPASS', '');
    vi.resetModules();
    const { GROWTH_PLAN_ENFORCEMENT_ENABLED } = await import('../growthTools');
    expect(GROWTH_PLAN_ENFORCEMENT_ENABLED).toBe(true);
  });

  it('only bypasses with the exact opt-in value "1"', async () => {
    vi.stubEnv('EXPO_PUBLIC_BT_GROWTH_BYPASS', 'true');
    vi.resetModules();
    const { GROWTH_PLAN_ENFORCEMENT_ENABLED } = await import('../growthTools');
    expect(GROWTH_PLAN_ENFORCEMENT_ENABLED).toBe(true); // "true" is not "1" — still enforced
  });

  it('bypasses only when EXPO_PUBLIC_BT_GROWTH_BYPASS=1', async () => {
    vi.stubEnv('EXPO_PUBLIC_BT_GROWTH_BYPASS', '1');
    vi.resetModules();
    const { GROWTH_PLAN_ENFORCEMENT_ENABLED } = await import('../growthTools');
    expect(GROWTH_PLAN_ENFORCEMENT_ENABLED).toBe(false);
  });
});

/**
 * Static guard against the bypass env var ever being committed to a
 * production-reachable config file in this repo (app.config.js, eas.json).
 * EAS's own dashboard-managed env groups are outside this repo and can't be
 * inspected here, but nothing checked in should set this for any profile.
 */
describe('production config never sets the Growth bypass', () => {
  it('app.config.js does not hardcode EXPO_PUBLIC_BT_GROWTH_BYPASS', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../../app.config.js'), 'utf8');
    expect(source).not.toMatch(/EXPO_PUBLIC_BT_GROWTH_BYPASS/);
  });

  it('eas.json does not set EXPO_PUBLIC_BT_GROWTH_BYPASS for any build profile', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../../eas.json'), 'utf8');
    expect(source).not.toMatch(/EXPO_PUBLIC_BT_GROWTH_BYPASS/);
  });
});
