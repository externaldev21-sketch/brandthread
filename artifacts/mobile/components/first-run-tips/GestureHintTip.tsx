/**
 * `gesture` variant — small footprint, animated hand/finger glyph performing
 * the real gesture over the real underlying UI, with a short caption beside
 * it. Reskin of the Quizlet swipe-to-preview reference cited in the PR
 * (https://mobbin.com/screens/f8125705-5ed4-4f31-8b95-70a1fed3b227): a real
 * gesture animation with a short caption, not a full-screen takeover.
 *
 * Positioned near a corner of the screen (caller picks which) rather than a
 * measured target rect — this variant is for a single, simple gesture the
 * whole screen supports (e.g. "swipe left on a row"), not a specific control.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { FILL_ELEVATED, FONT, FS, SP, RADIUS, TEXT_SECONDARY } from '@/lib/theme';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { GestureGlyph } from './GestureGlyph';
import type { GestureKind } from './types';

export interface GestureHintTipProps {
  visible: boolean;
  onDismiss: () => void;
  gesture: GestureKind;
  title: string;
  body?: string;
  /** Which corner/edge of the screen the hint anchors to. Defaults to bottom-center, clear of the tab bar. */
  placement?: 'bottom-center' | 'top-center' | 'center';
  reduceMotion?: boolean;
  testID?: string;
}

export function GestureHintTip({
  visible, onDismiss, gesture, title, body, placement = 'bottom-center', reduceMotion = false, testID,
}: GestureHintTipProps) {
  const insets = useSafeAreaInsets();
  const tabBarInset = useBuyerTabBarInset();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: visible ? 1 : 0, duration: reduceMotion ? 1 : 200, useNativeDriver: true }).start();
  }, [visible, fade, reduceMotion]);

  if (!visible) return null;

  const positionStyle =
    placement === 'top-center' ? { top: insets.top + SP.xl } :
    placement === 'center' ? { top: '42%' as const } :
    { bottom: tabBarInset + SP.xl };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.root, positionStyle, { opacity: fade }]}
      testID={testID ?? 'first-run-tip-gesture'}
    >
      <Pressable
        style={styles.card}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={`${title}. Tap to dismiss.`}
      >
        <View style={styles.glyphSlot}>
          <GestureGlyph gesture={gesture} size={26} reduceMotion={reduceMotion} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}
        </View>
        <Feather name="x" size={14} color="rgba(255,255,255,0.6)" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: SP.lg, right: SP.lg, alignItems: 'center', zIndex: 9998, elevation: 9998 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: FILL_ELEVATED, // solid: content never shows through a tip
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: RADIUS.lg,
    paddingVertical: 10, paddingHorizontal: 14,
    maxWidth: 340,
  },
  glyphSlot: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.sm },
  body: { color: TEXT_SECONDARY, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
});
