/**
 * The one section header used across Discover: 20pt bold title on the left,
 * "See all" on the right only when the section has somewhere to go (or a
 * custom trailing control, e.g. the dismiss button on "Brands you might
 * like"). Pinterest's own section titles follow the same left-title /
 * right-action pattern (https://mobbin.com/screens/f4099c3c-5a6f-4c32-9fd6-35d1cc2f4988).
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';

export function DiscoverSectionHeader({
  title,
  onSeeAll,
  trailing,
  style,
}: {
  title: string;
  onSeeAll?: () => void;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.row, style]}>
      <Text style={[styles.title, { color: theme.text }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
      {onSeeAll ? (
        <PressableScale
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={`See all ${title.toLowerCase()}`}
          hitSlop={12}
          noMinHeight
        >
          <Text style={[TYPE_SCALE.footnote, { color: theme.text, fontFamily: FONT.semibold }]}>See all</Text>
        </PressableScale>
      ) : trailing ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, minHeight: 25 },
  title: { fontSize: 20, lineHeight: 24, fontFamily: FONT.bold, flexShrink: 1 },
});
