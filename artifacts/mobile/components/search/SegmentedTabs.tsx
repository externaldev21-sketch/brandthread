import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS } from '@/lib/theme';

export type SearchTabKey = 'top' | 'brands' | 'products' | 'people';

export const SEARCH_TABS: Array<{ key: SearchTabKey; label: string }> = [
  { key: 'top', label: 'Top' },
  { key: 'brands', label: 'Brands' },
  { key: 'products', label: 'Products' },
  { key: 'people', label: 'People' },
];

/** Clean, theme-aware segmented control switching between search result tabs. */
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
            style={[styles.segment, isActive && { backgroundColor: theme.card }]}
            onPress={() => {
              if (isActive) return;
              Haptics.selectionAsync().catch(() => {});
              onChange(tab.key);
            }}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${tab.label} search results`}
            testID={`search-tab-${tab.key}`}
          >
            <Text style={[styles.label, { color: isActive ? theme.text : theme.muted }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  track: {
    flexDirection: 'row', gap: 4, padding: 4, borderRadius: 14,
    backgroundColor: theme.surface, marginHorizontal: 16, marginTop: 12, marginBottom: 4,
  },
  segment: {
    flex: 1, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  label: { fontSize: FS.sm, fontFamily: FONT.semibold },
});
