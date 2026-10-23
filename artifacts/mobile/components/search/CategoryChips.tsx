import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { STYLE_TAGS } from '@/components/StyleTagsPicker';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticSelection } from '@/lib/haptics';
import { buildSearchChips } from '@/lib/searchCategories';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { radius } from '@/constants/radii';

export const SEARCH_CHIPS = buildSearchChips(STYLE_TAGS);

/**
 * Category chips under the search bar (Streetwear, Vintage, Y2K,
 * Accessories, …). Single-select: tapping the active chip clears it. The
 * selection filters product results only. Same shape as SegmentedTabs' pills and
 * monochrome only, so the header stays black/white/silver.
 */
export function CategoryChips({ value, onChange }: { value: string | null; onChange: (key: string | null) => void }) {
  const { theme } = useAppTheme();
  return (
    <View testID="search-category-chips">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.track}>
        {SEARCH_CHIPS.map((chip) => {
          const active = chip.key === value;
          return (
            <TouchableOpacity
              key={chip.key}
              onPress={() => { hapticSelection(); onChange(active ? null : chip.key); }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={active ? `${chip.label}, selected. Tap to clear` : `Filter products by ${chip.label}`}
              // Active = inverted fill (theme text colour as the fill), so it
              // reads white-on-black in dark mode and black-on-white in light.
              style={[styles.chip, active
                ? { borderColor: theme.text, backgroundColor: theme.text }
                : { borderColor: theme.border, backgroundColor: theme.surface }]}
              testID={`search-chip-${chip.key}`}
            >
              <Text style={[TYPE_SCALE.footnote, { color: active ? theme.background : theme.text, fontFamily: active ? FONT.semibold : FONT.medium }]} numberOfLines={1}>
                {chip.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: SPACING.xs, paddingHorizontal: SCREEN_GUTTER, paddingBottom: SPACING.sm },
  chip: { height: 30, justifyContent: 'center', paddingHorizontal: SPACING.md, borderRadius: radius.sm, borderWidth: 1 },
});
