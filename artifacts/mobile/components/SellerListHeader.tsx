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
import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COMP, FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FilterChip, PressableScale, SearchBar } from '@/components/BrandthreadUI';
import { haptics } from '@/lib/haptics';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface SellerListHeaderAction {
  icon: IconName;
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

/** A real, working alternate view for the title dropdown — never a filter
 *  already exposed as a status chip below (that would be a second control
 *  for the same thing) and never a route/screen that doesn't actually
 *  exist yet. See each screen's own call site for what's real for it. */
export interface SellerListHeaderMenuOption {
  key: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}

export interface SellerListHeaderProps {
  title: string;
  /** Omit (or pass an empty array) when there is nothing real to switch
   *  to — the title then renders as plain static text with no chevron,
   *  rather than an affordance that opens a menu leading nowhere. */
  titleMenu?: SellerListHeaderMenuOption[];
  titleAccessibilityLabel?: string;
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
  title, titleMenu, titleAccessibilityLabel, actions,
  searchValue, onSearchChange, searchPlaceholder,
  onFilterPress, hasActiveFilter, filterAccessibilityLabel,
  onSortPress, sortAccessibilityLabel,
  chips,
}: SellerListHeaderProps) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const hasMenu = !!titleMenu && titleMenu.length > 0;
  const titleWrapRef = useRef<View>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);

  function openTitleMenu() {
    titleWrapRef.current?.measureInWindow((x, y, _width, height) => {
      setMenuAnchor({ x, y: y + height + 6 });
    });
  }

  function closeTitleMenu() {
    setMenuAnchor(null);
  }

  return (
    <View>
      {/* Title row */}
      <View style={s.titleRow}>
        <View ref={titleWrapRef} collapsable={false}>
          {hasMenu ? (
            <PressableScale
              style={s.titleBtn}
              onPress={openTitleMenu}
              accessibilityLabel={titleAccessibilityLabel ?? `${title}, choose a view`}
              accessibilityRole="button"
            >
              <Text style={[s.titleText, { color: theme.text }]}>{title}</Text>
              <Icon name="chevron-down" size={18} color={theme.muted} />
            </PressableScale>
          ) : (
            <View style={s.titleBtn}>
              <Text style={[s.titleText, { color: theme.text }]}>{title}</Text>
            </View>
          )}
        </View>
        <View style={s.titleActions}>
          {actions.map((action) => (
            <PressableScale
              key={action.accessibilityLabel}
              style={s.headerIconBtn}
              onPress={action.onPress}
              accessibilityLabel={action.accessibilityLabel}
            >
              <Icon name={action.icon} size={ICON.md} color={theme.text} />
            </PressableScale>
          ))}
        </View>
      </View>

      {hasMenu && (
        <Modal
          visible={!!menuAnchor}
          transparent
          animationType="fade"
          onRequestClose={closeTitleMenu}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closeTitleMenu} accessibilityLabel="Close menu" />
          {menuAnchor && (
            <View
              style={[
                s.titleMenu,
                {
                  top: menuAnchor.y,
                  left: menuAnchor.x,
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  shadowColor: theme.shadowColor,
                },
              ]}
            >
              {titleMenu!.map((option) => (
                <PressableScale
                  key={option.key}
                  style={s.titleMenuRow}
                  onPress={() => {
                    haptics.selection();
                    closeTitleMenu();
                    option.onSelect();
                  }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: option.selected }}
                  accessibilityLabel={option.label}
                >
                  <Text style={[s.titleMenuLabel, { color: theme.text }]}>{option.label}</Text>
                  {option.selected && <Icon name="check" size={16} color={theme.text} />}
                </PressableScale>
              ))}
            </View>
          )}
        </Modal>
      )}

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
          <Icon name="sliders" size={14} color={hasActiveFilter ? theme.accentLight : theme.muted} />
        </PressableScale>
        <PressableScale
          style={s.controlBtn}
          onPress={onSortPress}
          accessibilityLabel={sortAccessibilityLabel}
        >
          <Icon name="chevrons-down" size={14} color={theme.muted} />
        </PressableScale>
      </View>

      {/* Status chips — horizontal scroll, edge-to-edge. `pillsRow`'s own
          horizontal padding is what lets the last chip clip naturally at
          the screen edge as a scroll affordance — no gradient overlay on
          top of the chips (a previous `GRAD_DARK_FADE` scrim here went
          fully opaque at its own edge, painting a solid black block over
          the last chip instead of fading it). */}
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
    fontSize: FS.lg,
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
    // 44x44: PressableScale's own accessibility floor already renders these
    // at 44pt tall regardless of this height value, so keeping the width
    // narrower than that (36) left a 36x44 rectangle short of the 44x44
    // minimum comfortable touch target — width now matches.
    width: 44,
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
  titleMenu: {
    position: 'absolute',
    minWidth: 190,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingVertical: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  titleMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP.md,
    paddingHorizontal: SP.md,
    minHeight: 44,
  },
  titleMenuLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
});
