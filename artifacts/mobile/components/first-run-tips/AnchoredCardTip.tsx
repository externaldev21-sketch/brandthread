/**
 * `anchored` variant — a small card pointing at a specific control, with
 * multi-step Next/Skip navigation. Reskin of the Mesh
 * (https://mobbin.com/screens/caa68f50-c536-45b5-87eb-5bf296ab5488) and Opera
 * (https://mobbin.com/screens/6255fa9c-c07f-4abf-8ca1-123f9eb1f9d1)
 * references cited in the PR, in this app's monochrome.
 *
 * Each step optionally points at its own measured target rect (an arrow on
 * the card's edge nearest the target); a step with no target renders as a
 * centered card (e.g. a screen-level "here's your dashboard" first step).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import type { FirstRunTipStep, TargetRect } from './types';

export interface AnchoredCardTipProps {
  visible: boolean;
  onDismiss: () => void;
  steps: FirstRunTipStep[];
  /** Measured target rect per step, indexed the same as `steps`. Null entries render a centered card. */
  targets?: (TargetRect | null)[];
  reduceMotion?: boolean;
  testID?: string;
}

export function AnchoredCardTip({ visible, onDismiss, steps, targets = [], reduceMotion = false, testID }: AnchoredCardTipProps) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) setStepIndex(0);
  }, [visible]);

  useEffect(() => {
    Animated.timing(fade, { toValue: visible ? 1 : 0, duration: reduceMotion ? 1 : 200, useNativeDriver: true }).start();
  }, [visible, fade, reduceMotion]);

  if (!visible || steps.length === 0) return null;

  const step = steps[stepIndex];
  const target = targets[stepIndex] ?? null;
  const isLast = stepIndex === steps.length - 1;

  function next() {
    if (isLast) { onDismiss(); return; }
    setStepIndex((i) => i + 1);
  }

  const cardBelowTarget = target ? target.y + target.height + 160 < screenH : false;
  const positionStyle = target
    ? cardBelowTarget
      ? { top: target.y + target.height + SP.md }
      : { top: Math.max(target.y - 180, insets.top + SP.md) }
    : { top: '38%' as const };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { opacity: fade }]}
      testID={testID ?? 'first-run-tip-anchored'}
    >
      {/* A light scrim, not the heavy full-screen dim — this variant stays
          small-footprint per Dev's rule ("small = anchored card"). */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.scrim]} />
      <View style={[styles.cardWrap, positionStyle, target ? { left: Math.max(Math.min(target.x, 0), 0) } : { left: 0, right: 0, alignItems: 'center' }]}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.stepCount}>{stepIndex + 1} / {steps.length}</Text>
            <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Skip">
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
          </View>
          <Text style={styles.title}>{step.title}</Text>
          {step.body ? <Text style={styles.body}>{step.body}</Text> : null}
          <View style={styles.dots}>
            {steps.map((_, i) => (
              <View key={i} style={[styles.dot, i === stepIndex && styles.dotActive]} />
            ))}
          </View>
          <PressableScale onPress={next} style={styles.nextButton} accessibilityRole="button" accessibilityLabel={isLast ? 'Done' : 'Next'}>
            <Text style={styles.nextButtonText}>{isLast ? 'Done' : 'Next'}</Text>
          </PressableScale>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.28)' },
  cardWrap: { position: 'absolute', paddingHorizontal: SP.lg, zIndex: 9998, elevation: 9998 },
  card: {
    width: 280,
    backgroundColor: 'rgba(15,15,15,0.96)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: RADIUS.lg,
    padding: SP.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  stepCount: { color: 'rgba(255,255,255,0.5)', fontFamily: FONT.medium, fontSize: FS.xs, letterSpacing: 0.3 },
  skip: { color: 'rgba(255,255,255,0.75)', fontFamily: FONT.semibold, fontSize: FS.xs },
  title: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: FS.md },
  body: { color: 'rgba(255,255,255,0.75)', fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 4, lineHeight: 18 },
  dots: { flexDirection: 'row', gap: 5, marginTop: 14, marginBottom: 14 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { backgroundColor: '#FFFFFF', width: 14 },
  nextButton: { backgroundColor: '#FFFFFF', borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  nextButtonText: { color: '#000000', fontFamily: FONT.bold, fontSize: FS.sm },
});
