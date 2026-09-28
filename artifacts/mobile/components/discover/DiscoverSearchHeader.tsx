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
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { FONT, GUTTER } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { IconButton } from '@/components/ui/IconButton';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

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
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  // Same fixed fallback TabPageHeader itself uses on web preview — see that
  // component's own comment on why insets.top reads 0 there.
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={[styles.row, { paddingTop: topPad + 12 }]}>
      <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
      <TouchableOpacity
        onPress={onSearchPress}
        accessibilityRole="button"
        accessibilityLabel="Search products and brands"
        style={[styles.searchBar, { backgroundColor: theme.surface, borderColor: theme.border }]}
        testID="discover-search-bar"
      >
        <Feather name="search" size={16} color={theme.muted} />
        <Text style={[styles.searchPlaceholder, { color: theme.muted }]} numberOfLines={1}>Search</Text>
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
    paddingHorizontal: GUTTER, paddingBottom: SPACING.sm,
  },
  title: {
    fontSize: 20, lineHeight: 24, fontFamily: FONT.bold, letterSpacing: -0.4,
  },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    height: 36, borderRadius: RADII.pill, borderWidth: 1,
    paddingHorizontal: SPACING.sm,
  },
  searchPlaceholder: { ...TYPE_SCALE.body, fontFamily: FONT.regular },
});
