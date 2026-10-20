/**
 * Shared onboarding motion: springs, press feedback, first-arrival stagger and
 * the pure edge-swipe maths used by OnboardingStepTransition. Motion only —
 * nothing here changes layout, copy, colors or fonts.
 */
import { createContext, useContext, useEffect, useRef } from 'react';
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { hapticLight } from '@/lib/haptics';

export const PRESS_IN_SCALE = 0.96;
/** Quick, lightly damped: page slides and press release. */
export const SPRING_PAGE = { damping: 26, stiffness: 260, mass: 0.9 } as const;
export const SPRING_RELEASE = { damping: 14, stiffness: 320 } as const;
export const SPRING_POP = { damping: 12, stiffness: 420 } as const;
export const SPRING_ARRIVE = { damping: 20, stiffness: 220 } as const;
export const STAGGER_MS = 70;
export const ARRIVE_OFFSET = 12;
/** Incoming step starts this share (full width: a true side-by-side push) of the width off to the side. */
export const PAGE_OFFSET_RATIO = 1;

// ─── Edge swipe (pure, unit-tested) ──────────────────────────────────────────

export const EDGE_WIDTH = 28;
export const LOCK_DISTANCE = 10;

/** Direction lock: only a rightward, mostly-horizontal drag from the left edge. */
export function shouldStartBackSwipe(x0: number, dx: number, dy: number, enabled: boolean) {
  'worklet';
  if (!enabled) return false;
  if (x0 > EDGE_WIDTH) return false;
  if (dx < LOCK_DISTANCE) return false;
  return Math.abs(dx) > Math.abs(dy) * 1.5;
}

export function shouldCompleteBack(dx: number, vx: number, width: number) {
  'worklet';
  if (dx <= 0) return false;
  return dx > width * 0.33 || vx > 0.5;
}

export function entryOffset(direction: 1 | -1, width: number) {
  'worklet';
  return direction * width * PAGE_OFFSET_RATIO;
}

// ─── First arrival ───────────────────────────────────────────────────────────

/** True only the first time a step is shown going forward. */
export const ArrivalContext = createContext(false);

/** Per-flow memory of the last progress %, owned by the mounted transition. */
export const ProgressMemoryContext = createContext<{ current: number | null } | null>(null);

/** True inside the outgoing (leaving) layer: inputs must be inert. */
export const InertContext = createContext(false);

export function useArrivalStyle(index: number) {
  const arriving = useContext(ArrivalContext);
  const reduce = useReducedMotion();
  const animate = arriving && !reduce;
  const p = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (animate) p.value = withDelay(index * STAGGER_MS, withSpring(1, SPRING_ARRIVE));
    // Mount-only: re-renders on the same step never replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * ARRIVE_OFFSET }],
  }));
}

// ─── Press / select / ready ──────────────────────────────────────────────────

/**
 * Press-in scale + light impact (through lib/haptics, so the global switch
 * applies), spring release, a small pop when `selected` turns on and a spring
 * into the ready state when `disabled` turns off. Values run on the UI thread.
 */
export function usePressMotion({ disabled, selected }: { disabled?: boolean; selected?: boolean } = {}) {
  const reduce = useReducedMotion();
  const press = useSharedValue(1);
  const pop = useSharedValue(1);

  const wasSelected = useRef(!!selected);
  useEffect(() => {
    const edge = !wasSelected.current && !!selected;
    wasSelected.current = !!selected;
    if (reduce || !edge) return;
    pop.value = withSequence(withTiming(1.04, { duration: 70 }), withSpring(1, SPRING_POP));
  }, [selected, reduce, pop]);

  const wasDisabled = useRef(!!disabled);
  useEffect(() => {
    const edge = wasDisabled.current && !disabled;
    wasDisabled.current = !!disabled;
    if (reduce || !edge) return;
    // Only on the disabled → ready edge.
    pop.value = withSequence(withTiming(0.98, { duration: 0 }), withSpring(1, SPRING_POP));
  }, [disabled, reduce, pop]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value * pop.value }] }));
  return {
    style,
    onPressIn: () => {
      if (disabled) return;
      hapticLight();
      if (!reduce) press.value = withTiming(PRESS_IN_SCALE, { duration: 80 });
    },
    onPressOut: () => {
      press.value = reduce ? 1 : withSpring(1, SPRING_RELEASE);
    },
  };
}
