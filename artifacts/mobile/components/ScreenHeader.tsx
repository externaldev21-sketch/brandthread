import React from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COMP, FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { TYPE_SCALE } from '@/constants/typography';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';

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
  /** Override the spoken back label when the route changes between a list and an inline form. */
  backAccessibilityLabel?: string;
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
  /** Drops the hairline under the header. Off by default so existing call sites are unchanged. */
  hideDivider?: boolean;
}

/** Design-system rule: at most 2 action icons on the right, primary rightmost. */
const MAX_HEADER_ACTIONS = 2;

/**
 * THE one screen-header title size, app-wide — every screen's title sits at
 * this exact size, weight (Inter 700 / FONT.bold), and vertical position
 * (`topPad` below), so titles never visibly differ from one screen to the
 * next. Previously `FS.xl` (22) here, while most hand-rolled headers
 * elsewhere in the app clustered closer to 17-19 — this is a dedicated
 * constant (not a reused `FS.*` token) specifically so nothing else in the
 * app can nudge it by changing an unrelated token's meaning.
 */
const TITLE_SIZE = 20;

export function ScreenHeader({
  title, subtitle, rightElement, actions, scrollY, collapseDistance = 48, onBack, backTestID, backAccessibilityLabel, variant = 'push', hideDivider = false,
}: ScreenHeaderProps) {
  const colors = useColors();
  const cappedActions = actions?.slice(-MAX_HEADER_ACTIONS);
  const router = useRouter();
  const topPad = useHeaderTopInset() + SP.sm;

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

  const closeOrBack = () => (onBack ? onBack() : goBackOr(router));

  return (
    <View testID="screen-header" style={[styles.wrap, { paddingTop: topPad, borderBottomColor: colors.border }, hideDivider && { borderBottomWidth: 0 }]}>
      <View style={styles.container}>
        {variant === 'push' && (
          <PressableScale
            onPress={closeOrBack}
            style={styles.closeBtnPlain}
            accessibilityRole="button"
            accessibilityLabel={backAccessibilityLabel ?? `Go back from ${title}`}
            accessibilityHint={`Returns from ${title}`}
            testID={backTestID ?? 'screen-header-back'}
          >
            <Feather name="arrow-left" size={ICON.md} color={colors.foreground} />
          </PressableScale>
        )}

        <View style={styles.titleBlock}>
          {scrollY ? (
            <Animated.Text
              testID="screen-header-title"
              {...({ dataSet: { variant } } as object)}
              style={[styles.title, { color: colors.foreground, opacity: compactTitleOpacity }]}
              numberOfLines={1}
            >
              {title}
            </Animated.Text>
          ) : (
            <Text testID="screen-header-title" {...({ dataSet: { variant } } as object)} style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
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
          {variant === 'push' && (rightElement ?? (!cappedActions?.length && <View style={{ width: COMP.iconBtn }} />))}
          {variant === 'modal' && (
            <>
              {rightElement}
              <PressableScale
                onPress={closeOrBack}
                style={styles.closeBtnPlain}
                accessibilityRole="button"
                accessibilityLabel={backAccessibilityLabel ?? `Close ${title}`}
                accessibilityHint={`Dismisses ${title}`}
                testID={backTestID ?? 'screen-header-back'}
              >
                <Feather name="x" size={ICON.md} color={colors.foreground} />
              </PressableScale>
            </>
          )}
        </View>
      </View>

      {subtitle && !scrollY && (
        <Text
          style={[
            styles.subtitle,
            {
              color: colors.mutedForeground,
              // Sibling row below `container`, so it needs its own horizontal
              // offset to line up under the title: the container's own gutter
              // (SP.md) plus, for push, the back button's width + gap (44 +
              // SP.sm) that the title itself is indented by in that variant.
              paddingHorizontal: SP.md,
              marginLeft: variant === 'push' ? 44 + SP.sm : 0,
            },
          ]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      )}

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
    // Center the title with the back/close button on the same row. The
    // subtitle no longer lives inside this row (it's a sibling Text below
    // `container`), so it can never affect this row's height or nudge the
    // title's vertical position — that's what keeps title Y identical with
    // or without a subtitle (the #389 invariant), even under center-align.
    alignItems: 'center',
    minHeight: COMP.headerH,
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
    gap: SP.sm,
  },
  closeBtnPlain: {
    // Back (push) / close (modal) button: plain icon, no box/background/
    // border, 44px hit area — the one shared style for both variants' primary
    // dismiss control. Previously push showed a bordered/boxed circular
    // button while modal's close was plain; unified to plain everywhere.
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: TITLE_SIZE,
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
