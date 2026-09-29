/**
 * Shared fixed header for every seller list screen with the
 * title+chevron / search+filter+sort / status-chips pattern (currently
 * Orders and Products — the only two screens that actually have this exact
 * shape; extend here if a future screen grows the same parts instead of
 * hand-rolling them again).
 *
 * Pixel-for-pixel Orders' own header, which is the standard: 44pt title
 * row, 36px search/filter/sort controls, no border/background on the
 * title's own icon actions, and — critically — no separate background
 * color of its own. A screen's header used to set its own fill to
 * theme's surface token (a lighter grey than the screen's own background
 * token), which read as a visible band behind the chip row on any screen
 * where the two colors differ. This component is transparent; the
 * screen's own root background shows straight through.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COMP, FONT, FS, GRAD_DARK_FADE, ICON, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FilterChip, PressableScale, SearchBar } from '@/components/BrandthreadUI';

export interface SellerListHeaderAction {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
}

export interface SellerListHeaderChip {
  key: string;
  label: string;
  active: boolean;
  count?: number;
  onPress: () => void;
}

export interface SellerListHeaderProps {
  title: string;
  onTitlePress: () => void;
  titleAccessibilityLabel: string;
  actions: SellerListHeaderAction[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  onFilterPress: () => void;
  hasActiveFilter: boolean;
  filterAccessibilityLabel: string;
  onSortPress: () => void;
  sortAccessibilityLabel: string;
  chips: SellerListHeaderChip[];
}

/** The count-line row every screen renders itself (inside its own list's
 *  ListHeaderComponent, so it scrolls away with the content) — exported so
 *  every screen using SellerListHeader gets the identical spacing/type
 *  instead of guessing at matching values independently. */
export const sellerListCountRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    paddingBottom: SP.sm,
  },
  text: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
});

export function SellerListHeader({
  title, onTitlePress, titleAccessibilityLabel, actions,
  searchValue, onSearchChange, searchPlaceholder,
  onFilterPress, hasActiveFilter, filterAccessibilityLabel,
  onSortPress, sortAccessibilityLabel,
  chips,
}: SellerListHeaderProps) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);

  return (
    <View>
      {/* Title row */}
      <View style={s.titleRow}>
        <PressableScale
          style={s.titleBtn}
          onPress={onTitlePress}
          accessibilityLabel={titleAccessibilityLabel}
        >
          <Text style={[s.titleText, { color: theme.text }]}>{title}</Text>
          <Feather name="chevron-down" size={18} color={theme.muted} />
        </PressableScale>
        <View style={s.titleActions}>
          {actions.map((action) => (
            <PressableScale
              key={action.accessibilityLabel}
              style={s.headerIconBtn}
              onPress={action.onPress}
              accessibilityLabel={action.accessibilityLabel}
            >
              <Feather name={action.icon} size={ICON.md} color={theme.text} />
            </PressableScale>
          ))}
        </View>
      </View>

      {/* Search row */}
      <View style={s.searchRow}>
        <View style={s.searchBoxRow}>
          <SearchBar
            value={searchValue}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            style={s.searchBarFlex}
          />
        </View>
        <PressableScale
          style={[s.controlBtn, hasActiveFilter && { borderColor: theme.accent, backgroundColor: theme.accentDim }]}
          onPress={onFilterPress}
          accessibilityLabel={filterAccessibilityLabel}
        >
          <Feather name="sliders" size={14} color={hasActiveFilter ? theme.accentLight : theme.muted} />
        </PressableScale>
        <PressableScale
          style={s.controlBtn}
          onPress={onSortPress}
          accessibilityLabel={sortAccessibilityLabel}
        >
          <Feather name="chevrons-down" size={14} color={theme.muted} />
        </PressableScale>
      </View>

      {/* Status chips — horizontal scroll with a trailing fade so the last
          chip reads as scrollable instead of abruptly clipped. */}
      <View style={{ position: 'relative' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pillsRow}>
          {chips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              active={chip.active}
              onPress={chip.onPress}
              count={chip.count}
            />
          ))}
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={GRAD_DARK_FADE}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          style={s.pillsFade}
        />
      </View>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    minHeight: 44,
  },
  titleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  titleText: {
    fontSize: 20,
    fontFamily: FONT.bold,
    letterSpacing: -0.4,
  },
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconBtn: {
    width: COMP.iconBtn,
    height: COMP.iconBtn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  searchBoxRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  searchBarFlex: { flex: 1, height: 36 },
  controlBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.card,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: theme.border,
  },
  pillsRow: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    paddingTop: 2,
    gap: SP.xs,
  },
  pillsFade: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: SP.sm,
    width: 28,
  },
});
