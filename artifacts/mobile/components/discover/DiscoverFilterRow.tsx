import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticToggle } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { Glass } from '@/components/ui/Glass';

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
 * state), specialized for the five Discover filters. Pinned as a sticky
 * sibling above the grid (see app/(buyer)/discover.tsx) rather than
 * scrolling away with content — Mobbin reference: Instagram's own
 * search-results pill row, pinned directly under the search bar
 * (https://mobbin.com/screens/f85f7bca-4c5c-4535-8c91-dc966ab36d6a).
 * `elevated` fades in a <Glass/> backdrop once the grid below has scrolled,
 * signalling the row is now floating over content rather than sitting flush
 * against the plain background at the top.
 */
export function DiscoverFilterRow({
  active,
  onChange,
  elevated = false,
}: {
  active: DiscoverFilterKey;
  onChange: (key: DiscoverFilterKey) => void;
  elevated?: boolean;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);

  return (
    <View style={styles.wrap}>
      {elevated && <Glass variant="regular" tint="dark" radius={0} style={StyleSheet.absoluteFill} testID="discover-filter-row-glass" />}
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
                hapticToggle();
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
  wrap: { position: 'relative' },
  track: {
    flexDirection: 'row', gap: SPACING.xs,
    paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.sm,
  },
  pill: {
    height: 34, minWidth: 34, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface,
  },
  pillActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  rightFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 28 },
});
