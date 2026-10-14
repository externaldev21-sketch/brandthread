/**
 * Pull-to-refresh for the main feeds: instead of the platform spinner, a thin
 * silver thread stitches across the top of the screen while the feed reloads
 * (one pass every 900 ms), and is gone the moment it's done. No sound, no
 * haptic, nothing on scroll.
 *
 * Use the pair from `useThreadRefresh`: `refreshControl` keeps the native pull
 * gesture (with its spinner made invisible) and `indicator` is the thread,
 * rendered once as a sibling of the scroll view so it stays pinned while the
 * content moves. Under Reduce Motion the thread is shown fully stitched, still.
 *
 * Motion is transform-only on the UI thread: a clip window slides in from the
 * left while the stitches inside it are counter-moved so they stay put.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useAppTheme } from '@/contexts/AppThemeContext';

export const THREAD_LOOP_MS = 900;
const STITCH = 6;
const GAP = 4;
const THICKNESS = 1.5;
const INSET = 16;

/** Pure: how many stitches fit across `width` (dash + gap per stitch). */
export function stitchCount(width: number): number {
  return Math.max(0, Math.floor((width + GAP) / (STITCH + GAP)));
}

export function ThreadRefreshIndicator({ refreshing, top }: { refreshing: boolean; top?: number }) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { theme } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const width = Math.max(0, screenWidth - INSET * 2);
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const opacity = useSharedValue(0);
  const [mounted, setMounted] = useState(refreshing);

  useEffect(() => {
    if (refreshing) {
      setMounted(true);
      opacity.value = reduceMotion ? 1 : withTiming(1, { duration: 120 });
      if (reduceMotion) {
        progress.value = 1;
      } else {
        progress.value = 0;
        progress.value = withRepeat(withTiming(1, { duration: THREAD_LOOP_MS, easing: Easing.inOut(Easing.quad) }), -1, false);
      }
      return;
    }
    cancelAnimation(progress);
    if (reduceMotion) { opacity.value = 0; setMounted(false); return; }
    opacity.value = withTiming(0, { duration: 150 });
    const t = setTimeout(() => setMounted(false), 160);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing, reduceMotion]);

  const clipStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: -width * (1 - progress.value) }],
  }));
  const stitchesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: width * (1 - progress.value) }],
  }));

  const stitches = useMemo(() => Array.from({ length: stitchCount(width) }), [width]);
  if (!mounted) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.track, { top: top ?? insets.top + 2, left: INSET, width }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Refreshing"
      testID="thread-refresh"
    >
      <Animated.View style={[styles.clip, { width }, clipStyle]}>
        <Animated.View style={[styles.row, stitchesStyle]}>
          {stitches.map((_, i) => (
            <View key={i} style={[styles.stitch, { backgroundColor: theme.muted }]} />
          ))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * The native pull gesture with its spinner hidden, paired with the thread.
 * Drop `refreshControl` on the feed's scroll view and render `indicator` next
 * to it (outside the scroll view).
 */
export function useThreadRefresh(refreshing: boolean, onRefresh: () => void, opts: { top?: number } = {}) {
  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      // The spinner is replaced by the thread; keep the gesture, hide the wheel.
      tintColor="transparent"
      colors={['transparent']}
      progressBackgroundColor="transparent"
      progressViewOffset={Platform.OS === 'android' ? -1000 : undefined}
    />
  );
  const indicator = <ThreadRefreshIndicator refreshing={refreshing} top={opts.top} />;
  return { refreshControl, indicator };
}

const styles = StyleSheet.create({
  track: { position: 'absolute', height: THICKNESS, zIndex: 50, elevation: 50 },
  clip: { height: THICKNESS, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: GAP, height: THICKNESS },
  stitch: { width: STITCH, height: THICKNESS, borderRadius: THICKNESS / 2 },
});
