import { useCallback, useRef, useState } from 'react';
import { Animated } from 'react-native';

/**
 * Blurry-text prevention helpers for animated transforms.
 *
 * On react-native-web, any non-empty `transform` style — including an
 * "identity" one like `[{ translateY: 0 }]` or `[{ scale: 1 }]` — is still
 * serialized to a CSS `transform: matrix(1,0,0,1,0,0)` (or an equivalent
 * `translate3d(0px, 0px, 0px)`) on the underlying DOM node. That alone
 * forces the browser to promote the node to its own GPU compositing layer.
 * If that layer's box doesn't land exactly on a device-pixel boundary (which
 * is common — RN layout works in dp, not device px, and centered/percentage
 * layouts routinely produce fractional CSS pixel positions), the
 * subpixel-antialiased text painted inside that layer gets resampled onto
 * the pixel grid and looks permanently soft/blurry, even though the
 * animation itself finished and the value is just sitting at rest.
 *
 * A component that animates in with Reanimated's `useAnimatedStyle` can
 * avoid this by never emitting the `transform` key once every entry is back
 * at its identity value — see `identityOrNone`. A component using the
 * classic `Animated` API (whose interpolated output isn't a plain JS number
 * available at render time) can instead track when its entrance animation
 * has *settled* and switch from an `Animated.View`/`Animated.Text` with a
 * transform style to a plain `View`/`Text` with none — see `useSettled`.
 *
 * Both are no-ops in terms of the animation's visual behavior; they only
 * change what's left on the DOM node once the value stops moving.
 */

const EPSILON = 0.01;

type TransformEntry = Record<string, number | string>;

function numericValue(raw: number | string): number {
  if (typeof raw === 'number') return raw;
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** True when every entry in `transform` is at its identity (rest) value. */
export function isIdentityTransform(
  transform: ReadonlyArray<TransformEntry> | undefined,
  epsilon: number = EPSILON,
): boolean {
  if (!transform || transform.length === 0) return true;
  return transform.every((entry) => {
    const [key, raw] = Object.entries(entry)[0] as [string, number | string];
    const value = numericValue(raw);
    if (key.startsWith('translate')) return Math.abs(value) < epsilon;
    if (key.startsWith('scale')) return Math.abs(value - 1) < epsilon;
    if (key.startsWith('rotate') || key.startsWith('skew')) return Math.abs(value) < epsilon;
    return false;
  });
}

/**
 * Use inside a Reanimated `useAnimatedStyle` worklet in place of a bare
 * `transform: [...]`. Returns `undefined` once every entry is at rest, so
 * the resting style has no `transform` key at all instead of an identity
 * matrix:
 *
 *   const style = useAnimatedStyle(() => ({
 *     transform: identityOrNone([{ scale: scale.value }]),
 *   }));
 *
 * Marked `worklet` so it can run on the UI thread inside `useAnimatedStyle`.
 */
export function identityOrNone<T extends ReadonlyArray<TransformEntry>>(
  transform: T,
  epsilon: number = EPSILON,
): T | undefined {
  'worklet';
  return isIdentityTransform(transform, epsilon) ? undefined : transform;
}

/**
 * Rounds a translate distance to the nearest whole device pixel. Call this
 * on a translate value right before it's used in a style so a sheet/card
 * settles on a boundary the browser's subpixel text rasterizer agrees with,
 * rather than an arbitrary fractional CSS pixel (e.g. a centered 358px-wide
 * column at x=15.5). Device-pixel snapping only matters for the web
 * rasterizer, so off-web this returns `value` unchanged.
 */
export function snapToDevicePixel(value: number): number {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  if (typeof window === 'undefined') return value;
  return Math.round(value * dpr) / dpr;
}

/**
 * Runs a classic `Animated` entrance animation (spring/timing/sequence/etc.)
 * and reports back once it has *finished* — i.e. settled at its target
 * value — via `settled`. Callers use this to stop rendering an
 * `Animated.View`/`Animated.Text` (whose style always carries a `transform`
 * key, even at rest) and switch to a plain `View`/`Text` once `settled` is
 * true:
 *
 *   const [translateY] = useState(() => new Animated.Value(distance));
 *   const settled = useSettled();
 *   useEffect(() => {
 *     settled.run(Animated.spring(translateY, { toValue: 0, ... }));
 *   }, []);
 *   ...
 *   <Animated.View style={[style, !settled.value && { transform: [{ translateY }] }]}>
 *
 * `run` also flips `settled` back to `false` for the duration of a new
 * animation (e.g. re-opening a sheet that was reset to its starting value),
 * so the transform reappears while it's actually moving.
 */
export function useSettled(initial = false) {
  const [value, setValue] = useState(initial);
  const runId = useRef(0);

  const run = useCallback((animation: Animated.CompositeAnimation) => {
    const id = (runId.current += 1);
    setValue(false);
    animation.start(({ finished }) => {
      // Ignore a stale callback from an animation a newer `run()` superseded.
      if (finished && runId.current === id) setValue(true);
    });
  }, []);

  const settleImmediately = useCallback(() => {
    runId.current += 1;
    setValue(true);
  }, []);

  /** Marks the value as unsettled without starting an animation — e.g. while
   *  the user is actively dragging a value via a gesture responder. */
  const unsettle = useCallback(() => {
    runId.current += 1;
    setValue(false);
  }, []);

  return { value, run, settleImmediately, unsettle };
}
