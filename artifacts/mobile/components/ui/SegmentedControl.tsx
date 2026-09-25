/**
 * Brandthread Design System — SegmentedControl (Phase 1)
 *
 * A gliding-indicator segmented control/tab strip, built on the same
 * measured-layout approach as the buyer/seller tab bar indicator
 * (components/tab-bar/TabBarParts.tsx) so the "liquid glide" feel is
 * consistent app-wide.
 */
import React, { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
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
}

export function SegmentedControl({ options, selectedId, onChange, testID }: SegmentedControlProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const [segmentWidth, setSegmentWidth] = useState(0);
  const activeIndex = Math.max(0, options.findIndex((option) => option.id === selectedId));
  const x = useSharedValue(activeIndex * segmentWidth);

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
      style={[styles.root, { backgroundColor: palette.card, borderColor: palette.border, borderRadius: RADII.pill }]}
      onLayout={onLayout}
      testID={testID}
    >
      {segmentWidth > 0 && (
        <Animated.View
          style={[
            styles.indicator,
            { width: segmentWidth, backgroundColor: theme.accent, borderRadius: RADII.pill },
            indicatorStyle,
          ]}
        />
      )}
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => { if (!selected) { hapticToggle(); onChange(option.id); } }}
            style={styles.segment}
            testID={testID ? `${testID}-${option.id}` : undefined}
          >
            <Text
              style={[
                TYPE_SCALE.footnote,
                { fontFamily: selected ? FONT.semibold : FONT.medium, color: selected ? theme.onAccent : palette.mutedForeground },
              ]}
              numberOfLines={1}
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
  root: { flexDirection: 'row', borderWidth: 1, padding: 3, height: 40 },
  indicator: { position: 'absolute', top: 3, bottom: 3, left: 3 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xs },
});
