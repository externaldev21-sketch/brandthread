import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticToggle } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

export type SearchTabKey = 'top' | 'videos' | 'users' | 'shop' | 'live';

export const SEARCH_TABS: Array<{ key: SearchTabKey; label: string }> = [
  { key: 'top', label: 'Top' },
  { key: 'videos', label: 'Videos' },
  { key: 'users', label: 'Users' },
  { key: 'shop', label: 'Shop' },
  { key: 'live', label: 'LIVE' },
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
    <View style={styles.wrap}>
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
              // theme-exempt: fixed white-fill/black-text active state per
              // spec, same monochrome pattern as the Follow pill and the
              // search field's fixed dark fill on this page.
              style={[styles.segment, isActive && styles.segmentActive]}
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
                  { fontFamily: isActive ? FONT.semibold : FONT.medium, color: isActive ? '#000000' : theme.muted },
                ]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
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
    height: 34, minWidth: 34, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface,
  },
  segmentActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  rightFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 28 },
});
