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

const SLIDE_DURATION = 280;
// cubic-bezier(0.2, 0.8, 0.2, 1): ease-out, no bounce/overshoot.
const SLIDE_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

export const SLIDE_TRANSITION_SPEC = {
  animation: 'timing' as const,
  config: { duration: SLIDE_DURATION, easing: SLIDE_EASING },
};

export const REDUCED_MOTION_TRANSITION_SPEC = {
  animation: 'timing' as const,
  config: { duration: 150, easing: Easing.linear },
};

export function forDirectionalSlide(width: number) {
  return ({ current }: { current: { progress: Animated.Value } }) => ({
    sceneStyle: {
      transform: [{
        translateX: current.progress.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-width, 0, width],
        }),
      }],
    },
  });
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
