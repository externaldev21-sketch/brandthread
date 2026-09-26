/**
 * Test-only shim for `react-native-reanimated`, aliased in vitest.config.ts.
 *
 * The real package (v4.5.1) fails to resolve under Vitest/Node's ESM
 * resolver in this environment ("Directory import '.../ReanimatedModule' is
 * not supported"), unrelated to any app code — any test that transitively
 * imports it (e.g. via `components/ui/BottomSheet.tsx` or
 * `components/ShopProductSheet.tsx`) hits this. Individual suites that
 * already exercise sheet/gesture motion in detail keep their own
 * `vi.mock('react-native-reanimated', ...)`, which still takes precedence
 * over this alias; this shim only covers suites that import a sheet
 * incidentally and never mocked reanimated themselves.
 */
import React from 'react';

type SharedValue<T> = { value: T; get: () => T; set: (v: T | ((v: T) => T)) => void };

export function useSharedValue<T>(initial: T): SharedValue<T> {
  const ref = React.useRef<{ value: T }>({ value: initial });
  return {
    get value() { return ref.current.value; },
    set value(v: T) { ref.current.value = v; },
    get: () => ref.current.value,
    set: (v: T | ((v: T) => T)) => {
      ref.current.value = typeof v === 'function' ? (v as (v: T) => T)(ref.current.value) : v;
    },
  };
}

export function useAnimatedStyle<T>(fn: () => T): T {
  return fn();
}

export function useAnimatedReaction() {
  // no-op in tests
}

function identity(v: unknown) { return v; }
export const withTiming = (toValue: unknown, _config?: unknown, callback?: (finished: boolean) => void) => {
  callback?.(true);
  return toValue;
};
export const withSpring = (toValue: unknown, _config?: unknown, callback?: (finished: boolean) => void) => {
  callback?.(true);
  return toValue;
};
export const runOnJS = <T extends (...args: never[]) => unknown>(fn: T) => fn;
export const runOnUI = <T extends (...args: never[]) => unknown>(fn: T) => fn;
export const cancelAnimation = () => undefined;

export const Easing = {
  out: identity,
  in: identity,
  inOut: identity,
  cubic: (t: number) => t,
  linear: (t: number) => t,
  ease: (t: number) => t,
  // PR #132 (shop sheet spring fix) added a module-scope
  // `Easing.bezier(...)` call in constants/motion.ts, which many otherwise
  // unrelated suites hit transitively (e.g. via components/ui/Button.tsx).
  // The exact curve shape is never asserted in tests, so an identity
  // function is enough — this only needs to exist and be callable.
  bezier: (..._points: number[]) => (t: number) => t,
};

function makeComponent(name: string) {
  return React.forwardRef<unknown, Record<string, unknown>>((props, ref) =>
    React.createElement(name, { ...props, ref }, props.children as React.ReactNode));
}

const Animated = {
  View: makeComponent('Animated.View'),
  Text: makeComponent('Animated.Text'),
  Image: makeComponent('Animated.Image'),
  ScrollView: makeComponent('Animated.ScrollView'),
  createAnimatedComponent: (Component: unknown) => Component,
};

export default Animated;
