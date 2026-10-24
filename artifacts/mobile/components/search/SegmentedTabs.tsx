import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { haptics } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { radius } from '@/constants/radii';

import { ChipRow } from '@/components/ui/ChipRow';
// Results tabs follow TikTok's search pattern: a mixed "Top" overview first,
// then one tab per result type (each paginated server-side by
// GET /api/public/search/all), then Tags. Layout/interaction is unchanged
// from the Instagram-mirroring pill row this replaced.
export type SearchTabKey = 'top' | 'products' | 'brands' | 'people' | 'posts' | 'tags';

// Products / Brands / People lead (the buyer brief); "accounts" is the
// People tab (buyers and sellers).
export const SEARCH_TABS: Array<{ key: SearchTabKey; label: string }> = [
  { key: 'top', label: 'Top' },
  { key: 'products', label: 'Products' },
  { key: 'brands', label: 'Brands' },
  { key: 'people', label: 'People' },
  { key: 'posts', label: 'Posts' },
  { key: 'tags', label: 'Tags' },
];

/**
 * Horizontally-scrolling pill segmented control switching between result
 * tabs — a scrolling pill row rather than fixed equal-width segments so a
 * 5th tab never crushes label text at 375pt width.
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
    <View style={styles.wrap}>
      <ChipRow
        contentContainerStyle={styles.track}
        testID="search-tabs"
        selectedIndex={SEARCH_TABS.findIndex((tab) => tab.key === active)}
        hapticOnSelect={false}
      >
        {SEARCH_TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <TouchableOpacity
              key={tab.key}
              // theme-exempt: fixed white-fill/black-text active state per
              // spec, same monochrome pattern as the Follow pill and the
              // search field's fixed dark fill on this page.
              style={[styles.segment, isActive && styles.segmentActive]}
              onPress={() => {
                if (isActive) return;
                haptics.selection();
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
                  { fontFamily: isActive ? FONT.semibold : FONT.medium, color: isActive ? '#000000' : theme.muted },
                ]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ChipRow>
      {/* Signals more tabs scroll off the right edge (LIVE is often clipped
          at 375–430pt widths) without a hard cut. */}
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
    paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xxs,
  },
  segment: {
    height: 34, minWidth: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface,
  },
  segmentActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  rightFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 28 },
});
