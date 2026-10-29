/**
 * Badge count spring (micro-interactions pack 2, item 26, kept subtle).
 *
 * A count badge springs in from 0.6 + fades when it first appears, gives a
 * small 1.08 nudge when the count goes up, and scales/fades out when it
 * clears — instead of popping in and vanishing. The last label stays on
 * screen while the exit plays.
 *
 * Mobbin reference: iOS app-icon / Instagram activity badges — a quick,
 * restrained spring, no bounce-y overshoot.
 *
 * Reanimated; at rest the transform is dropped (identityOrNone) so the
 * badge digit never sits on its own blurred compositing layer on web.
 * Reduce Motion: shows/hides in place.
 */
import { useEffect, useRef, useState } from 'react';
import {
  runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';

import { identityOrNone } from '@/lib/animationUtils';

const IN = { mass: 0.6, stiffness: 420, damping: 26 } as const;
const NUDGE = { mass: 0.5, stiffness: 520, damping: 22 } as const;

export function useBadgeSpring(count: number) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(count > 0 ? count : 0);
  const scale = useSharedValue(count > 0 ? 1 : 0.6);
  const opacity = useSharedValue(count > 0 ? 1 : 0);
  const previous = useRef(count);

  useEffect(() => {
    const was = previous.current;
    previous.current = count;
    if (count > 0) {
      setShown(count);
      if (reduceMotion) { scale.value = 1; opacity.value = 1; return; }
      if (was <= 0) {
        scale.value = 0.6;
        scale.value = withSpring(1, IN);
        opacity.value = withTiming(1, { duration: 120 });
      } else if (count > was) {
        scale.value = withSequence(withSpring(1.08, NUDGE), withSpring(1, IN));
      }
      return;
    }
    if (was <= 0) return;
    if (reduceMotion) { setShown(0); return; }
    scale.value = withTiming(0.6, { duration: 140 });
    opacity.value = withTiming(0, { duration: 140 }, (finished) => {
      if (finished) runOnJS(setShown)(0);
    });
  }, [count, opacity, reduceMotion, scale]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: identityOrNone([{ scale: scale.value }]),
  }));

  return { shown, visible: shown > 0, style };
}
