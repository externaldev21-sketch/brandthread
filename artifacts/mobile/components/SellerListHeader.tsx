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
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COMP, FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
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
  showChipSlider?: boolean;
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
  chips, showChipSlider = false,
}: SellerListHeaderProps) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const chipsRef = React.useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = React.useState(0);
  const [contentWidth, setContentWidth] = React.useState(0);
  const [scrollX, setScrollX] = React.useState(0);
  const [trackWidth, setTrackWidth] = React.useState(0);
  const maxScroll = Math.max(0, contentWidth - viewportWidth);
  const thumbWidth = trackWidth > 0 && contentWidth > 0
    ? Math.min(trackWidth, Math.max(44, trackWidth * viewportWidth / contentWidth))
    : 0;
  const thumbTravel = Math.max(0, trackWidth - thumbWidth);
  const thumbLeft = maxScroll > 0 ? Math.min(thumbTravel, scrollX / maxScroll * thumbTravel) : 0;
  const sliderMetrics = React.useRef({ maxScroll, thumbTravel, thumbWidth, scrollX });
  sliderMetrics.current = { maxScroll, thumbTravel, thumbWidth, scrollX };
  const dragStartX = React.useRef(0);

  const slideTo = (x: number) => {
    const offset = Math.max(0, Math.min(sliderMetrics.current.maxScroll, x));
    chipsRef.current?.scrollTo({ x: offset, animated: false });
    setScrollX(offset);
  };
  const thumbPan = React.useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStartX.current = sliderMetrics.current.scrollX; },
    onPanResponderMove: (_, gesture) => {
      const { maxScroll: max, thumbTravel: travel } = sliderMetrics.current;
      if (travel > 0) slideTo(dragStartX.current + gesture.dx * max / travel);
    },
  })).current;

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

      {/* Chips stay swipeable; Products also has a persistent draggable
          scrollbar so off-screen filters are discoverable and reachable. */}
      <ScrollView
        ref={chipsRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.pillsRow}
        onLayout={event => setViewportWidth(event.nativeEvent.layout.width)}
        onContentSizeChange={width => setContentWidth(width)}
        onScroll={event => setScrollX(event.nativeEvent.contentOffset.x)}
        scrollEventThrottle={16}
      >
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
      {showChipSlider && maxScroll > 1 && (
        <View style={s.sliderPadding}>
          <Pressable
            style={s.sliderTouch}
            onPress={event => {
              const { maxScroll: max, thumbTravel: travel, thumbWidth: thumb } = sliderMetrics.current;
              if (travel > 0) slideTo((event.nativeEvent.locationX - thumb / 2) * max / travel);
            }}
            accessibilityRole="adjustable"
            accessibilityLabel="Scroll product filters"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(scrollX / maxScroll * 100) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={event => slideTo(scrollX + (event.nativeEvent.actionName === 'increment' ? viewportWidth * 0.75 : -viewportWidth * 0.75))}
          >
            <View style={s.sliderTrack} onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}>
              <View style={s.sliderLine} />
              <View {...thumbPan.panHandlers} style={[s.sliderThumbTouch, { left: thumbLeft, width: thumbWidth }]}>
                <View style={s.sliderThumb} />
              </View>
            </View>
          </Pressable>
        </View>
      )}
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
  sliderPadding: { paddingHorizontal: SP.md, paddingBottom: SP.xs },
  sliderTouch: { height: 24, justifyContent: 'center' },
  sliderTrack: { height: 24, justifyContent: 'center' },
  sliderLine: { height: 3, borderRadius: RADIUS.sm, backgroundColor: theme.border },
  sliderThumbTouch: { position: 'absolute', top: 0, height: 24, justifyContent: 'center' },
  sliderThumb: { height: 4, borderRadius: RADIUS.sm, backgroundColor: theme.muted },
});
