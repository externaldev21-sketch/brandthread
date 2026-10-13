/**
 * Brandthread toast: a dark pill at the top of the screen — icon + a few
 * words, gone after 2s, swipe up to dismiss (Instagram / iOS banner
 * pattern). Every toast surface (Snackbar, CenteredToast, the feed toast)
 * draws through this one pill so they all look and behave the same.
 *
 * Motion: one short slide-down on arrival — it tells you something just
 * happened. No other animation.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Image, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { ELEVATION, FONT, SP } from '@/lib/theme';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import { toastIconFor } from '@/lib/confirmationSheet';

export const TOAST_DURATION_MS = 2000;
/** A toast with an action button (e.g. "Undo") stays long enough to tap it. */
export const TOAST_ACTION_DURATION_MS = 4000;
/** Upward drag (pt) that dismisses the toast. */
export const TOAST_SWIPE_DISMISS = 24;

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export { toastIconFor };

export interface TopToastProps {
  message: string;
  icon?: FeatherName;
  thumbnailUri?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Called after the auto-hide delay or a swipe up. Without it the toast never hides itself. */
  onDismiss?: () => void;
  /** Override the auto-hide delay. */
  durationMs?: number;
  testID?: string;
}

export function TopToast({
  message, icon, thumbnailUri, actionLabel, onAction, onDismiss, durationMs, testID,
}: TopToastProps) {
  const insets = useSafeAreaInsets();
  const enter = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const hasAction = !!(actionLabel && onAction);

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [enter]);

  useEffect(() => {
    if (!dismissRef.current) return undefined;
    const ms = durationMs ?? (hasAction ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS);
    const timer = setTimeout(() => dismissRef.current?.(), ms);
    return () => clearTimeout(timer);
  }, [message, durationMs, hasAction]);

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy < -4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => drag.setValue(Math.min(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy < -TOAST_SWIPE_DISMISS) {
        Animated.timing(drag, { toValue: -120, duration: 140, useNativeDriver: true }).start(() => dismissRef.current?.());
      } else {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  }), [drag]);

  const translateY = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }),
    drag,
  );
  const leadIcon = icon ?? toastIconFor(message);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.root, { top: insets.top + SP.sm, opacity: enter, transform: [{ translateY }] }]}
      testID={testID ?? 'top-toast'}
    >
      <View
        style={styles.pill}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        accessibilityHint={onDismiss ? 'Swipe up to dismiss' : undefined}
        {...pan.panHandlers}
      >
        {thumbnailUri ? (
          <Image source={{ uri: thumbnailUri }} style={styles.thumb} accessible={false} />
        ) : (
          <Feather name={leadIcon} size={16} color="#FFFFFF" />
        )}
        <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={styles.message} numberOfLines={1}>{message}</Text>
        {hasAction ? (
          <PressableScale onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel} style={styles.actionHit}>
            <Text style={styles.action}>{actionLabel}</Text>
          </PressableScale>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: SP.md, right: SP.md, alignItems: 'center', zIndex: 1000 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    minHeight: 44, maxWidth: 480,
    paddingHorizontal: SP.md, paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: ELEVATION.card,
  },
  thumb: { width: 24, height: 24, borderRadius: 4 },
  message: { flexShrink: 1, color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20 },
  action: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 15 },
  actionHit: { paddingLeft: SP.xs, minHeight: 32, justifyContent: 'center' },
});
