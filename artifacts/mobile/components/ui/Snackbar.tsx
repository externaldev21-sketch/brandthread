/**
 * Brandthread Design System — Snackbar / Toast (Phase 1)
 *
 * Dark pill anchored to the bottom, with an optional thumbnail and a single
 * action label ("View bag", "Undo"). `components/BrandthreadUI.tsx` already
 * exports an inline `Toast` and an `UndoToastProvider` for the undo pattern
 * specifically — this is the general-purpose variant with a thumbnail slot,
 * used for "Added to bag" / "Now following" style confirmations.
 *
 * Layout/interaction reference only: Faire snackbar with Undo, CHOPT
 * added-to-cart toast, Apple Store centered check toast.
 */
import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { PressableScale } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { FADE_MS } from '@/constants/motion';

export interface SnackbarProps {
  visible: boolean;
  message: string;
  thumbnailUri?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

export function Snackbar({ visible, message, thumbnailUri, actionLabel, onAction, onDismiss }: SnackbarProps) {
  const insets = useSafeAreaInsets();
  const palette = useColors();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(12);

  useEffect(() => {
    opacity.set(withTiming(visible ? 1 : 0, { duration: FADE_MS, easing: Easing.out(Easing.cubic) }));
    translateY.set(withTiming(visible ? 0 : 12, { duration: FADE_MS }));
  }, [visible, opacity, translateY]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] }));

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.root, { bottom: Math.max(insets.bottom, SPACING.md) + SPACING.xl }, style]}
    >
      <View style={[styles.pill, { backgroundColor: palette.elevated }]} accessibilityLiveRegion="polite">
        {thumbnailUri && <Image source={{ uri: thumbnailUri }} style={styles.thumb} />}
        <Text style={[TYPE_SCALE.footnote, styles.message, { color: palette.foreground }]} numberOfLines={2}>{message}</Text>
        {actionLabel && onAction && (
          <PressableScale
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            style={styles.actionHit}
          >
            <Text style={[TYPE_SCALE.footnote, styles.action, { color: palette.foreground }]}>{actionLabel}</Text>
          </PressableScale>
        )}
        {onDismiss && !actionLabel && (
          <PressableScale onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" style={styles.actionHit}>
            <Feather name="x" size={16} color={palette.foreground} />
          </PressableScale>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: SPACING.md, right: SPACING.md, alignItems: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    borderRadius: RADII.pill,
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm,
    maxWidth: 480, width: '100%',
  },
  thumb: { width: 28, height: 28, borderRadius: RADII.chip },
  message: { flex: 1, fontFamily: FONT.medium },
  action: { fontFamily: FONT.bold },
  actionHit: { paddingHorizontal: SPACING.xs, minHeight: 32, justifyContent: 'center' },
});
