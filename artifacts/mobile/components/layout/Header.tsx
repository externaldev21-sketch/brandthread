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
 * One header used on every stack screen: consistent back button + right-side
 * actions everywhere, with an optional large title that collapses into the
 * compact bar as the screen scrolls (pass `scrollY` from the screen's
 * ScrollView/FlatList `onScroll`). Screens that don't want the collapsing
 * large title (e.g. modals, short forms) just omit `scrollY`/`largeTitle`
 * and get the plain compact bar.
 */
export function Header({
  title,
  largeTitle,
  onBack,
  showBack = true,
  actions = [],
  scrollY,
  transparent = false,
}: {
  title: string;
  largeTitle?: boolean;
  onBack?: () => void;
  showBack?: boolean;
  actions?: HeaderAction[];
  scrollY?: Animated.Value;
  transparent?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const fallbackScrollY = useRef(new Animated.Value(0)).current;
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
        </Animated.View>
      )}

      <Animated.View style={[styles.hairline, { backgroundColor: theme.border, opacity: borderOpacity }]} />
    </View>
  );
}

/** Bind a screen's scroll offset to an Animated.Value for use with Header's `scrollY`. */
export function useHeaderScrollY() {
  return useRef(new Animated.Value(0)).current;
}

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
    position: Platform.OS === 'web' ? 'relative' : 'absolute',
    top: COMPACT_HEIGHT,
    left: 0,
    right: 0,
  },
  largeTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.h2,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
});
