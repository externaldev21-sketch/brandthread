import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { RADIUS, SP } from '@/lib/theme';

/** A single shimmering placeholder block. Compose these to match a screen's real layout. */
export function SkeletonBlock({ width, height, radius = RADIUS.sm, style }: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const { theme } = useAppTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.cardElevated, opacity: pulse },
        style,
      ]}
    />
  );
}

/** Skeleton matching a feed/discover product card (image + two text lines). */
export function CardSkeleton({ width }: { width: number }) {
  return (
    <View style={{ width, gap: SP.xs }}>
      <SkeletonBlock width="100%" height={width} radius={RADIUS.md} />
      <SkeletonBlock width="70%" height={12} />
      <SkeletonBlock width="40%" height={12} />
    </View>
  );
}

/** Skeleton grid — same column layout a real card grid will render. */
export function GridSkeleton({ columns, cardWidth, rows = 3, gap = SP.sm }: {
  columns: number;
  cardWidth: number;
  rows?: number;
  gap?: number;
}) {
  const count = columns * rows;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} width={cardWidth} />
      ))}
    </View>
  );
}

/** Skeleton matching a horizontal list row (avatar/thumb + two text lines + trailing). */
export function RowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBlock width={48} height={48} radius={RADIUS.md} />
      <View style={{ flex: 1, gap: SP.xs }}>
        <SkeletonBlock width="60%" height={14} />
        <SkeletonBlock width="35%" height={12} />
      </View>
      <SkeletonBlock width={56} height={20} radius={RADIUS.xs} />
    </View>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <View style={{ gap: SP.md }}>
      {Array.from({ length: rows }).map((_, i) => <RowSkeleton key={i} />)}
    </View>
  );
}

/** Skeleton for a KPI tile row (seller dashboard). */
export function KpiRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} width={140} height={84} radius={RADIUS.md} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
  },
});
