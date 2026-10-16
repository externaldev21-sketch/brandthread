/**
 * Discover's top row — title + a real IG-styled search bar in ONE row,
 * eliminating the dead space between a separate title row and the filter
 * chips below it. Mobbin reference: Instagram's own Explore screen
 * (https://mobbin.com/screens/09675c3d-91fb-4d71-a2e1-f41fab098867) — a
 * rounded search-bar pill (magnifying glass + "Search" placeholder) sitting
 * directly above the grid, add-person icon at the trailing edge. Brandthread
 * keeps its own "Discover" title (per the standing rule to preserve title/
 * position) fused onto the same row instead of Instagram's bare search bar.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { IconButton } from '@/components/ui/IconButton';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { X_GUTTER, X_HAIRLINE, X_HEADER_HEIGHT, X_SPACE, X_TYPE, xColors } from '@/constants/reframe';

export function DiscoverSearchHeader({
  title,
  onSearchPress,
  onBellPress,
  bellBadge,
}: {
  title: string;
  onSearchPress: () => void;
  onBellPress?: () => void;
  bellBadge?: number;
}) {
  const { theme } = useAppTheme();
  const topPad = useHeaderTopInset();
  const c = xColors(theme);

  return (
    // Same top offset and 44pt row as the reframe ScreenHeader on the other
    // tab pages, so every tab's title sits on the same baseline.
    <View style={[styles.row, { marginTop: topPad + X_SPACE[4], paddingRight: onBellPress ? X_GUTTER - 12 : X_GUTTER }]}>
      <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
      <TouchableOpacity
        onPress={onSearchPress}
        accessibilityRole="button"
        accessibilityLabel="Search products and brands"
        style={[styles.searchBar, { backgroundColor: theme.surface, borderColor: c.divider }]}
        testID="discover-search-bar"
      >
        <Feather name="search" size={16} color={c.secondary} />
        <Text style={[styles.searchPlaceholder, { color: c.secondary }]} numberOfLines={1}>Search</Text>
      </TouchableOpacity>
      {onBellPress && (
        <IconButton
          name="bell"
          variant="plain"
          size={20}
          color={theme.text}
          onPress={onBellPress}
          accessibilityLabel="Notifications"
          badge={bellBadge}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    height: X_HEADER_HEIGHT, paddingLeft: X_GUTTER,
  },
  title: { ...X_TYPE.title },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    height: 36, borderRadius: RADII.pill, borderWidth: X_HAIRLINE,
    paddingHorizontal: SPACING.sm,
  },
  searchPlaceholder: { ...X_TYPE.body, fontFamily: FONT.regular },
});
