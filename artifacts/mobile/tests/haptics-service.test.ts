/**
 * lib/haptics.ts — the one haptics service. Covers the named-event map, the
 * Settings switch, the one-haptic-per-action rule, web silence, and that raw
 * `expo-haptics` imports in the app are routed through the same gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const platform = vi.hoisted(() => ({ OS: 'ios' as string }));
const native = vi.hoisted(() => ({
  impactAsync: vi.fn((_style?: string) => Promise.resolve()),
  notificationAsync: vi.fn((_type?: string) => Promise.resolve()),
  selectionAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-haptics', () => ({
  ...native,
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import {
  ACTION_WINDOW_MS, HAPTIC_MAP, haptic, haptics, hapticFollow, hapticLight, isHapticsEnabled,
  resetHapticsForTests, setHapticsEnabled,
} from '@/lib/haptics';
import * as shim from '@/shims/expo-haptics';

function played() {
  return [
    ...native.impactAsync.mock.calls.map(([s]) => `impact:${s}`),
    ...native.notificationAsync.mock.calls.map(([t]) => `notification:${t}`),
    ...native.selectionAsync.mock.calls.map(() => 'selection'),
  ];
}

let now = 10_000;

beforeEach(() => {
  platform.OS = 'ios';
  now += 10_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  native.impactAsync.mockClear();
  native.notificationAsync.mockClear();
  native.selectionAsync.mockClear();
  resetHapticsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the map Dev approved', () => {
  it.each([
    ['follow', 'impact:light'],
    ['like', 'impact:light'],
    ['save', 'impact:light'],
    ['addToBag', 'impact:light'],
    ['select', 'selection'],
    ['tabChange', 'selection'],
    ['sheet', 'impact:soft'],
    ['refresh', 'impact:soft'],
    ['longPress', 'impact:soft'],
    ['purchaseSuccess', 'notification:success'],
    ['postPublished', 'notification:success'],
    ['productListed', 'notification:success'],
    ['orderShipped', 'notification:success'],
    ['newOrder', 'notification:success'],
    ['error', 'notification:error'],
  ] as const)('%s plays %s', (event, expected) => {
    haptic(event);
    expect(played()).toEqual([expected]);
  });

  it('exposes one function per event', () => {
    expect(Object.keys(haptics).sort()).toEqual([
      ...Object.keys(HAPTIC_MAP), 'selection', 'light', 'success', 'warning', 'rigid',
    ].sort());
    haptics.purchaseSuccess();
    expect(played()).toEqual(['notification:success']);
  });

  it('Follow is one light impact; Unfollow a selection tick', () => {
    hapticFollow(true);
    expect(played()).toEqual(['impact:light']);
    now += 1_000;
    hapticFollow(false);
    expect(played()).toEqual(['impact:light', 'selection']);
  });
});

describe('Settings switch', () => {
  it('is on by default', () => {
    expect(isHapticsEnabled()).toBe(true);
  });

  it('off silences named events, legacy helpers and raw expo-haptics calls', async () => {
    setHapticsEnabled(false);
    haptic('like');
    hapticLight();
    await shim.impactAsync('light' as never);
    await shim.notificationAsync('success' as never);
    await shim.selectionAsync();
    expect(played()).toEqual([]);
  });

  it('back on plays again', () => {
    setHapticsEnabled(false);
    setHapticsEnabled(true);
    haptic('like');
    expect(played()).toEqual(['impact:light']);
  });
});

describe('max one haptic per user action', () => {
  it('drops a second haptic inside the same action (tap + sheet + optimistic success)', () => {
    haptic('addToBag');
    now += 30;
    haptic('sheet');
    now += 60;
    hapticFollow(true);
    expect(played()).toEqual(['impact:light']);
  });

  it('plays again for the next action', () => {
    haptic('like');
    now += ACTION_WINDOW_MS;
    haptic('like');
    expect(played()).toEqual(['impact:light', 'impact:light']);
  });

  it('lets picker detents tick in quick succession', () => {
    haptic('select');
    now += 50;
    haptic('select');
    now += 50;
    haptic('select');
    expect(played()).toEqual(['selection', 'selection', 'selection']);
  });

  it('applies to raw expo-haptics calls too', async () => {
    await shim.impactAsync('light' as never);
    await shim.notificationAsync('success' as never);
    expect(played()).toEqual(['impact:light']);
  });
});

describe('platform safety', () => {
  it('is silent on web', () => {
    platform.OS = 'web';
    haptic('purchaseSuccess');
    hapticLight();
    expect(played()).toEqual([]);
  });

  it('never throws or rejects when the native module fails', async () => {
    native.impactAsync.mockImplementationOnce(() => Promise.reject(new Error('unsupported')));
    await expect(shim.impactAsync('light' as never)).resolves.toBeUndefined();
    now += 1_000;
    native.selectionAsync.mockImplementationOnce(() => { throw new Error('missing'); });
    expect(() => haptic('select')).not.toThrow();
  });

  it('the raw shim maps styles to the same kinds', async () => {
    await shim.impactAsync('soft' as never);
    now += 1_000;
    await shim.notificationAsync('error' as never);
    expect(played()).toEqual(['impact:soft', 'notification:error']);
  });
});

describe('metro routes raw expo-haptics imports through the gate', () => {
  const ROOT = resolve(__dirname, '..');
  const SHIM = resolve(ROOT, 'shims/expo-haptics.ts');
  const SERVICE = resolve(ROOT, 'lib/haptics.ts');

  function loadResolver() {
    const require = createRequire(resolve(ROOT, 'metro.config.js'));
    // Stub Sentry's wrapper so this reads only our resolver.
    const sentryPath = require.resolve('@sentry/react-native/metro');
    require.cache[sentryPath] = {
      id: sentryPath, filename: sentryPath, loaded: true,
      exports: { getSentryExpoConfig: () => ({ resolver: {}, transformer: {} }) },
    } as never;
    const configPath = require.resolve('./metro.config.js');
    delete require.cache[configPath];
    return require(configPath).resolver.resolveRequest as (
      ctx: { originModulePath: string; resolveRequest: () => unknown }, name: string, platform: string,
    ) => unknown;
  }

  it('app files get the shim; the service and the shim get the real module', () => {
    const resolveRequest = loadResolver();
    const passthrough = { filePath: 'real', type: 'sourceFile' };
    const ctx = (origin: string) => ({ originModulePath: origin, resolveRequest: () => passthrough });

    expect(resolveRequest(ctx(resolve(ROOT, 'app/buyer-checkout.tsx')), 'expo-haptics', 'ios'))
      .toEqual({ filePath: SHIM, type: 'sourceFile' });
    expect(resolveRequest(ctx(SERVICE), 'expo-haptics', 'ios')).toBe(passthrough);
    expect(resolveRequest(ctx(SHIM), 'expo-haptics', 'ios')).toBe(passthrough);
  });
});
