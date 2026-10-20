/**
 * Wraps the controller's current step. On `stepId` change the incoming and
 * outgoing screens (header, body and footer together) spring side by side:
 * forward pushes left, back pushes right. The outgoing screen is the same
 * mounted instance (never remounted, so no autoFocus re-fires), is
 * non-interactive and hidden from accessibility, and unmounts when its spring
 * settles. Edge-swipe back runs on the UI thread (Gesture.Pan); only the
 * committed `onBack` hops to JS. Reduce Motion: instant swaps, no stagger.
 */
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ArrivalContext, InertContext, ProgressMemoryContext, EDGE_WIDTH, LOCK_DISTANCE, SPRING_PAGE, entryOffset, shouldCompleteBack } from './launch/motion';

export type OnboardingStepTransitionProps = {
  stepId: string;
  direction: 1 | -1;
  onBack?: () => void;
  children: React.ReactNode;
};

type Layer = { id: string; node: React.ReactNode; arriving: boolean };

const HIDDEN_A11Y = Platform.select({
  web: { 'aria-hidden': true } as object,
  default: { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const },
});

export function OnboardingStepTransition({ stepId, direction, onBack, children }: OnboardingStepTransitionProps) {
  const { theme } = useAppTheme();
  const reduce = useReducedMotion();
  const { width } = useWindowDimensions();
  const inX = useSharedValue(0);
  const progressMemory = useRef<number | null>(null);
  const outX = useSharedValue(0);

  // Layers derived during render so the new screen and the frozen old one
  // appear in the same commit — no blank frame.
  const visited = useRef(new Set<string>([stepId]));
  const current = useRef<Layer>({ id: stepId, node: children, arriving: true });
  const [outgoing, setOutgoing] = useState<Layer | null>(null);
  const pendingOut = useRef<Layer | null>(null);

  if (current.current.id !== stepId) {
    const prev = current.current;
    const arriving = direction === 1 && !visited.current.has(stepId);
    visited.current.add(stepId);
    current.current = { id: stepId, node: children, arriving };
    pendingOut.current = reduce || prev.id === stepId ? null : prev;
  } else {
    current.current = { ...current.current, node: children };
  }
  const shownOut = pendingOut.current ?? outgoing;
  // Never re-show a stale copy of the step that is now live.
  const out = shownOut && shownOut.id !== stepId ? shownOut : null;

  const clearOut = useCallback((id: string) => {
    setOutgoing((o) => (o && o.id === id ? null : o));
  }, []);

  const lastStep = useRef(stepId);
  useLayoutEffect(() => {
    if (lastStep.current === stepId) return;
    lastStep.current = stepId;
    const leaving = pendingOut.current;
    pendingOut.current = null;
    if (reduce || !leaving) {
      setOutgoing(null);
      inX.value = 0;
      outX.value = 0;
      return;
    }
    setOutgoing(leaving);
    // A swiped-back screen continues from where the finger left it.
    const leavingX = inX.value;
    outX.value = leavingX;
    // A completed edge swipe has already moved the leaving page. Start its
    // neighbor at that same edge, not a full width away with a blank gap.
    inX.value = leavingX + entryOffset(direction, width);
    inX.value = withSpring(0, SPRING_PAGE);
    const id = leaving.id;
    outX.value = withSpring(-direction * width, SPRING_PAGE, (done) => {
      if (done) runOnJS(clearOut)(id);
    });
  }, [stepId, direction, reduce, width, inX, outX, clearOut]);

  const backRef = useRef(onBack);
  backRef.current = onBack;
  const commitBack = useCallback(() => { backRef.current?.(); }, []);

  const pan = useMemo(() => Gesture.Pan()
    .enabled(!!onBack)
    .hitSlop({ left: 0, width: EDGE_WIDTH })
    .activeOffsetX(LOCK_DISTANCE)
    .failOffsetY([-LOCK_DISTANCE * 1.5, LOCK_DISTANCE * 1.5])
    .onUpdate((e) => {
      inX.value = Math.max(0, e.translationX);
    })
    .onEnd((e) => {
      if (shouldCompleteBack(e.translationX, e.velocityX / 1000, width)) {
        runOnJS(commitBack)();
      } else {
        inX.value = reduce ? 0 : withSpring(0, SPRING_PAGE);
      }
    })
    .onFinalize((_e, success) => {
      if (!success) inX.value = reduce ? 0 : withSpring(0, SPRING_PAGE);
    }), [onBack, width, reduce, inX, commitBack]);

  const inStyle = useAnimatedStyle(() => ({ transform: [{ translateX: inX.value }] }));
  const outStyle = useAnimatedStyle(() => ({ transform: [{ translateX: outX.value }] }));
  const bg = { backgroundColor: theme.background };

  return (
    <ProgressMemoryContext.Provider value={progressMemory}>
    <GestureDetector gesture={pan}>
      <View testID="onboarding-step-transition" style={[s.frame, bg]} collapsable={false}>
        {out ? (
          <Animated.View key={out.id} pointerEvents="none" {...(Platform.OS === 'web' ? { inert: true } as object : null)} style={[StyleSheet.absoluteFill, bg, outStyle]} {...HIDDEN_A11Y}>
            <InertContext.Provider value><ArrivalContext.Provider value={out.arriving}>{out.node}</ArrivalContext.Provider></InertContext.Provider>
          </Animated.View>
        ) : null}
        <Animated.View key={stepId} style={[s.frame, bg, inStyle]}>
          <InertContext.Provider value={false}><ArrivalContext.Provider value={current.current.arriving}>{current.current.node}</ArrivalContext.Provider></InertContext.Provider>
        </Animated.View>
      </View>
    </GestureDetector>
    </ProgressMemoryContext.Provider>
  );
}

const s = StyleSheet.create({ frame: { flex: 1, overflow: 'hidden' } });

export default OnboardingStepTransition;
