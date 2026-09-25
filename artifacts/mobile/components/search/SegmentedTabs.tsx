import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticToggle } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

export type SearchTabKey = 'top' | 'brands' | 'products' | 'people' | 'videos';

export const SEARCH_TABS: Array<{ key: SearchTabKey; label: string }> = [
  { key: 'top', label: 'Top' },
  { key: 'products', label: 'Products' },
  { key: 'brands', label: 'Brands' },
  { key: 'people', label: 'People' },
  { key: 'videos', label: 'Videos' },
];

/**
 * Horizontally-scrolling pill segmented control switching between result
 * tabs (Alta-style "For you / Top this week / Recent" reference) — a
 * scrolling pill row rather than fixed equal-width segments so a 5th tab
 * (Videos) never crushes label text at 375pt width.
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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.track}
      testID="search-tabs"
    >
      {SEARCH_TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.segment, isActive && { backgroundColor: theme.accent, borderColor: theme.accent }]}
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
    </ScrollView>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  track: {
    flexDirection: 'row', gap: SPACING.xs,
    paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xxs,
  },
  segment: {
    height: 38, minWidth: 44, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface,
  },
});
