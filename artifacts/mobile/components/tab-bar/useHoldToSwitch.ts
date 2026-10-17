/**
 * Press handling for the tab bar's hold-to-switch Profile button — the ring
 * itself is components/tab-bar/HoldRing.tsx, the timing rules
 * lib/holdToSwitch.ts. Kept in its own module so TabBarParts (which only
 * draws the ring) doesn't pull in haptics.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  Easing,
  cancelAnimation,
  runOnJS,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import type { HoldToSwitch } from '@/components/tab-bar/HoldRing';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import {
  HOLD_RING_DELAY_MS, HOLD_RING_DRAW_MS, HOLD_RING_RETRACT_MS, holdOutcome, type HoldOutcome,
} from '@/lib/holdToSwitch';

/**
 * Press handling for a hold-to-switch button: pass the result as the `hold`
 * prop of TabBarSlot/TabBarCircle, which layer it onto their own press
 * handling, draw the ring, and only run their normal `onPress` when the
 * release was a plain tap. Give that button no `onLongPress` — it would
 * swallow the tap. `onComplete` runs once the ring closes.
 */
export function useHoldToSwitch({ onComplete, onHoldRelease, enabled = true }: {
  onComplete: () => void;
  /** A release that wasn't a tap (cancelled or switched) — e.g. to undo
   *  anything the button did eagerly on touch-down. */
  onHoldRelease?: () => void;
  enabled?: boolean;
}): HoldToSwitch {
  const progress = useSharedValue(0);
  const pressedAt = useRef(0);
  const completed = useRef(false);
  const outcome = useRef<HoldOutcome>('tap');
  const startHaptic = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ onComplete, onHoldRelease });
  latest.current = { onComplete, onHoldRelease };

  useEffect(() => () => {
    if (startHaptic.current) clearTimeout(startHaptic.current);
  }, []);

  const complete = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    hapticSuccess();
    latest.current.onComplete();
  }, []);

  const onPressIn = useCallback(() => {
    pressedAt.current = Date.now();
    completed.current = false;
    outcome.current = 'tap';
    if (!enabled) return;
    cancelAnimation(progress);
    progress.set(0);
    progress.set(withDelay(
      HOLD_RING_DELAY_MS,
      withTiming(1, { duration: HOLD_RING_DRAW_MS, easing: Easing.linear }, (finished) => {
        if (finished) runOnJS(complete)();
      }),
    ));
    // Light tick when the ring starts drawing — not on touch-down, so a
    // plain tap keeps the bar's own tab-change haptic only.
    if (startHaptic.current) clearTimeout(startHaptic.current);
    startHaptic.current = setTimeout(() => { startHaptic.current = null; hapticLight(); }, HOLD_RING_DELAY_MS);
  }, [enabled, progress, complete]);

  const onPressOut = useCallback(() => {
    if (startHaptic.current) {
      clearTimeout(startHaptic.current);
      startHaptic.current = null;
    }
    outcome.current = enabled ? holdOutcome(Date.now() - pressedAt.current, completed.current) : 'tap';
    if (outcome.current !== 'tap') latest.current.onHoldRelease?.();
    if (completed.current) {
      // Let the closed ring linger a beat, then fade it back out.
      progress.set(withDelay(160, withTiming(0, { duration: 220 })));
      return;
    }
    cancelAnimation(progress);
    progress.set(withTiming(0, { duration: HOLD_RING_RETRACT_MS, easing: Easing.out(Easing.quad) }));
  }, [enabled, progress]);

  // Read from the button's onPress, which fires after onPressOut.
  const releasedAsTap = useCallback(() => outcome.current === 'tap', []);

  return { progress, onPressIn, onPressOut, releasedAsTap };
}
