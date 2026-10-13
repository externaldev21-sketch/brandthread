import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { haptics } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { radius } from '@/constants/radii';

export type DiscoverFilterKey = 'forYou' | 'fits' | 'brands' | 'people' | 'drops';

export const DISCOVER_FILTERS: Array<{ key: DiscoverFilterKey; label: string }> = [
  { key: 'forYou', label: 'For You' },
  { key: 'fits', label: 'Fits' },
  { key: 'brands', label: 'Brands' },
  { key: 'people', label: 'People' },
  { key: 'drops', label: 'Drops' },
];

/**
 * Discover's filter row — same scrolling-pill pattern as search's
 * SegmentedTabs (16pt gutter, right fade, white-fill/black-text active
 * state), specialized for the five Discover filters.
 */
export function DiscoverFilterRow({
  active,
  onChange,
}: {
  active: DiscoverFilterKey;
  onChange: (key: DiscoverFilterKey) => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.track}
        testID="discover-filter-row"
      >
        {DISCOVER_FILTERS.map((filter) => {
          const isActive = filter.key === active;
          return (
            <TouchableOpacity
              key={filter.key}
              style={[styles.pill, isActive && styles.pillActive]}
              onPress={() => {
                if (isActive) return;
                haptics.selection();
                onChange(filter.key);
              }}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${filter.label} filter`}
              testID={`discover-filter-${filter.key}`}
            >
              <Text
                style={[
                  TYPE_SCALE.footnote,
                  { fontFamily: isActive ? FONT.semibold : FONT.medium, color: isActive ? '#000000' : theme.muted },
                ]}
                numberOfLines={1}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', theme.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.rightFade}
      />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  // The extra bottom margin keeps the grid's first row from starting flush
  // against the chip row (item 46: "grid starts cleanly below the chips").
  wrap: { position: 'relative', marginBottom: 8 },
  track: {
    flexDirection: 'row', gap: SPACING.xs,
    paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.sm,
  },
  pill: {
    height: 34, minWidth: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface,
  },
  pillActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  rightFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 28 },
});
