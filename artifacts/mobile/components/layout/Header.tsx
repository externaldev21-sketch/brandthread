import React, { useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, GUTTER, ICON, SP } from '@/lib/theme';

export type HeaderAction = {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
};

const COMPACT_HEIGHT = 56;
const LARGE_TITLE_HEIGHT = 96;
const COLLAPSE_DISTANCE = LARGE_TITLE_HEIGHT - COMPACT_HEIGHT;

/**
 * Root-page header values — extracted verbatim from Discover's own top bar
 * (the owner's reference for "the one that looks right"): title size/weight/
 * letter-spacing, the exact top offset below the safe area, the left gutter,
 * the row height, and plain (unboxed, unbordered) icon buttons on the right.
 * Every tab-root page renders through this now, Discover included — it no
 * longer has a bespoke header, it just IS this component.
 */
const ROOT_TITLE_SIZE = 20;
const ROOT_TITLE_LETTER_SPACING = -0.4;
const ROOT_TOP_GAP = 12;
const ROOT_WEB_SAFE_TOP = 67;
const ROOT_ROW_HEIGHT = 44;

/**
 * One header used on every stack screen: consistent back button + right-side
 * actions everywhere, with an optional large title that collapses into the
 * compact bar as the screen scrolls (pass `scrollY` from the screen's
 * ScrollView/FlatList `onScroll`). Screens that don't want the collapsing
 * large title (e.g. modals, short forms) just omit `scrollY`/`largeTitle`
 * and get the plain compact bar.
 *
 * `showBack={false}` + `largeTitle` switches to the root-page header
 * described above (Discover/Search/Messages/Cart/Orders/…) — a completely
 * different, simpler layout from the pushed-screen compact bar, not a
 * variant of it, because the root header never collapses on scroll and
 * never carries a back button.
 */
