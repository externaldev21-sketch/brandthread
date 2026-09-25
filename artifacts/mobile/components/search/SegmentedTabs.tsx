import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticToggle } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

export type SearchTabKey = 'top' | 'brands' | 'products' | 'people';

export const SEARCH_TABS: Array<{ key: SearchTabKey; label: string }> = [
  { key: 'top', label: 'Top' },
  { key: 'brands', label: 'Brands' },
  { key: 'products', label: 'Products' },
  { key: 'people', label: 'People' },
];

/**
 * Segmented control switching between search result tabs. Visually and
 * motion-aligned to `components/ui/SegmentedControl` (same track/pill radii,
 * type scale, spacing and selection haptic) — kept as its own lightweight
 * component rather than the animated-indicator version since these four tabs
 * are keyed by a fixed string union, not a generic option list.
 */
export function SegmentedTabs({
  active,
  onChange,
}: {
  active: SearchTabKey;
  onChange: (key: SearchTabKey) => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);

  return (
    <View style={styles.track} testID="search-tabs">
      {SEARCH_TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.segment, isActive && { backgroundColor: theme.accent }]}
            onPress={() => {
              if (isActive) return;
              hapticToggle();
              onChange(tab.key);
            }}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${tab.label} search results`}
            testID={`search-tab-${tab.key}`}
          >
            <Text
              style={[
                TYPE_SCALE.footnote,
                { fontFamily: isActive ? FONT.semibold : FONT.medium, color: isActive ? theme.onAccent : theme.muted },
              ]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  track: {
    flexDirection: 'row', gap: SPACING.xxs, padding: 3, borderRadius: RADII.pill,
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
    marginHorizontal: SCREEN_GUTTER, marginTop: SPACING.sm, marginBottom: SPACING.xxs,
  },
  segment: {
    flex: 1, height: 34, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
});
