import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, type LayoutChangeEvent } from 'react-native';
import { SHEET_EASING_BEZIER } from '@/constants/motion';

/** How long a live row takes to arrive — a touch longer than a sheet opening. */
export const LIVE_ROW_ENTER_MS = 320;
/** How far above its slot the row starts (it slides down into place). */
export const LIVE_ROW_ENTER_OFFSET = 12;

// Reduce Motion, known synchronously once read (and kept current), so a row
// arriving with it on is inserted straight away rather than sitting hidden
// for the frames an async check takes.
let reduceMotionKnown: boolean | null = null;
let reduceMotionPrimed = false;
function primeReduceMotion() {
  if (reduceMotionPrimed) return;
  reduceMotionPrimed = true;
  AccessibilityInfo.isReduceMotionEnabled?.()
    ?.then((value) => { reduceMotionKnown = value; })
    .catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value: boolean) => { reduceMotionKnown = value; });
}
primeReduceMotion();

/**
 * Entrance for a list row that arrived live (item 84 — a new Activity event
 * while the screen is open). The slot opens from zero height so the rows
 * below glide down instead of jumping, while the row itself slides down a
 * few points into place and fades in. One plain timing on the app's sheet
 * curve — never a spring, so no bounce.
 *
 * `animate` false renders the children untouched. With Reduce Motion on the
 * row is simply inserted (no slide, no fade). Once the entrance has settled
 * the wrapper steps aside entirely, so nothing is left holding a transform
 * (see lib/animationUtils.ts on why that matters on web).
 */
export function LiveRowEnter({
  animate,
  onEntered,
  children,
  testID,
}: {
  animate: boolean;
  onEntered?: () => void;
  children: React.ReactNode;
  testID?: string;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  // Reduce Motion already known to be on: this row is simply inserted.
  const shouldAnimate = animate && reduceMotionKnown !== true;
  const [height, setHeight] = useState<number | null>(null);
  const [phase, setPhase] = useState<'measuring' | 'running' | 'done'>(shouldAnimate ? 'measuring' : 'done');
  const everAnimated = useRef(shouldAnimate);
  if (shouldAnimate && phase !== 'done') everAnimated.current = true;
  const reduceMotion = useRef<boolean | null>(reduceMotionKnown);
  const onEnteredRef = useRef(onEntered);
  onEnteredRef.current = onEntered;

  // Inserted without animation (Reduce Motion): still report it as arrived.
  useEffect(() => {
    if (animate && !shouldAnimate) onEnteredRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!shouldAnimate) return;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => { if (!cancelled) reduceMotion.current = value; })
      .catch(() => { reduceMotion.current = false; });
    return () => { cancelled = true; };
  }, [shouldAnimate]);

  const finish = useCallback(() => {
    setPhase('done');
    onEnteredRef.current?.();
  }, []);

  const start = useCallback((measured: number) => {
    const go = (reduced: boolean) => {
      if (reduced || measured <= 0) { finish(); return; }
      setHeight(measured);
      setPhase('running');
      Animated.timing(progress, {
        toValue: 1,
        duration: LIVE_ROW_ENTER_MS,
        easing: Easing.bezier(...SHEET_EASING_BEZIER),
        // Height can't run on the native driver, and one value drives all three.
        useNativeDriver: false,
      }).start(({ finished }) => { if (finished) finish(); });
    };
    if (reduceMotion.current !== null) { go(reduceMotion.current); return; }
    const check = AccessibilityInfo.isReduceMotionEnabled?.();
    if (check) check.then(go).catch(() => go(false)); else go(false);
  }, [finish, progress]);

  const handleMeasure = useCallback((event: LayoutChangeEvent) => {
    if (phase !== 'measuring') return;
    start(event.nativeEvent.layout.height);
  }, [phase, start]);

  // A row that never animated keeps exactly the tree it always had.
  if (!everAnimated.current) return <>{children}</>;

  // A row that did keeps its wrappers once settled (so it doesn't remount and
  // re-load its images) — just with every animated style gone.
  const settled = phase === 'done';
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-LIVE_ROW_ENTER_OFFSET, 0] });
  return (
    <Animated.View
      testID={settled ? undefined : testID}
      style={settled ? undefined : {
        overflow: 'hidden',
        height: phase === 'running' && height !== null
          ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] })
          : 0,
      }}
    >
      <Animated.View
        onLayout={settled ? undefined : handleMeasure}
        style={settled ? undefined : { opacity: progress, transform: [{ translateY }] }}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}