export function Header({
  title,
  subtitle,
  largeTitle,
  onBack,
  showBack = true,
  actions = [],
  scrollY,
  transparent = false,
  belowTitle,
  rightElement,
}: {
  title: string;
  subtitle?: string;
  largeTitle?: boolean;
  onBack?: () => void;
  showBack?: boolean;
  actions?: HeaderAction[];
  scrollY?: Animated.Value;
  transparent?: boolean;
  /** Extra chrome rendered directly under the title at the same gutter (search field, filter row) — root pages only. */
  belowTitle?: React.ReactNode;
  /**
   * A custom right-side accessory instead of plain icon `actions` — for the
   * rare case a page needs something `actions` can't express (e.g. a badged
   * notification bell). Root pages only; rendered where the plain icons
   * would go, same size/position, so it still reads as "the same slot".
   */
  rightElement?: React.ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const fallbackScrollY = useRef(new Animated.Value(0)).current;

  const isRoot = !showBack && largeTitle;

  if (isRoot) {
    const topPad = (Platform.OS === 'web' ? ROOT_WEB_SAFE_TOP : insets.top) + ROOT_TOP_GAP;
    return (
      <View style={[rootStyles.wrap, { paddingTop: topPad, backgroundColor: transparent ? 'transparent' : theme.background }]}>
        <View style={rootStyles.row}>
          <Text numberOfLines={1} style={[rootStyles.title, { color: theme.text }]}>{title}</Text>
          {rightElement ? (
            <View style={rootStyles.actionsRow}>{rightElement}</View>
          ) : actions.length > 0 && (
            <View style={rootStyles.actionsRow}>
              {actions.map((action) => (
                <TouchableOpacity
                  key={action.accessibilityLabel}
                  accessibilityRole="button"
                  accessibilityLabel={action.accessibilityLabel}
                  disabled={action.disabled}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={action.onPress}
                  style={[rootStyles.iconBtn, action.disabled && { opacity: 0.4 }]}
                >
                  <Feather name={action.icon} size={ICON.md} color={theme.text} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        {/* No subtitle unless the page genuinely has one (Discover doesn't) — kept optional for the rare page that needs it. */}
        {subtitle && <Text numberOfLines={2} style={[rootStyles.subtitle, { color: theme.muted }]}>{subtitle}</Text>}
        {belowTitle && <View style={rootStyles.belowTitle}>{belowTitle}</View>}
      </View>
    );
  }

  const y = scrollY ?? fallbackScrollY;

  const compactOpacity = largeTitle
    ? y.interpolate({ inputRange: [COLLAPSE_DISTANCE - 16, COLLAPSE_DISTANCE], outputRange: [0, 1], extrapolate: 'clamp' })
    : 1;
  const largeOpacity = largeTitle
    ? y.interpolate({ inputRange: [0, COLLAPSE_DISTANCE - 8], outputRange: [1, 0], extrapolate: 'clamp' })
    : 0;
  const borderOpacity = largeTitle
    ? y.interpolate({ inputRange: [0, COLLAPSE_DISTANCE], outputRange: [0, 1], extrapolate: 'clamp' })
    : 1;

  const handleBack = onBack ?? (() => router.back());

  return (
    <View
      style={[
        styles.wrap,
        { paddingTop: insets.top, backgroundColor: transparent ? 'transparent' : theme.background },
      ]}
    >
      <View style={[styles.compactRow, { height: COMPACT_HEIGHT }]}>
        {showBack ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={handleBack}
            style={styles.iconBtn}
          >
            <Feather name="chevron-left" size={ICON.lg} color={theme.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}

        <Animated.View style={[styles.compactTitleWrap, { opacity: largeTitle ? compactOpacity : 1 }]}>
          <Text numberOfLines={1} style={[styles.compactTitle, { color: theme.text }]}>{title}</Text>
        </Animated.View>

        <View style={styles.actionsRow}>
          {actions.map((action, i) => (
            <TouchableOpacity
              key={i}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
              disabled={action.disabled}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={action.onPress}
              style={[styles.iconBtn, action.disabled && { opacity: 0.4 }]}
            >
              <Feather name={action.icon} size={ICON.md} color={theme.text} />
            </TouchableOpacity>
          ))}
          {actions.length === 0 && <View style={styles.iconBtn} />}
        </View>
      </View>

      {largeTitle && (
        <Animated.View style={[styles.largeTitleWrap, { opacity: largeOpacity }]}>
          <Text numberOfLines={1} style={[styles.largeTitle, { color: theme.text }]}>{title}</Text>
          {subtitle && <Text numberOfLines={2} style={[styles.subtitle, { color: theme.muted }]}>{subtitle}</Text>}
        </Animated.View>
      )}

      {belowTitle && <View style={styles.belowTitle}>{belowTitle}</View>}

      <Animated.View style={[styles.hairline, { backgroundColor: theme.border, opacity: borderOpacity }]} />
    </View>
  );
}

/** Bind a screen's scroll offset to an Animated.Value for use with Header's `scrollY`. */
export function useHeaderScrollY() {
  return useRef(new Animated.Value(0)).current;
}

/**
 * `Header` under its canonical page-header name. Tab-root pages (Discover,
 * Messages, Search, Orders, Products, Settings, Dashboard, …) render this
 * with `largeTitle showBack={false}` for identical title size/weight/
 * letter-spacing/top-offset everywhere; pushed screens render it with the
 * default `showBack`. One component, two conventions — see file header.
 */
export const PageHeader = Header;

const rootStyles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: ROOT_ROW_HEIGHT,
    paddingHorizontal: GUTTER,
  },
  title: {
    flexShrink: 1,
    fontFamily: FONT.bold,
    fontSize: ROOT_TITLE_SIZE,
    letterSpacing: ROOT_TITLE_LETTER_SPACING,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Plain — no border, no background box, just the icon at a 44pt touch target.
  iconBtn: {
    width: ROOT_ROW_HEIGHT,
    height: ROOT_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    marginTop: 2,
    paddingHorizontal: GUTTER,
  },
  belowTitle: {
    paddingHorizontal: GUTTER,
    paddingTop: SP.sm,
  },
});

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    zIndex: 10,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.sm,
  },
  iconBtn: {
    width: ICON.xl + SP.sm,
    height: ICON.xl + SP.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTitleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  compactTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  largeTitleWrap: {
    paddingHorizontal: GUTTER,
    paddingTop: SP.xs,
    paddingBottom: SP.md,
  },
  largeTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.h2,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    marginTop: SP.xs,
  },
  belowTitle: {
    paddingHorizontal: GUTTER,
    paddingBottom: SP.md,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
});
