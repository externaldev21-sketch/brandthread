/**
 * Brandthread Design System — SegmentedControl (Phase 1)
 *
 * A gliding-indicator segmented control/tab strip, built on the same
 * measured-layout approach as the buyer/seller tab bar indicator
 * (components/tab-bar/TabBarParts.tsx) so the "liquid glide" feel is
 * consistent app-wide.
 */
import React, { useState } from 'react';
import { LayoutChangeEvent, Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { hapticToggle } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { SHEET_SPRING } from '@/constants/motion';

export interface SegmentedControlProps {
  options: { id: string; label: string }[];
  selectedId: string;
  onChange: (id: string) => void;
  testID?: string;
  /**
   * 'surface' (default): the original opaque card-background pill — every
   * existing call site keeps this and is visually unchanged.
   * 'glass': a translucent, blurred dark pill with light text, for sitting
   * directly on top of photo/video content (e.g. the buyer Threads Home
   * feed's "Following / Threads" switcher) where an opaque card would look
   * like a slapped-on control rather than part of the media surface.
   */
  variant?: 'surface' | 'glass';
  /** Compact sizing (34pt tall instead of 40pt) for tight overlay contexts. */
  size?: 'default' | 'compact';
  /**
   * Extra style on the root pill — existing call sites never pass this and
   * are unaffected. Used to give the pill an explicit `minWidth` when its
   * parent is a `flex: 1` wrapper (e.g. centered between other top-bar
   * icons): without one, a row of `flex: 1` segments inside an
   * otherwise-unconstrained row collapses to its text's minimum content
   * size instead of the space actually available, truncating longer labels.
   */
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl({ options, selectedId, onChange, testID, variant = 'surface', size = 'default', style }: SegmentedControlProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const [segmentWidth, setSegmentWidth] = useState(0);
  const activeIndex = Math.max(0, options.findIndex((option) => option.id === selectedId));
  const x = useSharedValue(activeIndex * segmentWidth);
  const glass = variant === 'glass';
  const height = size === 'compact' ? 34 : 40;

  React.useEffect(() => {
    x.set(withSpring(activeIndex * segmentWidth, SHEET_SPRING));
  }, [activeIndex, segmentWidth, x]);

  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width / Math.max(options.length, 1);
    setSegmentWidth(width);
  };

  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.root,
        { height, borderRadius: RADII.pill },
        glass
          ? { backgroundColor: 'rgba(0,0,0,0.28)', borderColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' }
          : { backgroundColor: palette.card, borderColor: palette.border },
        style,
      ]}
      onLayout={onLayout}
      testID={testID}
    >
      {glass && Platform.OS !== 'android' && (
        <BlurView intensity={36} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      )}
      {segmentWidth > 0 && (
        <Animated.View
          style={[
            styles.indicator,
            {
              width: segmentWidth,
              backgroundColor: glass ? 'rgba(255,255,255,0.94)' : theme.accent,
              borderRadius: RADII.pill,
              top: 3,
              bottom: 3,
            },
            indicatorStyle,
          ]}
        />
      )}
      {options.map((option) => {
        const selected = option.id === selectedId;
        const selectedColor = glass ? '#111111' : theme.onAccent;
        const unselectedColor = glass ? 'rgba(255,255,255,0.82)' : palette.mutedForeground;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => { if (!selected) { hapticToggle(); onChange(option.id); } }}
            style={[styles.segment, size === 'compact' && styles.segmentCompact]}
            testID={testID ? `${testID}-${option.id}` : undefined}
          >
            <Text
              style={[
                size === 'compact' ? styles.compactLabel : TYPE_SCALE.footnote,
                { fontFamily: selected ? FONT.semibold : FONT.medium, color: selected ? selectedColor : unselectedColor },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', borderWidth: 1, padding: 3 },
  indicator: { position: 'absolute', left: 3 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xs },
  segmentCompact: { paddingHorizontal: 6 },
  compactLabel: { fontSize: 12, lineHeight: 15 },
});
