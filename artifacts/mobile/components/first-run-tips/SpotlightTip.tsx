import { MEDIA } from '@/lib/theme';
/**
 * `spotlight` variant — dims everything except one specific, real measured
 * control (rounded hole, ~10pt padding, 60% black) with an anchored
 * monochrome bubble pointing at it. Reskin of the Rodeo / Grab references
 * cited in the PR, in this app's monochrome.
 *
 * Tapping the dim or X dismisses. Web target taps perform the real action
 * and complete the tip; native cutout taps use the approved completion-only
 * fallback (see SpotlightOverlay), without activating the real control.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { SpotlightOverlay, holeFor } from './SpotlightOverlay';
import { TipBubble } from './TipBubble';
import { FONT, FS, TEXT_SECONDARY, TEXT_TERTIARY } from '@/lib/theme';
import type { TargetRect } from './types';

export interface SpotlightTipProps {
  visible: boolean;
  onDismiss: () => void;
  /** The real, measured rect of the control being highlighted. Null before it's measured — renders nothing until then. */
  target: TargetRect | null;
  title: string;
  body?: string;
  reduceMotion?: boolean;
  testID?: string;
}

export const TIP_FADE_MS = 200;

export function SpotlightTip({ visible, onDismiss, target, title, body, reduceMotion = false, testID }: SpotlightTipProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const fade = useRef(new Animated.Value(0)).current;
  const shown = visible && !!target;

  useEffect(() => {
    Animated.timing(fade, { toValue: shown ? 1 : 0, duration: reduceMotion ? 1 : TIP_FADE_MS, useNativeDriver: true }).start();
  }, [shown, fade, reduceMotion]);

  if (!visible || !target) return null;
  const hole = holeFor(target, screenW, screenH);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}
      testID={testID ?? 'first-run-tip-spotlight'}
    >
      <SpotlightOverlay hole={hole} onScrimPress={onDismiss} onTargetPress={onDismiss} scrimLabel={`${title}. Tap to dismiss.`} />
      <TipBubble hole={hole} onClose={onDismiss}>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
        <Text style={styles.dismissHint}>Tap anywhere to continue</Text>
      </TipBubble>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 9998, elevation: 9998 },
  title: { color: MEDIA.foreground, fontFamily: FONT.bold, fontSize: FS.md, paddingRight: 24 },
  body: { color: TEXT_SECONDARY, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 4, lineHeight: 18 },
  dismissHint: { color: TEXT_TERTIARY, fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 10 },
});
