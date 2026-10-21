/**
 * Discover's top: the "Discover" title row (bell on the right), then a
 * full-width IG-styled search bar on its own row (audit #38 — title and
 * search squeezed onto one line read as cramped at 390pt). Mobbin
 * references: Instagram Explore's full-width search field
 * (https://mobbin.com/screens/09675c3d-91fb-4d71-a2e1-f41fab098867) and
 * Substack Explore's title row above a full-width search
 * (https://mobbin.com/screens/4c319bf4-0035-41b1-902e-d7190ef45331).
 * The title row keeps the reframe ScreenHeader offset/height so every tab's
 * title sits on the same baseline.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { FONT, FS, GUTTER } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { IconButton } from '@/components/ui/IconButton';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { X_GUTTER, X_HEADER_HEIGHT, X_SPACE, X_TYPE, xColors } from '@/constants/reframe';

export function DiscoverSearchHeader({
  title,
  onSearchPress,
  onBellPress,
  bellBadge,
  searchBarRef,
  searchBarHidden,
  beforeSearch,
}: {
  title: string;
  onSearchPress: () => void;
  onBellPress?: () => void;
  bellBadge?: number;
  /** Lets Discover measure the bar so its in-place search overlay starts from it. */
  searchBarRef?: React.Ref<View>;
  /** Hidden while the search overlay's copy of this bar is on screen. */
  searchBarHidden?: boolean;
  beforeSearch?: React.ReactNode;
}) {
  const { theme } = useAppTheme();
  const topPad = useHeaderTopInset();
  const c = xColors(theme);

  return (
    <View>
      {/* Same top offset and 44pt row as the reframe ScreenHeader on the other
          tab pages, so every tab's title sits on the same baseline. */}
      <View style={[styles.row, { marginTop: topPad + X_SPACE[4], paddingRight: onBellPress ? X_GUTTER - 12 : X_GUTTER }]}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
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
      {beforeSearch}
      <TouchableOpacity
        ref={searchBarRef as never}
        onPress={onSearchPress}
        accessibilityRole="button"
        accessibilityLabel="Search products and brands"
        style={[styles.searchBar, { backgroundColor: theme.cardElevated }, searchBarHidden && { opacity: 0 }]}
        testID="discover-search-bar"
      >
        <Icon name="search" size={18} color={c.secondary} />
        <Text style={[styles.searchPlaceholder, { color: c.secondary }]} numberOfLines={1}>Search</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm,
    height: X_HEADER_HEIGHT, paddingLeft: X_GUTTER,
  },
  title: { ...X_TYPE.title, flexShrink: 1 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    height: 44, borderRadius: RADII.pill, borderWidth: 0,
    paddingHorizontal: SPACING.sm,
    marginHorizontal: X_GUTTER, marginTop: X_SPACE[4], marginBottom: 0,
  },
  searchPlaceholder: { ...X_TYPE.body, fontFamily: FONT.regular },
});
