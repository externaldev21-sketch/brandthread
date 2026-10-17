/**
 * useHoldToSwitch press handling (components/tab-bar/HoldRing.tsx): a quick
 * tap opens Profile, letting go before the ring closes cancels (no tap, no
 * switch, ring retracts), and a closed ring switches exactly once without
 * also opening Profile on release.
 *
 * Reanimated is mocked so the ring's draw never finishes on its own; the
 * test closes it by calling the withTiming completion callback the hook
 * registered, the way the UI thread would.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let ringDone: ((finished: boolean) => void) | null = null;
const ringValues: number[] = [];

vi.mock('react-native-reanimated', () => {
  const React = require('react') as typeof import('react');
  return {
    __esModule: true,
    default: { View: 'Animated.View', createAnimatedComponent: (c: unknown) => c },
    Easing: { linear: (t: number) => t, out: (f: unknown) => f, quad: (t: number) => t },
    cancelAnimation: () => undefined,
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    useAnimatedProps: (fn: () => unknown) => fn(),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useSharedValue: (initial: number) => {
      const ref = React.useRef({ value: initial });
      return React.useMemo(() => ({
        get value() { return ref.current.value; },
        get: () => ref.current.value,
        set: (next: number) => { ref.current.value = next; ringValues.push(next); },
      }), []);
    },
    withDelay: (_ms: number, animation: number) => animation,
    withTiming: (to: number, _config: unknown, callback?: (finished: boolean) => void) => {
      if (callback) ringDone = callback;
      return to;
    },
  };
});
vi.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Path: 'Path' }));
vi.mock('react-native', () => ({ StyleSheet: { create: (s: unknown) => s } }));
const haptics = { light: 0, success: 0 };
vi.mock('@/lib/haptics', () => ({
  hapticLight: () => { haptics.light += 1; },
  hapticSuccess: () => { haptics.success += 1; },
}));

import { useHoldToSwitch } from '@/components/tab-bar/useHoldToSwitch';
import { HOLD_RING_DELAY_MS, HOLD_SWITCH_MS, HOLD_TAP_MAX_MS } from '@/lib/holdToSwitch';

type Hold = ReturnType<typeof useHoldToSwitch>;

function setup() {
  const calls = { tap: 0, complete: 0, holdRelease: 0 };
  let hold: Hold | null = null;
  function Probe() {
    hold = useHoldToSwitch({
      onComplete: () => { calls.complete += 1; },
      onHoldRelease: () => { calls.holdRelease += 1; },
    });
    return null;
  }
  act(() => { create(<Probe />); });
  return { calls, hold: () => hold! };
}

describe('useHoldToSwitch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    ringDone = null;
    ringValues.length = 0;
    haptics.light = 0;
    haptics.success = 0;
  });
  afterEach(() => { vi.useRealTimers(); });

  it('a quick tap opens Profile, with no ring haptic and no switch', () => {
    const { calls, hold } = setup();
    act(() => { hold().onPressIn(); });
    act(() => { vi.advanceTimersByTime(HOLD_TAP_MAX_MS - 20); });
    act(() => { hold().onPressOut(); if (hold().releasedAsTap()) calls.tap += 1; });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(calls).toEqual({ tap: 1, complete: 0, holdRelease: 0 });
    expect(haptics.light).toBe(0);
  });

  it('releasing early cancels: no tap, no switch, the ring goes back to 0', () => {
    const { calls, hold } = setup();
    act(() => { hold().onPressIn(); });
    act(() => { vi.advanceTimersByTime(HOLD_TAP_MAX_MS + 120); });
    expect(haptics.light).toBe(1); // the ring started drawing
    act(() => { hold().onPressOut(); if (hold().releasedAsTap()) calls.tap += 1; });
    expect(calls).toEqual({ tap: 0, complete: 0, holdRelease: 1 });
    expect(ringValues.at(-1)).toBe(0);
    // A late completion callback from the cancelled draw (finished=false) does nothing.
    act(() => { ringDone?.(false); });
    expect(calls.complete).toBe(0);
  });

  it('a closed ring switches once, with a success haptic, and the release does not open Profile', () => {
    const { calls, hold } = setup();
    act(() => { hold().onPressIn(); });
    act(() => { vi.advanceTimersByTime(HOLD_SWITCH_MS); });
    act(() => { ringDone?.(true); });
    expect(calls.complete).toBe(1);
    expect(haptics.success).toBe(1);
    act(() => { ringDone?.(true); }); // a duplicate completion is ignored
    act(() => { hold().onPressOut(); if (hold().releasedAsTap()) calls.tap += 1; });
    expect(calls).toEqual({ tap: 0, complete: 1, holdRelease: 1 });
  });

  it('the start haptic waits for the ring to start, not touch-down', () => {
    const { hold } = setup();
    act(() => { hold().onPressIn(); });
    act(() => { vi.advanceTimersByTime(HOLD_RING_DELAY_MS - 1); });
    expect(haptics.light).toBe(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(haptics.light).toBe(1);
  });
});
