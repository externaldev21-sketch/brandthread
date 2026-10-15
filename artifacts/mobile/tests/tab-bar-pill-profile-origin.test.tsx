/**
 * Buyer tab bar pill — regression test for "going from Profile back to a tab,
 * the bubble swipes in from the far left instead of from the Profile circle".
 *
 * Root cause: Profile isn't one of the capsule's pill slots, so on Profile
 * `useTabBarActiveIndex` got activeIndex -1 and clamped its resting position
 * to slot 0 — while faded out, the pill quietly glided back to Home. The next
 * press then sprang it from Home (far left) to the target tab. It also left
 * `target` at 0, which kept the capsule compact on Profile when arriving
 * from Home.
 *
 * Fix: the buyer bar passes a `parkedAt` position (the Profile circle's
 * center, in the pill's own slot units) and the pill rests there while
 * Profile is active, so every move out of Profile starts at the circle.
 *
 * Reanimated is mocked so every `withSpring` records where the pill was when
 * the spring started (`from`) and where it's heading (`to`).
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Spring = { __spring: true; to: number };
const springs: { from: number; to: number }[] = [];

vi.mock('react-native-reanimated', () => {
  const React = require('react') as typeof import('react');
  const useSharedValue = <T,>(initial: T) => {
    const ref = React.useRef<{ v: T } | null>(null);
    if (ref.current === null) ref.current = { v: initial };
    const box = ref.current;
    return React.useMemo(() => ({
      get value() { return box.v; },
      get: () => box.v,
      set: (next: T | Spring) => {
        if (next && typeof next === 'object' && (next as Spring).__spring) {
          springs.push({ from: box.v as unknown as number, to: (next as Spring).to });
          box.v = (next as Spring).to as unknown as T;
        } else {
          box.v = next as T;
        }
      },
    }), [box]);
  };
  const passthrough = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return {
    __esModule: true,
    default: { View: passthrough('Animated.View'), createAnimatedComponent: (c: unknown) => c },
    useSharedValue,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useAnimatedReaction: () => undefined,
    useReducedMotion: () => false,
    withSpring: (to: number): Spring => ({ __spring: true, to }),
    withTiming: (to: number) => to,
    withSequence: (...steps: unknown[]) => steps[steps.length - 1],
    interpolate: () => 0,
    Easing: { bezier: () => (t: number) => t },
    Extrapolation: { CLAMP: 'clamp' },
  };
});

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
  return {
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {} },
    View: el('View'),
    Text: el('Text'),
    Pressable: el('Pressable'),
    Platform: { OS: 'ios', select: (spec: Record<string, unknown>) => spec.ios ?? spec.default },
  };
});
vi.mock('expo-blur', () => ({ BlurView: () => null }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('@/components/ui/Glass', () => ({ Glass: () => null }));
vi.mock('@/components/buyer-nav/BuyerNavIcon', () => ({ BuyerNavIcon: () => null }));
vi.mock('@/lib/theme', () => ({ FONT: {} }));

import { useTabBarActiveIndex } from '@/components/tab-bar/TabBarParts';

// Any value past the last slot (3) — the real one comes from the bar's
// metrics (see BuyerTabBar's profileParkIndex).
const PROFILE = 4.6;
const PROFILE_SLOT = -1;
const ACTIVITY = 3;

type Hook = ReturnType<typeof useTabBarActiveIndex>;
let latest: Hook;
function Harness({ activeIndex, parkedAt }: { activeIndex: number; parkedAt?: number }) {
  latest = useTabBarActiveIndex(activeIndex, false, parkedAt);
  return null;
}

let renderer: ReactTestRenderer | null = null;
function mount(activeIndex: number, parkedAt?: number) {
  act(() => { renderer = create(<Harness activeIndex={activeIndex} parkedAt={parkedAt} />); });
}
function commit(activeIndex: number, parkedAt?: number) {
  act(() => { renderer!.update(<Harness activeIndex={activeIndex} parkedAt={parkedAt} />); });
}

beforeEach(() => { springs.length = 0; });
afterEach(() => { act(() => renderer?.unmount()); renderer = null; });

describe('buyer pill: Profile circle as the pill origin', () => {
  it('Profile -> Activity glides from the Profile circle, not from Home', () => {
    mount(0, PROFILE);
    // Home -> Profile (press, then the navigation commits).
    act(() => latest.hide());
    commit(PROFILE_SLOT, PROFILE);
    expect(latest.x.value).toBe(PROFILE);
    expect(latest.target.value).toBe(PROFILE);

    springs.length = 0;
    act(() => latest.press(ACTIVITY));
    commit(ACTIVITY, PROFILE);
    expect(springs).toEqual([{ from: PROFILE, to: ACTIVITY }]);
  });

  it('every tab -> Profile -> every tab starts at the circle', () => {
    for (const start of [0, 1, 2, 3]) {
      for (const dest of [0, 1, 2, 3]) {
        mount(start, PROFILE);
        act(() => latest.hide());
        commit(PROFILE_SLOT, PROFILE);
        springs.length = 0;
        act(() => latest.press(dest));
        commit(dest, PROFILE);
        expect(springs, `${start} -> profile -> ${dest}`).toEqual([{ from: PROFILE, to: dest }]);
        act(() => renderer!.unmount());
        renderer = null;
      }
    }
  });

  it('tab -> Profile glides onto the circle and drives target there (capsule stays regular)', () => {
    mount(2, PROFILE);
    act(() => latest.hide());
    expect(springs).toEqual([{ from: 2, to: PROFILE }]);
    expect(latest.target.value).toBe(PROFILE);
    expect(latest.opacity.value).toBe(0);
  });

  it('first launch on Profile parks the pill on the circle', () => {
    mount(PROFILE_SLOT, PROFILE);
    expect(latest.x.value).toBe(PROFILE);
    expect(latest.opacity.value).toBe(0);
    act(() => latest.press(ACTIVITY));
    expect(springs).toEqual([{ from: PROFILE, to: ACTIVITY }]);
  });

  it('back navigation / deep link (no press) in and out of Profile also uses the circle', () => {
    mount(1, PROFILE);
    commit(PROFILE_SLOT, PROFILE);
    expect(springs).toEqual([{ from: 1, to: PROFILE }]);
    springs.length = 0;
    commit(ACTIVITY, PROFILE);
    expect(springs).toEqual([{ from: PROFILE, to: ACTIVITY }]);
    expect(latest.opacity.value).toBe(1);
  });

  it('a press mid-glide starts from wherever the pill currently is', () => {
    mount(0, PROFILE);
    act(() => latest.hide());
    // Pretend the spring is mid-flight between Home and the circle.
    act(() => latest.x.set(2.3));
    springs.length = 0;
    act(() => latest.press(1));
    expect(springs).toEqual([{ from: 2.3, to: 1 }]);
  });

  it('without a park (seller bar, buyer search) behaves exactly as before', () => {
    mount(2);
    act(() => latest.hide());
    expect(springs).toEqual([]);
    expect(latest.opacity.value).toBe(0);
    commit(PROFILE_SLOT);
    // Unchanged legacy behavior: rests on slot 0 while hidden.
    expect(latest.x.value).toBe(0);
    expect(springs).toEqual([{ from: 2, to: 0 }]);
  });
});
