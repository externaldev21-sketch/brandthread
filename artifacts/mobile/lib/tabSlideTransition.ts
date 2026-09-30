/**
 * Instagram/TikTok-style directional slide between root tab screens: the
 * incoming tab slides in from the side of the tab bar it was tapped from,
 * the outgoing one slides out the other way. Shared by the buyer and seller
 * tab layouts (app/(buyer)/_layout.tsx, app/(tabs)/_layout.tsx) so both
 * sides use the exact same duration/easing and can't drift apart.
 *
 * Wired into React Navigation's bottom-tabs via `transitionSpec` +
 * `sceneStyleInterpolator` rather than the 'shift'/'fade' presets, so the
 * slide distance is a full screen width and the easing/duration are exact.
 * `current.progress` is -1/0/1 based on the tapped screen's REGISTRATION
 * index (Tabs.Screen order) relative to the active one — so a layout's
 * screen order must match its tab bar's left-to-right visual order for the
 * direction to read correctly.
 */
import { Animated, Easing } from 'react-native';
import { isIdentityTransform } from '@/lib/animationUtils';

// Exported (not just used locally) so the tab layouts can time their own
// `useSettled` timeout to match exactly — see `forDirectionalSlide`'s
// `settled` param below.
export const SLIDE_DURATION = 280;
export const REDUCED_MOTION_SLIDE_DURATION = 150;
// cubic-bezier(0.2, 0.8, 0.2, 1): ease-out, no bounce/overshoot.
const SLIDE_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

export const SLIDE_TRANSITION_SPEC = {
  animation: 'timing' as const,
  config: { duration: SLIDE_DURATION, easing: SLIDE_EASING },
};

export const REDUCED_MOTION_TRANSITION_SPEC = {
  animation: 'timing' as const,
  config: { duration: REDUCED_MOTION_SLIDE_DURATION, easing: Easing.linear },
};

/**
 * Reads an `Animated.Value`'s current numeric value synchronously. Only
 * used once `settled` (below) is true, at which point every route's
 * progress value is parked at its rest target — 0 for the focused screen,
 * ±1 for an off-screen one (see BottomTabView's `toValue` calc) — and isn't
 * moving, so a synchronous read is accurate. `__getValue` isn't in
 * `Animated.Value`'s public type, but it's the standard way to read a
 * classic-Animated value outside of `interpolate`/a listener.
 */
function currentValue(node: Animated.Value): number {
  const raw = (node as unknown as { __getValue?: () => number }).__getValue?.();
  return typeof raw === 'number' ? raw : 0;
}

/**
 * `settled` is true once the tab layout's own `useSettled` (see
 * app/(tabs)/_layout.tsx / app/(buyer)/_layout.tsx and lib/animationUtils.ts)
 * has determined no tab-switch animation is in flight. While unsettled,
 * this behaves exactly as before: a live `current.progress` interpolation
 * driving `translateX`, unchanged frame-by-frame during the slide. Once
 * settled, every screen's transform is built as a plain (non-Animated)
 * value instead — which lets the focused, on-screen tab (progress === 0,
 * an identity translateX) drop the `transform` key entirely rather than
 * emit `translateX(0)`. On react-native-web, even an identity transform
 * still promotes its node to its own GPU compositing layer, which softens
 * the text inside it if that layer doesn't land on a device-pixel boundary
 * — see lib/animationUtils.ts's `isIdentityTransform`/`useSettled` doc for
 * the full explanation (this is the same fix `PressableScale` applies).
 * Off-screen tabs parked at ±width keep a real, non-identity transform —
 * they were never the bug being fixed here.
 */
export function forDirectionalSlide(width: number, settled = false) {
  return ({ current }: { current: { progress: Animated.Value } }) => {
    if (settled) {
      // The tab layout flips `settled` off a FIXED timer (see
      // app/(tabs)/_layout.tsx / app/(buyer)/_layout.tsx), not a real
      // "animation finished" callback — React Navigation's bottom-tabs
      // doesn't expose one to a plain sceneStyleInterpolator. On a heavier
      // screen (verified live: the seller profile tab, with its video
      // header/avatar/grid) or under CPU load, the JS-driven fallback
      // animation (useNativeDriver isn't supported on web — see the
      // console warning) can still be mid-flight when that timer fires.
      // Reading `current.progress` at that moment and baking it into a
      // permanent, non-animated transform froze the whole screen at
      // whatever fractional position the interpolation had reached —
      // visibly different (and non-deterministic) on every tab switch,
      // and never self-corrected since this branch never re-runs on its
      // own afterward. Rounding to the nearest rest position (-1, 0, or 1)
      // before using it guarantees the frozen snapshot is always a valid
      // end state — fully on-screen or fully off-screen — never a stuck
      // sliver, regardless of how early the timer fired relative to the
      // real animation.
      const restPosition = Math.round(currentValue(current.progress));
      const translateX = restPosition * width;
      const transform = isIdentityTransform([{ translateX }]) ? undefined : [{ translateX }];
      return { sceneStyle: transform ? { transform } : {} };
    }
    return {
      sceneStyle: {
        transform: [{
          translateX: current.progress.interpolate({
            inputRange: [-1, 0, 1],
            outputRange: [-width, 0, width],
          }),
        }],
      },
    };
  };
}

/** Reduced-motion fallback: a plain crossfade, no positional movement at all. */
export function forReducedMotionCrossfade({ current }: { current: { progress: Animated.Value } }) {
  return {
    sceneStyle: {
      opacity: current.progress.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: [0, 1, 0],
      }),
    },
  };
}
