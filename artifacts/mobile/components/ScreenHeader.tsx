import React from 'react';
import { Animated, View, Text, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COMP, FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { TYPE_SCALE } from '@/constants/typography';

export interface ScreenHeaderAction {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  badge?: boolean;
}

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
  /** Extra icon-button actions rendered right of `rightElement` (back/action slots). */
  actions?: ScreenHeaderAction[];
  /**
   * Enables a large-title header that shrinks to the compact bar as the
   * screen scrolls, driven by an Animated.Value the screen already uses for
   * its ScrollView's onScroll. Omit to keep the existing compact-only header
   * (the default for every current call site — fully backward compatible).
   */
  scrollY?: Animated.Value;
  /** Scroll distance over which the large title fully collapses. */
  collapseDistance?: number;
  onBack?: () => void;
  /** Optional testID forwarded to the back/close button, for screens whose tests target it directly. */
  backTestID?: string;
  /**
   * 'push' (default) shows the standard back arrow for a stack-pushed screen.
   * 'modal' shows a close "X" instead, for screens presented as a modal/sheet
   * — same position and hit area either way. Pass whichever matches the
   * route's actual `presentation` option; this never changes push vs modal
   * itself, only which icon a screen that already has one shows.
   */
  variant?: 'push' | 'modal';
}

/** Design-system rule: at most 2 action icons on the right, primary rightmost. */
const MAX_HEADER_ACTIONS = 2;

export function ScreenHeader({
  title, subtitle, rightElement, actions, scrollY, collapseDistance = 48, onBack, backTestID, variant = 'push',
}: ScreenHeaderProps) {
  const colors = useColors();
  const cappedActions = actions?.slice(-MAX_HEADER_ACTIONS);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web'
    ? SP.xxl + SP.md + SP.xs
    : insets.top + SP.sm;

  const largeTitleOpacity = scrollY
    ? scrollY.interpolate({ inputRange: [0, collapseDistance], outputRange: [1, 0], extrapolate: 'clamp' })
    : null;
  const largeTitleScale = scrollY
    ? scrollY.interpolate({ inputRange: [0, collapseDistance], outputRange: [1, 0.9], extrapolate: 'clamp' })
    : null;
  const largeTitleHeight = scrollY
    ? scrollY.interpolate({ inputRange: [0, collapseDistance], outputRange: [40, 0], extrapolate: 'clamp' })
    : null;
  const compactTitleOpacity = scrollY
    ? scrollY.interpolate({ inputRange: [collapseDistance * 0.5, collapseDistance], outputRange: [0, 1], extrapolate: 'clamp' })
    : 1;

  return (
    <View style={[styles.wrap, { paddingTop: topPad, borderBottomColor: colors.border }]}>
      <View style={styles.container}>
        <PressableScale
          onPress={() => (onBack ? onBack() : router.back())}
          style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={variant === 'modal' ? `Close ${title}` : `Go back from ${title}`}
          accessibilityHint={variant === 'modal' ? `Dismisses ${title}` : `Returns from ${title}`}
          testID={backTestID}
        >
          <Feather name={variant === 'modal' ? 'x' : 'arrow-left'} size={ICON.md} color={colors.foreground} />
        </PressableScale>

        <View style={styles.titleBlock}>
          {scrollY ? (
            <Animated.Text
              style={[styles.title, { color: colors.foreground, opacity: compactTitleOpacity }]}
              numberOfLines={1}
            >
              {title}
            </Animated.Text>
          ) : (
            <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
          )}
          {subtitle && !scrollY && (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{subtitle}</Text>
          )}
        </View>

        <View style={styles.rightSlot}>
          {cappedActions?.map((action) => (
            <PressableScale
              key={action.accessibilityLabel}
              onPress={action.onPress}
              style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
            >
              <Feather name={action.icon} size={ICON.sm} color={colors.foreground} />
              {action.badge && <View style={[styles.actionDot, { backgroundColor: colors.primary, borderColor: colors.background }]} />}
            </PressableScale>
          ))}
          {rightElement ?? (!cappedActions?.length && <View style={{ width: COMP.iconBtn }} />)}
        </View>
      </View>

      {scrollY && (
        <Animated.View style={{ opacity: largeTitleOpacity!, transform: [{ scale: largeTitleScale! }], height: largeTitleHeight!, overflow: 'hidden' }}>
          <View style={styles.largeTitleWrap}>
            <Text style={[TYPE_SCALE.title1, { color: colors.foreground, fontFamily: FONT.bold }]} numberOfLines={1}>{title}</Text>
            {subtitle && <Text style={[styles.subtitle, { color: colors.mutedForeground, marginTop: 2 }]} numberOfLines={1}>{subtitle}</Text>}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: COMP.headerH,
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
    gap: SP.sm,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    marginTop: SP.xs,
  },
  rightSlot: {
    minWidth: COMP.iconBtn,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: SP.xs,
  },
  largeTitleWrap: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
});
