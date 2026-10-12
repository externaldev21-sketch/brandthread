/**
 * Brandthread Shared UI Components
 *
 * Every Seller screen should import from here.
 * Do not create one-off buttons, cards or headers in individual screen files.
 */

import React, { useRef, useState, useEffect, createContext, useContext, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, ActivityIndicator, Animated, Platform,
  ViewStyle, TextStyle, StyleProp, Pressable,
  SwitchProps, PressableProps, LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line as SvgLine } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, SCREEN_BG, SURFACE, CARD, CARD_ELEVATED,
  SURFACE_GLASS, CARD_GLASS, CARD_ELEVATED_GLASS, SKELETON_GLASS,
  BORDER, BORDER_ACTIVE, BORDER_FOCUS,
  FG, MUTED, SUBTLE,
  SUCCESS, SUCCESS_DIM,
  BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM, FILL_ELEVATED,
  SHADOW, SHADOW_SM,
} from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { hapticLight, hapticMedium, hapticSelection } from '@/lib/haptics';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { undoExpiresAt } from '@/lib/undoRecovery';
import { PRESS_SCALE, PRESS_DURATION_MS } from '@/constants/motion';
import { useSettled } from '@/lib/animationUtils';
import type { ThreadMotif } from '@/components/illustrations/EmptyStateArt';
import { a11yHidden } from '@/lib/a11yHidden';
import { iconAccessibilityLabel } from '@/lib/a11y/iconLabels';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import { EmptyStateBadge, EMPTY_STATE_BADGE_SIZE } from '@/components/layout/EmptyStateBadge';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useFocusedAnimationLoop } from '@/lib/useFocusedAnimationLoop';
import { radius } from '@/constants/radii';
import { Icon, type IconName } from '@/components/ui/Icon';

// ─── Shared undo action/toast ─────────────────────────────────────────────────
// Mutations remain responsible for their own server/local rollback. This provider
// only owns the short-lived, accessible action affordance and its expiry.
export interface UndoAction {
  message: string;
  undo: () => void | Promise<void>;
  durationMs?: number;
  /** 'monochrome' draws "Undo" in the text colour instead of the success
   *  green (Activity, item 83). Existing callers are unchanged. */
  tone?: 'monochrome';
  /** Optional testID on the toast (for verification scripts). */
  testID?: string;
  /** Distance from the bottom edge; lets a screen with the floating tab bar
   *  sit the toast above it instead of over it. Defaults to the usual spot. */
  bottom?: number;
}
type UndoToastContextValue = { showUndo: (action: UndoAction) => void; dismissUndo: () => void };
const UndoToastContext = createContext<UndoToastContextValue | null>(null);

export function UndoToastProvider({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const [action, setAction] = useState<UndoAction | null>(null);
  const [undoing, setUndoing] = useState(false);
  useEffect(() => {
    if (!action) return;
    const expiresAt = undoExpiresAt(Date.now(), action.durationMs ?? 6000);
    const timer = setTimeout(() => setAction(null), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [action]);
  const dismissUndo = useCallback(() => setAction(null), []);
  const showUndo = useCallback((next: UndoAction) => { setUndoing(false); setAction(next); }, []);
  const undo = useCallback(async () => {
    if (!action || undoing) return;
    setUndoing(true);
    try { await action.undo(); setAction(null); } finally { setUndoing(false); }
  }, [action, undoing]);
  return (
    <UndoToastContext.Provider value={{ showUndo, dismissUndo }}>
      {children}
      {action && (
        <View accessibilityLiveRegion="polite" testID={action.testID} style={[undoS.root, { backgroundColor: colors.elevated, borderColor: colors.border }, action.bottom != null && { bottom: action.bottom }]}>
          <Text style={[undoS.message, { color: colors.foreground }]}>{action.message}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Undo: ${action.message}`} onPress={undo} disabled={undoing} style={undoS.button}>
            <Text style={[undoS.buttonText, { color: action.tone === 'monochrome' ? colors.foreground : colors.success }]}>{undoing ? 'Restoring…' : 'Undo'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </UndoToastContext.Provider>
  );
}
const undoS = StyleSheet.create({
  root: { position: 'absolute', left: SP.md, right: SP.md, bottom: SP.xl, minHeight: 52, borderRadius: RADIUS.md, backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER_ACTIVE, paddingHorizontal: SP.md, flexDirection: 'row', alignItems: 'center', gap: SP.sm, zIndex: 1000, elevation: 1000 },
  message: { flex: 1, color: FG, fontFamily: FONT.medium, fontSize: FS.sm },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: SP.sm },
  buttonText: { color: SUCCESS, fontFamily: FONT.bold, fontSize: FS.sm },
});
export function useUndoToast(): UndoToastContextValue {
  const value = useContext(UndoToastContext);
  if (!value) throw new Error('useUndoToast must be used inside UndoToastProvider');
  return value;
}

// ─── Reusable Motion Primitives ───────────────────────────────────────────────

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  /** Optional so a purely-tappable overlay (e.g. a full-screen dismiss backdrop) doesn't need a dummy child. */
  children?: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  activeScale?: number;
  activeOpacity?: number;
  /** Opt out of the Android/web ripple circle while keeping the scale+opacity
   *  press feel. Defaults to `true` (the existing global behavior) so every
   *  other call site is unaffected — set `false` on a per-screen basis where
   *  the ripple reads as an unwanted "translucent grey circle" (e.g. the
   *  buyer Messages screens). */
  rippleEnabled?: boolean;
  /** Set true to opt IN to the old springy rebound on release. Defaults to
   *  false: a plain, no-overshoot timing animation (PRESS_DURATION_MS, see
   *  constants/motion.ts) — the app-wide press-feedback standard. Only set
   *  true where a screen deliberately wants a physical, springy rebound. */
  bounce?: boolean;
  /** Opt out of the forced `minHeight: COMP.minTouchTarget` (44pt) box this
   *  component otherwise always applies last in its style array — silently
   *  overriding any smaller height/minHeight the caller set. Needed for
   *  tightly-spaced rows (e.g. a comment's inline "Reply"/like/view-replies
   *  controls) where a real 44pt floor would balloon the row far past its
   *  visual content. Defaults to false so every other call site is
   *  unaffected; the tap area itself can still be widened with `hitSlop`. */
  noMinHeight?: boolean;
}

// Press feel shared by every button and card: a quick, firm squish on touch
// and a plain (non-spring) release back to rest, ~PRESS_DURATION_MS — no
// overshoot/bounce, per the app-wide press-feedback standard. `bounce: true`
// opts a call site back into the old springy rebound below.
const NATIVE_DRIVER = Platform.OS !== 'web';
const PRESS_IN_SPRING = { speed: 48, bounciness: 0, useNativeDriver: NATIVE_DRIVER } as const;
const PRESS_OUT_SPRING = { speed: 14, bounciness: 11, useNativeDriver: NATIVE_DRIVER } as const;

export function PressableScale({ children, onPress, style, disabled, hitSlop, activeScale = PRESS_SCALE, activeOpacity = 0.88, rippleEnabled = true, bounce = false, noMinHeight = false, ...rest }: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const { theme } = useAppTheme();
  // Auto hit-slop: pads a visually-small control's TAP area up to the 44x44
  // minimum comfortable touch target without changing its rendered size —
  // hitSlop only extends where taps are still recognized, it never affects
  // layout or appearance. Measured once the rendered box is known (onLayout)
  // and only applied when the caller hasn't already set their own hitSlop
  // (an explicit hitSlop always wins, including `undefined` padding meaning
  // "none" is not distinguishable from "not set yet" — callers that need
  // exactly zero hitSlop are rare enough that this default is the safer
  // choice for the ~100 call sites that set none today).
  const [autoHitSlop, setAutoHitSlop] = useState<{ top: number; bottom: number; left: number; right: number } | undefined>(undefined);
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    if (hitSlop !== undefined) return;
    const { width, height } = e.nativeEvent.layout;
    const padX = Math.max(0, (COMP.minTouchTarget - width) / 2);
    const padY = Math.max(0, (COMP.minTouchTarget - height) / 2);
    setAutoHitSlop(previous => {
      if (padX === 0 && padY === 0) return undefined;
      // Repeated layout notifications must not allocate new state and trigger
      // another render when the touch target hasn't actually changed.
      if (previous?.top === padY && previous.left === padX) return previous;
      return { top: padY, bottom: padY, left: padX, right: padX };
    });
  }, [hitSlop]);
  // Text-crispness fix: this wrapper used to carry `transform: [{ scale }]`
  // (plus `opacity`) unconditionally, even fully at rest (scale===1,
  // opacity===1) — an identity transform still forces react-native-web to
  // promote the node to its own compositing layer (see lib/animationUtils.ts),
  // and with ~100 call sites wrapping button/row labels app-wide, this was
  // the single biggest source of "blurry text" reports: virtually every
  // pressable label in the app sat on a permanently-promoted layer. Fixed
  // the same way this app's other classic-Animated press effects do (see
  // OrderSuccessSheet.tsx, motion/SheetRise.tsx): `useSettled` drops the
  // `transform`/`opacity` keys entirely once the release animation has
  // actually reached scale=1/opacity=1, instead of leaving them set forever.
  // Starts settled (`true`) since scale/opacity both start at their identity
  // values on mount.
  const settled = useSettled(true);

  return (
    <Pressable
      {...rest}
      accessibilityRole={rest.accessibilityRole ?? 'button'}
      accessibilityState={disabled ? { disabled: true, ...rest.accessibilityState } : rest.accessibilityState}
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop ?? autoHitSlop}
      android_ripple={rippleEnabled ? { color: `${theme.accent}2E`, borderless: false } : undefined}
      onPressIn={(e) => {
        // Not settled for the whole pressed duration — the visible
        // squish/dim genuinely needs the transform/opacity to render.
        settled.unsettle();
        Animated.parallel([
          bounce
            ? Animated.spring(scale, { toValue: activeScale, ...PRESS_IN_SPRING })
            : Animated.timing(scale, { toValue: activeScale, duration: PRESS_DURATION_MS, useNativeDriver: NATIVE_DRIVER }),
          Animated.timing(opacity, { toValue: activeOpacity, duration: PRESS_DURATION_MS, useNativeDriver: NATIVE_DRIVER }),
        ]).start();
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        // `settled.run` marks this settled again only once the release
        // animation actually finishes at scale=1/opacity=1 — the true rest
        // state — not before.
        settled.run(
          Animated.parallel([
            bounce
              ? Animated.spring(scale, { toValue: 1, ...PRESS_OUT_SPRING })
              : Animated.timing(scale, { toValue: 1, duration: PRESS_DURATION_MS, useNativeDriver: NATIVE_DRIVER }),
            Animated.timing(opacity, { toValue: 1, duration: PRESS_DURATION_MS, useNativeDriver: NATIVE_DRIVER }),
          ]),
        );
        rest.onPressOut?.(e);
      }}
      style={typeof style === 'function' ? style : undefined}
    >
      {(state) => (
        <Animated.View
          onLayout={(e) => { handleLayout(e); rest.onLayout?.(e); }}
          style={[typeof style === 'function' ? undefined : style, !noMinHeight && { minHeight: COMP.minTouchTarget }, !settled.value && { transform: [{ scale }], opacity }]}>
          {typeof children === 'function' ? children(state) : children}
        </Animated.View>
      )}
    </Pressable>
  );
}

interface AnimatedEntranceProps {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AnimatedEntrance({
  children,
  delay = 0,
  distance = SP.sm,
  disabled = false,
  style,
}: AnimatedEntranceProps) {
  const progress = useRef(new Animated.Value(disabled ? 1 : 0)).current;

  useEffect(() => {
    if (disabled) {
      progress.setValue(1);
      return;
    }
    // A soft spring rather than a linear fade: content glides up and settles.
    Animated.spring(progress, {
      toValue: 1,
      delay,
      speed: 11,
      bounciness: 4,
      useNativeDriver: NATIVE_DRIVER,
    }).start();
  }, [delay, disabled, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [distance, 0],
            }),
          }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ─── BrandthreadScreen ────────────────────────────────────────────────────────

interface BrandthreadScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  noSafeTop?: boolean;
  noSafeBottom?: boolean;
}

export function BrandthreadScreen({
  children, style, scrollable = false, noSafeTop = false, noSafeBottom = false,
}: BrandthreadScreenProps) {
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const colors = useColors();
  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: noSafeTop ? 0 : topInset,
    paddingBottom: noSafeBottom ? 0 : 0,
  };
  if (scrollable) {
    return (
      <View style={[containerStyle, style]}>
        <KeyboardAwareScrollViewCompat
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, SP.md) + COMP.tabBarH + SP.md }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          bottomOffset={24}
        >
          {children}
        </KeyboardAwareScrollViewCompat>
      </View>
    );
  }
  return <View style={[containerStyle, style]}>{children}</View>;
}

// ─── BrandthreadHeader ────────────────────────────────────────────────────────

interface BrandthreadHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightElement?: React.ReactNode;
  gradient?: boolean;
}

export function BrandthreadHeader({
  title, subtitle, onBack, rightElement, gradient = false,
}: BrandthreadHeaderProps) {
  const { theme } = useAppTheme();
  const colors = useColors();
  return (
    <View style={[hdrS.root, { borderBottomColor: colors.border }]}>
      <View style={hdrS.left}>
        {onBack && (
          <PressableScale
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onBack(); }}
            style={[hdrS.back, { backgroundColor: colors.card }]}
            accessibilityLabel="Back"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="arrow-left" size={ICON.md} color={colors.foreground} />
          </PressableScale>
        )}
        <View>
          {gradient ? (
            <LinearGradient colors={[theme.accent, theme.accentLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={hdrS.gradTitleWrap}>
              <Text accessibilityRole="header" maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[hdrS.gradTitle, { color: theme.accent }]}>{title}</Text>
            </LinearGradient>
          ) : (
            <Text accessibilityRole="header" maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[hdrS.title, { color: colors.foreground }]}>{title}</Text>
          )}
          {subtitle && <Text style={[hdrS.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>}
        </View>
      </View>
      {rightElement && <View style={hdrS.right}>{rightElement}</View>}
    </View>
  );
}

const hdrS = StyleSheet.create({
  root:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: COMP.headerH },
  left:       { flexDirection: 'row', alignItems: 'center', gap: SP.sm, flex: 1 },
  back:       { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
                alignItems: 'center', justifyContent: 'center' },
  title:      { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3 },
  subtitle:   { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginTop: 1 },
  gradTitleWrap: { borderRadius: 0 },
  gradTitle:  { fontSize: FS.xl, fontFamily: FONT.bold },
  right:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
});

// ─── BrandthreadCard ──────────────────────────────────────────────────────────

interface BrandthreadCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  glow?: boolean;
  elevated?: boolean;
}

export function BrandthreadCard({ children, style, onPress, glow = false, elevated = false }: BrandthreadCardProps) {
  const { theme } = useAppTheme();
  const colors = useColors();
  const s: ViewStyle = {
    backgroundColor: elevated ? colors.elevated : colors.card,
    borderRadius: RADIUS.lg,
    // No border: cards sit on black (BRANDTHREAD_DESIGN.md, "Surfaces").
    padding: SP.md,
    ...(glow ? { ...SHADOW, shadowColor: theme.accent } : {}),
  };
  if (onPress) {
    return (
      <PressableScale onPress={onPress} style={[s, style]}>
        {children}
      </PressableScale>
    );
  }
  return <View style={[s, style]}>{children}</View>;
}

// ─── GradientCard ─────────────────────────────────────────────────────────────

interface GradientCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  colors?: readonly [string, string, ...string[]];
  glow?: boolean;
}

export function GradientCard({ children, style, onPress, colors, glow = false }: GradientCardProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const cardColors = colors ?? [theme.accentDim, theme.secondaryDim] as const;
  const inner = (
    <LinearGradient
      colors={cardColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[gcS.card, glow && { ...SHADOW, shadowColor: theme.accent } as ViewStyle, style]}
    >
      {children}
    </LinearGradient>
  );
  if (onPress) {
    return (
      <PressableScale onPress={onPress}>
        {inner}
      </PressableScale>
    );
  }
  return inner;
}

const gcS = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, padding: SP.md, overflow: 'hidden' },
});

// ─── PrimaryButton ────────────────────────────────────────────────────────────

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  colors?: readonly [string, string, ...string[]];
  testID?: string;
}

export function PrimaryButton({
  label, onPress, icon, loading, disabled, small, style, colors, testID,
}: PrimaryButtonProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const buttonColors = colors ?? theme.primaryGradient;
  const foreground = theme.onAccent;
  const onAccentTextStyle = getOnAccentTextStyle(theme);
  const h = small ? COMP.buttonHSm : COMP.buttonH;
  return (
    <PressableScale
      onPress={() => {
        if (disabled || loading) return;
        hapticMedium();
        onPress();
      }}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      // The button's own height is the variant height (52 / 44 small) unless
      // the caller's `style` sets a slimmer one — so PressableScale's forced
      // 44pt minimum is skipped here (its auto hit-slop still pads the TAP
      // area back up to 44pt; only the drawn box gets slimmer).
      style={[{ borderRadius: RADIUS.md, overflow: 'hidden', height: h }, style]}
      noMinHeight
      testID={testID}
    >
      <LinearGradient
        colors={disabled ? [palette.elevated, palette.elevated] : buttonColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[pbS.inner, { height: '100%' }]}
      >
        {loading ? (
          <ActivityIndicator color={disabled ? palette.mutedForeground : foreground} size="small" />
        ) : (
          <>
            {icon && <Icon name={icon} size={ICON.sm} color={disabled ? palette.mutedForeground : foreground} />}
            <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[pbS.label, disabled ? { color: palette.mutedForeground, fontSize: small ? FS.sm : FS.base, opacity: 0.5 } : [onAccentTextStyle, { fontSize: small ? FS.sm : FS.base }]]} numberOfLines={1}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </PressableScale>
  );
}

// Equal inner padding on both sides (Dev's text-fit rule: >= 12px in a
// button) so a button sized to its own content never runs its label into
// the rounded edge — the outer `overflow: 'hidden'` used to clip the last
// glyph of "Add a product" on the Dashboard's setup card, whose label ended
// flush with the gradient's right edge. A full-width button is unaffected
// (its label was already centred with room to spare). The gradient fills
// the outer box's height (`height: '100%'`) so a caller can pass a slimmer
// `height` in `style` and the fill follows.
const BUTTON_INNER_PADDING_X = SP.md;
const pbS = StyleSheet.create({
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingHorizontal: BUTTON_INNER_PADDING_X },
  label: { fontFamily: FONT.bold, letterSpacing: 0.2 },
});

// ─── SecondaryButton ──────────────────────────────────────────────────────────

interface SecondaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accent?: string;
}

export function SecondaryButton({ label, onPress, icon, disabled, small, style, accent }: SecondaryButtonProps) {
  const { theme } = useAppTheme();
  const resolvedAccent = accent ?? theme.accent;
  const h = small ? COMP.buttonHSm : COMP.buttonH;
  return (
    <PressableScale
      onPress={() => {
        if (disabled) return;
        hapticLight();
        onPress();
      }}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[sbS.root, { height: h, borderColor: resolvedAccent + '55', backgroundColor: resolvedAccent + '14', opacity: disabled ? 0.5 : 1 }, style]}
    >
      {icon && <Icon name={icon} size={ICON.sm} color={resolvedAccent} />}
      <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[sbS.label, { fontSize: small ? FS.sm : FS.base, color: resolvedAccent }]} numberOfLines={1}>{label}</Text>
    </PressableScale>
  );
}

const sbS = StyleSheet.create({
  root:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingHorizontal: BUTTON_INNER_PADDING_X,
           borderRadius: RADIUS.md, borderWidth: 1, backgroundColor: 'rgba(199,205,213,0.08)' },
  label: { fontFamily: FONT.semibold },
});

// ─── TertiaryButton ───────────────────────────────────────────────────────────

interface TertiaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accent?: string;
}

export function TertiaryButton({ label, onPress, icon, disabled, small, style, accent }: TertiaryButtonProps) {
  const { theme } = useAppTheme();
  const resolvedAccent = accent ?? theme.accentLight;
  const h = small ? COMP.buttonHSm : COMP.buttonH;
  return (
    <PressableScale
      onPress={() => {
        if (disabled) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[{ height: h, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingHorizontal: BUTTON_INNER_PADDING_X, opacity: disabled ? 0.4 : 1 }, style]}
    >
      {icon && <Icon name={icon} size={ICON.sm} color={resolvedAccent} />}
      <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={{ fontFamily: FONT.semibold, fontSize: small ? FS.sm : FS.base, color: resolvedAccent }} numberOfLines={1}>{label}</Text>
    </PressableScale>
  );
}

// ─── IconButton ───────────────────────────────────────────────────────────────

interface IconButtonProps {
  name: IconName;
  onPress: () => void;
  color?: string;
  size?: number;
  badge?: boolean;
  badgeCount?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ name, onPress, color = FG, size = ICON.md, badge, badgeCount, accessibilityLabel, accessibilityHint, style }: IconButtonProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const label = accessibilityLabel ?? `${iconAccessibilityLabel(name)}${badgeCount ? `, ${badgeCount} notifications` : ''}`;
  return (
    <PressableScale
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={[ibS.root, { backgroundColor: palette.card }, style]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Icon name={name} size={size} color={color} />
      {badge && (
        <View style={[ibS.badge, { backgroundColor: theme.accent }]}>
          {badgeCount !== undefined && badgeCount > 0
            ? <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[ibS.badgeText, { color: theme.onAccent }]}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
            : null}
        </View>
      )}
    </PressableScale>
  );
}

const ibS = StyleSheet.create({
  root:      { width: COMP.iconBtn, height: COMP.iconBtn, borderRadius: RADIUS.sm, backgroundColor: CARD,
               alignItems: 'center', justifyContent: 'center' },
  badge:     { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: FS.xs, fontFamily: FONT.bold, textAlign: 'center' },
});

// ─── SearchBar ────────────────────────────────────────────────────────────────

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  onFocus?: () => void;
  onBlur?: () => void;
}

export function SearchBar({ value, onChange, placeholder = 'Search…', style, onFocus, onBlur }: SearchBarProps) {
  const [focused, setFocused] = useState(false);
  const { theme } = useAppTheme();
  const palette = useColors();
  return (
    <View style={[srS.root, focused && srS.focused, style]}>
      <Icon name="search" size={ICON.sm} color={focused ? theme.accentLight : palette.mutedForeground} />
      <TextInput
        style={[srS.input, { color: palette.foreground }, WEB_INPUT_RESET]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.subtle}
        accessibilityLabel={placeholder}
        accessibilityRole="search"
        onFocus={() => { setFocused(true); onFocus?.(); }}
        onBlur={() => { setFocused(false); onBlur?.(); }}
        returnKeyType="search"
      />
      {value.length > 0 && (
        <PressableScale
          onPress={() => onChange('')}
          accessibilityLabel="Clear search"
          accessibilityHint="Removes the current search text"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="x" size={ICON.sm} color={palette.mutedForeground} />
        </PressableScale>
      )}
    </View>
  );
}

const srS = StyleSheet.create({
  // The one solid near-black fill inputs may use (Dev's addendum to
  // BRANDTHREAD_DESIGN.md).
  root:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: FILL_ELEVATED,
             borderRadius: RADIUS.md, borderWidth: 0,
             paddingHorizontal: SP.md, height: COMP.inputH - 4 },
  // Focused state stays the same pill as unfocused — no border/box appears,
  // at rest or on focus (borderWidth is 0 above, not just transparent).
  // Only a subtle (still solid) fill change signals focus.
  focused: { backgroundColor: '#2C2C2E' },
  input:   { flex: 1, fontSize: FS.base, fontFamily: FONT.regular, color: FG },
});

// ─── FilterChip ───────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
}

export function FilterChip({ label, active, onPress, count }: FilterChipProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  return (
    <PressableScale
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      accessibilityLabel={count !== undefined ? `${label}, ${count}` : label}
      accessibilityState={{ selected: active }}
      style={[fcS.chip, { backgroundColor: palette.card, borderColor: palette.border }, active && [fcS.active, { backgroundColor: theme.accent, borderColor: theme.accent }]]}
    >
      <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[fcS.label, { color: palette.mutedForeground }, active && [fcS.activeLabel, { color: theme.onAccent }]]}>{label}</Text>
      {count !== undefined && (
        <View style={[fcS.count, active && [fcS.activeCount, { backgroundColor: `${theme.onAccent}26` }]]}>
          <Text style={[fcS.countText, { color: palette.mutedForeground }, active && [fcS.activeCountText, { color: theme.onAccent }]]}>{count}</Text>
        </View>
      )}
    </PressableScale>
  );
}

const fcS = StyleSheet.create({
  chip:         { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, height: 34,
                  borderRadius: radius.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  active:       { borderColor: BORDER_ACTIVE },
  label:        { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  activeLabel:  { fontFamily: FONT.semibold },
  count:        { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.pill, paddingHorizontal: 5, paddingVertical: 1 },
  activeCount:  {},
  countText:    { fontSize: FS.xs, fontFamily: FONT.bold, color: MUTED },
  activeCountText: {},
});

// ─── StatusBadge ─────────────────────────────────────────────────────────────

type StatusVariant = 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple';

interface StatusBadgeProps {
  label: string;
  variant?: StatusVariant;
  small?: boolean;
}

const STATUS_COLORS: Record<StatusVariant, { bg: string; fg: string }> = {
  success: { bg: SUCCESS_DIM, fg: SUCCESS },
  info:    { bg: BLUE_DIM,    fg: BLUE    },
  warning: { bg: ORANGE_DIM,  fg: ORANGE  },
  error:   { bg: RED_DIM,     fg: RED     },
  neutral: { bg: 'rgba(255,255,255,0.06)', fg: MUTED },
  purple:  { bg: 'transparent', fg: FG },
};

export function StatusBadge({ label, variant = 'neutral', small = false }: StatusBadgeProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const c = variant === 'purple' ? { bg: theme.accentDim, fg: theme.accentLight } : variant === 'neutral' ? { bg: palette.accent, fg: palette.mutedForeground } : STATUS_COLORS[variant];
  return (
    <View style={[stS.root, { backgroundColor: c.bg, paddingHorizontal: small ? 8 : 12, paddingVertical: small ? 2 : 4 }]}>
      <Text style={[stS.label, { color: c.fg, fontSize: FS.xs }]}>{label}</Text>
    </View>
  );
}

const stS = StyleSheet.create({
  root:  { borderRadius: RADIUS.pill },
  label: { fontFamily: FONT.bold, letterSpacing: 0.2 },
});

// ─── EmptyState ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: IconName;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
  secondaryAction?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
  /** Drops the illustration for tight spaces, e.g. above an open keyboard. */
  compact?: boolean;
  /** One of the shared thread-motif line illustrations; falls back to `icon` when omitted. */
  illustration?: ThreadMotif;
  /** Diameter of the shared badge (default 64 — the one badge size every
   *  empty state in the app uses). */
  circleSize?: number;
  /** 'fill' (default): the full-width PrimaryButton. 'pill': a slim white
   *  pill sized to its own text (36px tall, equal 16px side padding) — Dev's
   *  spec for the lighter empty states (Content Analytics' "Create post"). */
  actionVariant?: 'fill' | 'pill';
  testID?: string;
}


export function EmptyState({
  icon, title, description, action, secondaryAction, style, compact = false, illustration,
  circleSize = EMPTY_STATE_BADGE_SIZE, actionVariant = 'fill', testID,
}: EmptyStateProps) {
  const { theme } = useAppTheme();
  const colors = useColors();
  // `illustration` is accepted for API compatibility; every empty state now
  // draws the one shared badge (components/layout/EmptyStateBadge.tsx).
  void illustration;
  return (
    <View style={[esS.root, compact && esS.rootCompact, style]} testID={testID}>
      {!compact && <View style={esS.illustration} {...a11yHidden(true)}>
        <EmptyStateBadge icon={icon} size={circleSize} testID={testID ? `${testID}-badge` : undefined} />
      </View>}
      <Text style={[esS.title, { color: colors.foreground }]}>{title}</Text>
      {!!description && (
        <Text style={[esS.desc, { color: colors.mutedForeground }]}>{description}</Text>
      )}
      {action && actionVariant === 'pill' && (
        <PressableScale
          onPress={() => { hapticLight(); action.onPress(); }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={[esS.pill, { backgroundColor: theme.text }]}
          noMinHeight
          testID={testID ? `${testID}-action` : undefined}
        >
          {action.icon && <Icon name={action.icon} size={ICON.sm} color={theme.background} />}
          <Text style={[esS.pillLabel, { color: theme.background }]} numberOfLines={1}>{action.label}</Text>
        </PressableScale>
      )}
      {action && actionVariant === 'fill' && (
        <View style={esS.actions}>
          <PrimaryButton label={action.label} onPress={action.onPress} icon={action.icon} style={esS.btn} />
          {secondaryAction && (
            <SecondaryButton label={secondaryAction.label} onPress={secondaryAction.onPress} style={esS.btn} />
          )}
        </View>
      )}
    </View>
  );
}

const esS = StyleSheet.create({
  root:    { alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl, paddingVertical: SP.xxl, gap: SP.sm },
  rootCompact: { paddingVertical: SP.lg },
  illustration: { alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  title:   { fontSize: FS.lg, fontFamily: FONT.bold, color: FG, textAlign: 'center', letterSpacing: -0.2 },
  desc:    { maxWidth: 330, fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 21 },
  actions: { width: '100%', gap: SP.sm, marginTop: SP.sm },
  btn:     { width: '100%' },
  // Slim, fit-to-text pill: 36px tall, equal 16px side padding, black text
  // on the theme's white (see actionVariant 'pill').
  pill:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, paddingHorizontal: SP.md, borderRadius: 18, alignSelf: 'center' },
  pillLabel: { fontFamily: FONT.semibold, fontSize: FS.sm },
});

export function BrandedLoader({ label = 'Stitching things together…', style }: {
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const pulse = useRef(new Animated.Value(0.72)).current;
  useFocusedAnimationLoop(() => Animated.loop(Animated.sequence([
    Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: NATIVE_DRIVER, isInteraction: false }),
    Animated.timing(pulse, { toValue: 0.72, duration: 650, useNativeDriver: NATIVE_DRIVER, isInteraction: false }),
  ])), [pulse]);
  return (
    <View style={[brLoaderS.root, style]}>
      <Animated.View style={[brLoaderS.mark, { backgroundColor: theme.accentDim, borderColor: theme.accent + '70', opacity: pulse, transform: [{ scale: pulse }] }]}>
        <View style={[brLoaderS.thread, { borderColor: theme.accentLight }]} />
        <Icon name="scissors" size={22} color={theme.accentLight} />
      </Animated.View>
      <Text style={[brLoaderS.label, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

const brLoaderS = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.md, padding: SP.xl },
  mark: { width: 76, height: 76, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  thread: { position: 'absolute', width: 45, height: 45, borderRadius: 23, borderWidth: 1, borderStyle: 'dashed' },
  label: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm, textAlign: 'center' },
});

// ─── SectionHeader ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ title, action, style }: SectionHeaderProps) {
  const { theme } = useAppTheme();
  return (
    <View style={[shS.root, style]}>
      <View style={shS.titleWrap}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[shS.title, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">{title}</Text>
      </View>
      {action && (
        <PressableScale
          onPress={action.onPress}
          accessibilityLabel={action.label}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          // Keeps the action's own box the height of its text — PressableScale
          // otherwise enforces a 44pt minimum touch target on its rendered
          // box, which is taller than the title's row and reads as the
          // action floating on its own lower line. hitSlop above keeps the
          // full tap target for accessibility without the visual height.
          noMinHeight
        >
          <Text style={[shS.action, { color: theme.accentLight }]} numberOfLines={1}>{action.label}</Text>
        </PressableScale>
      )}
    </View>
  );
}

const shS = StyleSheet.create({
  root:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: SP.md, marginBottom: SP.sm },
  // flex:1 + minWidth:0 lets the title shrink and ellipsize instead of
  // pushing the sibling action off screen — RN/web flexbox items default to
  // minWidth:auto, which otherwise forces the row wider than the container.
  titleWrap: { flex: 1, minWidth: 0, marginRight: SP.sm },
  // Sentence case, 17 semibold, white, left-aligned (BRANDTHREAD_DESIGN.md).
  title:  { fontSize: 17, lineHeight: 22, fontFamily: FONT.semibold, color: FG },
  action: { fontSize: FS.sm, fontFamily: FONT.medium, flexShrink: 0 },
});

// ─── StatCard ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  icon: IconName;
  change?: string;
  positive?: boolean;
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatCard({ label, value, icon, change, positive, accent, style }: StatCardProps) {
  const { theme } = useAppTheme();
  const resolvedAccent = accent ?? theme.accent;
  return (
    <BrandthreadCard style={[scS.root, style]}>
      <View style={[scS.iconWrap, { backgroundColor: resolvedAccent + '18' }]}>
        <Icon name={icon} size={ICON.sm} color={resolvedAccent} />
      </View>
      <Text style={[scS.value, { color: theme.text }]}>{value}</Text>
      <Text style={[scS.label, { color: theme.muted }]}>{label}</Text>
      {change && (
        <View style={scS.changeRow}>
          <Icon name={positive ? 'trending-up' : 'trending-down'} size={10} color={positive ? SUCCESS : RED} />
          <Text style={[scS.change, { color: positive ? SUCCESS : RED }]}>{change}</Text>
        </View>
      )}
    </BrandthreadCard>
  );
}

const scS = StyleSheet.create({
  root:     { gap: 4, minWidth: 90 },
  iconWrap: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  value:    { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, letterSpacing: -0.5 },
  label:    { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  changeRow:{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  change:   { fontSize: FS.xs, fontFamily: FONT.semibold },
});

// ─── QuickActionCard ──────────────────────────────────────────────────────────

interface QuickActionCardProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  accent?: string;
  badge?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function QuickActionCard({ icon, label, onPress, accent, badge, style }: QuickActionCardProps) {
  const { theme } = useAppTheme();
  const resolvedAccent = accent ?? theme.accent;
  return (
    <PressableScale
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={[qaS.root, { backgroundColor: theme.card }, style]}
      testID={`quick-action-card-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <View style={[qaS.iconWrap, { backgroundColor: resolvedAccent + '18' }]}>
        <Icon name={icon} size={ICON.md} color={resolvedAccent} />
        {badge && <View style={[qaS.dot, { backgroundColor: theme.accent }]} />}
      </View>
      <Text
        style={[qaS.label, { color: theme.muted }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.9}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

const qaS = StyleSheet.create({
  root:    { width: '100%', minWidth: 0, alignItems: 'center', gap: SP.sm, backgroundColor: CARD,
             borderRadius: RADIUS.md,
             paddingHorizontal: 4, paddingVertical: 14 },
  iconWrap:{ width: 44, height: 44, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  dot:     { position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 4 },
  label:   { width: '100%', minWidth: 0, fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textAlign: 'center' },
});

// ─── NewFeatureBadge ──────────────────────────────────────────────────────────

interface NewFeatureBadgeProps {
  featureId: string;
  openedIds: string[];
  style?: StyleProp<ViewStyle>;
}

export function NewFeatureBadge({ featureId, openedIds, style }: NewFeatureBadgeProps) {
  const { theme } = useAppTheme();
  if (openedIds.includes(featureId)) return null;
  return (
    <View style={[nfS.root, { backgroundColor: theme.accent }, style]}>
      <Text style={[nfS.text, { color: theme.onAccent }]}>NEW</Text>
    </View>
  );
}

const nfS = StyleSheet.create({
  root: { borderRadius: RADIUS.pill, paddingHorizontal: 5, paddingVertical: 2 },
  text: { fontSize: FS.xs, fontFamily: FONT.bold, letterSpacing: 0.5 },
});

// ─── LockBadge ────────────────────────────────────────────────────────────────
// Shown on tool cards gated behind a paid plan so users can see what's locked
// before tapping. Pass `locked={false}` (or omit) to render nothing.

interface LockBadgeProps {
  locked: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LockBadge({ locked, style }: LockBadgeProps) {
  const { theme } = useAppTheme();
  if (!locked) return null;
  return (
    <View style={[lbS.root, { backgroundColor: theme.accent }, style]}>
      <Icon name="lock" size={9} color={theme.onAccent} />
      <Text style={[lbS.text, { color: theme.onAccent }]}>PRO</Text>
    </View>
  );
}

const lbS = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  text: { fontSize: FS.xs, fontFamily: FONT.bold, letterSpacing: 0.5 },
});

// ─── FormInput ────────────────────────────────────────────────────────────────

interface FormInputProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'decimal-pad' | 'url';
  returnKeyType?: 'done' | 'next' | 'search' | 'go';
  onSubmitEditing?: () => void;
  style?: StyleProp<ViewStyle>;
  rightElement?: React.ReactNode;
  /** Inline validation message: error border + text under the field. */
  error?: string | null;
  /** Quiet helper text under the field (replaced by `error` when both are set). */
  helper?: string;
}

export function FormInput({
  label, value, onChange, placeholder, multiline, secureTextEntry, keyboardType,
  returnKeyType, onSubmitEditing, style, rightElement, error, helper,
}: FormInputProps) {
  const [focused, setFocused] = useState(false);
  const { theme } = useAppTheme();
  return (
    <View style={[fiS.wrap, style]}>
      {label && <Text style={[fiS.label, { color: theme.muted }]}>{label}</Text>}
      <View style={[fiS.inputRow, focused && [fiS.focusedRow, { borderColor: theme.accent }], !!error && { borderColor: theme.error }, multiline && fiS.multilineRow]}>
        <TextInput
          style={[fiS.input, { color: theme.text }, multiline && fiS.multilineInput, WEB_INPUT_RESET]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={SUBTLE}
          multiline={multiline}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          accessibilityLabel={label ?? placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {rightElement}
      </View>
      {error ? (
        <Text style={[fiS.note, { color: theme.error }]} accessibilityLiveRegion="polite">{error}</Text>
      ) : helper ? (
        <Text style={[fiS.note, { color: theme.muted }]}>{helper}</Text>
      ) : null}
    </View>
  );
}

const fiS = StyleSheet.create({
  wrap:         { gap: SP.sm },
  label:        { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  note:         { fontSize: FS.xs, fontFamily: FONT.regular, lineHeight: 18 },
  // Solid near-black fill, no resting border (Dev's addendum); the border
  // only appears for focus/error.
  inputRow:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: FILL_ELEVATED,
                  borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'transparent',
                  paddingHorizontal: SP.md, minHeight: COMP.inputH },
  focusedRow:   { borderColor: BORDER_FOCUS },
  multilineRow: { alignItems: 'flex-start', paddingVertical: SP.sm, minHeight: 100 },
  input:        { flex: 1, fontSize: FS.base, fontFamily: FONT.regular, color: FG },
  multilineInput: { textAlignVertical: 'top', minHeight: 90 },
});

// ─── ProgressCard ─────────────────────────────────────────────────────────────

interface ProgressCardProps {
  percent: number;
  label?: string;
  nextLabel?: string;
  onContinue?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ProgressCard({ percent, label, nextLabel, onContinue, style }: ProgressCardProps) {
  const width = useRef(new Animated.Value(0)).current;
  const { theme } = useAppTheme();
  useEffect(() => {
    Animated.timing(width, { toValue: percent / 100, duration: ANIM.slow, useNativeDriver: false }).start();
  }, [percent]);
  return (
    <GradientCard colors={[theme.accentDim, theme.secondaryDim]} style={[pcS.root, style]} glow>
      <View style={pcS.top}>
        <View>
          <Text style={[pcS.pct, { color: theme.text }]}>{percent}% complete</Text>
          {label && <Text style={[pcS.label, { color: theme.muted }]}>{label}</Text>}
        </View>
        {onContinue && (
          <PrimaryButton label="Continue" onPress={onContinue} small style={{ alignSelf: 'flex-end', minWidth: 108 }} />
        )}
      </View>
      <View style={pcS.track}>
        <Animated.View style={[pcS.fill, { backgroundColor: theme.accent, width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      </View>
      {nextLabel && <Text style={[pcS.next, { color: theme.muted }]}>Next: {nextLabel}</Text>}
    </GradientCard>
  );
}

const pcS = StyleSheet.create({
  root:  { gap: SP.sm },
  top:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pct:   { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  label: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  track: { height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.pill, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: RADIUS.pill },
  next:  { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
});

// ─── NavigationCard ───────────────────────────────────────────────────────────

interface NavigationCardProps {
  icon: IconName;
  label: string;
  description?: string;
  onPress: () => void;
  accent?: string;
  badge?: boolean | number;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function NavigationCard({ icon, label, description, onPress, accent, badge, right, style }: NavigationCardProps) {
  const { theme } = useAppTheme();
  const resolvedAccent = accent ?? theme.accent;
  return (
    <PressableScale
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      accessibilityHint="Opens this section"
      style={[ncS.root, { backgroundColor: theme.card }, style]}
    >
      <View style={[ncS.iconWrap, { backgroundColor: resolvedAccent + '18' }]}>
        <Icon name={icon} size={ICON.md} color={resolvedAccent} />
      </View>
      <View style={ncS.body}>
        <View style={ncS.labelRow}>
          <Text style={[ncS.label, { color: theme.text }]}>{label}</Text>
          {badge !== undefined && badge !== false && (
            typeof badge === 'number'
              ? <View style={[ncS.badgeCount, { backgroundColor: theme.accent }]}><Text style={[ncS.badgeText, { color: theme.onAccent }]}>{badge}</Text></View>
              : <View style={[ncS.dot, { backgroundColor: theme.accent }]} />
          )}
        </View>
        {description && <Text style={[ncS.desc, { color: theme.muted }]} numberOfLines={1}>{description}</Text>}
      </View>
      {right ?? <Icon name="chevron-right" size={ICON.sm} color={SUBTLE} />}
    </PressableScale>
  );
}

const ncS = StyleSheet.create({
  root:       { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: 13,
                paddingHorizontal: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md },
  iconWrap:   { width: 40, height: 40, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  body:       { flex: 1 },
  labelRow:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  label:      { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
  desc:       { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  dot:        { width: 6, height: 6, borderRadius: 3 },
  badgeCount: { borderRadius: RADIUS.pill, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText:  { fontSize: FS.xs, fontFamily: FONT.bold },
});

// ─── LoadingSkeleton ──────────────────────────────────────────────────────────

export function LoadingSkeleton({ height = 80, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const anim = useRef(new Animated.Value(0.4)).current;
  useFocusedAnimationLoop(() => Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: NATIVE_DRIVER, isInteraction: false }),
        Animated.timing(anim, { toValue: 0.4, duration: 800, useNativeDriver: NATIVE_DRIVER, isInteraction: false }),
      ])
    ), [anim]);
  return (
    <Animated.View
      style={[{ height, backgroundColor: SKELETON_GLASS, borderRadius: RADIUS.md, opacity: anim }, style]}
    />
  );
}

export function SkeletonText({ width = '70%', height = 12, style }: { width?: number | `${number}%`; height?: number; style?: StyleProp<ViewStyle> }) {
  return <LoadingSkeleton height={height} style={[{ width }, style]} />;
}

export function FeedSkeleton({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  return (
    <View style={[skS.feed, style]}>
      <LoadingSkeleton height={COMP.headerH} style={skS.feedHeader} />
      <LoadingSkeleton height={420} style={skS.feedMedia} />
      <View style={skS.feedMeta}>
        <View style={skS.feedAvatar} />
        <View style={skS.feedLines}>
          <SkeletonText width="42%" height={14} />
          <SkeletonText width="68%" height={11} />
        </View>
      </View>
      <SkeletonText width="86%" height={12} />
      <SkeletonText width="54%" height={12} />
    </View>
  );
}

export function ProductGridSkeleton({ columns = 2, count = 6 }: { columns?: number; count?: number }) {
  return (
    <View style={skS.grid}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={[skS.productCard, { width: `${100 / columns - 2}%` }]}>
          <LoadingSkeleton height={150} style={skS.productImage} />
          <SkeletonText width="82%" height={13} />
          <SkeletonText width="46%" height={11} />
          <SkeletonText width="38%" height={13} />
        </View>
      ))}
    </View>
  );
}

export function SearchResultsSkeleton() {
  return (
    <View style={skS.searchList}>
      {Array.from({ length: 5 }).map((_, index) => (
        <View key={index} style={skS.searchRow}>
          <LoadingSkeleton height={60} style={skS.searchThumb} />
          <View style={skS.searchLines}>
            <SkeletonText width="64%" height={14} />
            <SkeletonText width="44%" height={11} />
            <SkeletonText width="30%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function CheckoutSkeleton() {
  return (
    <View style={skS.checkout}>
      <View style={skS.checkoutHeader}>
        <LoadingSkeleton height={36} style={{ width: 36, borderRadius: 18 }} />
        <SkeletonText width="34%" height={16} />
        <View style={{ width: 36 }} />
      </View>
      <View style={skS.checkoutBody}>
        <SkeletonText width="46%" height={18} />
        <LoadingSkeleton height={132} />
        <SkeletonText width="38%" height={18} />
        <LoadingSkeleton height={88} />
        <LoadingSkeleton height={56} />
      </View>
      <LoadingSkeleton height={54} style={skS.checkoutButton} />
    </View>
  );
}

// Brand rule: the app is black/white/silver only — color is reserved for a
// short, explicit allowlist (LIVE red, end-call red, Thread Cash green, and
// this switch's own ON green — see half-done-audit.mjs's ALLOWED_ACCENTS).
// The ON state gets its own green rather than staying monochrome: a switch
// that's just "black or white" like everything else around it reads as
// ambiguous about which state is on, in a way a live/Thread-Cash accent
// doesn't need to worry about.
//
// This does NOT render react-native's <Switch>: RN's Switch, given custom
// colors, renders correctly on iOS/Android but badly on web — react-
// native-web draws its thumb and track as independently-sized elements, so
// a thumb bigger than a thin custom-colored track hangs off the end instead
// of sliding inside it (see the screenshot this was filed from: Add
// Product's "Track inventory"/"Allow overselling" toggles). Since this app
// ships on web too, HapticSwitch instead draws its own track+thumb with
// Animated/Pressable — identical output on every platform, no native
// component involved at all.
const SWITCH_WIDTH  = 42;
const SWITCH_HEIGHT = 24;
const SWITCH_THUMB_SIZE = 20;
const SWITCH_THUMB_INSET = 2;
const SWITCH_TRAVEL = SWITCH_WIDTH - SWITCH_THUMB_SIZE - SWITCH_THUMB_INSET * 2;
const SWITCH_HIT_AREA = 44; // the drawn switch stays slim; hitSlop alone reaches the full tap target
const SWITCH_TRACK_OFF = '#E5E5E5'; // white/light
const SWITCH_TRACK_ON  = '#34C759'; // green — see ALLOWED_ACCENTS note above
const SWITCH_THUMB_OFF = '#8E8E93'; // mid-grey knob, reads against the light track
const SWITCH_THUMB_ON  = '#1E8E3E'; // deeper green knob, stays visible on the green track
const SWITCH_BORDER_OFF = '#BDBDBD'; // 1px border, off state only

export function HapticSwitch({
  onValueChange, trackColor, thumbColor, value, disabled, style, testID,
  accessibilityLabel, accessibilityHint, hitSlop,
}: SwitchProps) {
  const on = !!value;
  const anim = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: on ? 1 : 0,
      duration: 200,
      useNativeDriver: false, // animating backgroundColor/border, not transform-only
    }).start();
  }, [on, anim]);

  const trackOffColor = trackColor?.false ?? SWITCH_TRACK_OFF;
  const trackOnColor  = trackColor?.true  ?? SWITCH_TRACK_ON;

  const trackBackground = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [trackOffColor, trackOnColor] as unknown as number[],
  });
  // A caller-supplied `thumbColor` is one static color in both states (same
  // shape react-native's own Switch uses); otherwise the knob crossfades
  // between its own off/on colors right alongside the track.
  const thumbBackground = thumbColor ?? anim.interpolate({
    inputRange: [0, 1],
    outputRange: [SWITCH_THUMB_OFF, SWITCH_THUMB_ON] as unknown as number[],
  });
  const thumbTranslateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, SWITCH_TRAVEL] });
  const borderOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  function handlePress() {
    if (disabled) return;
    hapticSelection();
    onValueChange?.(!on);
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      // The drawn switch stays at its slim 42×24 size; hitSlop pads out to a
      // full 44×44 tap target on every side without widening the visual.
      style={[{ width: SWITCH_WIDTH, height: SWITCH_HEIGHT, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }, style]}
      hitSlop={hitSlop ?? {
        top: (SWITCH_HIT_AREA - SWITCH_HEIGHT) / 2,
        bottom: (SWITCH_HIT_AREA - SWITCH_HEIGHT) / 2,
        left: (SWITCH_HIT_AREA - SWITCH_WIDTH) / 2,
        right: (SWITCH_HIT_AREA - SWITCH_WIDTH) / 2,
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
    >
      <Animated.View style={[switchStyles.track, { backgroundColor: trackBackground }]}>
        {/* Border only reads on the OFF track (crossfades out with `anim`) — the
            ON track is a solid, already-visible green with no border needed. */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, switchStyles.track, { borderWidth: 1, borderColor: SWITCH_BORDER_OFF, opacity: borderOpacity }]} />
        <Animated.View
          style={[
            switchStyles.thumb,
            { backgroundColor: thumbBackground, transform: [{ translateX: thumbTranslateX }] },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const switchStyles = StyleSheet.create({
  track: {
    width: SWITCH_WIDTH,
    height: SWITCH_HEIGHT,
    borderRadius: SWITCH_HEIGHT / 2,
    justifyContent: 'center',
  },
  thumb: {
    position: 'absolute',
    left: SWITCH_THUMB_INSET,
    width: SWITCH_THUMB_SIZE,
    height: SWITCH_THUMB_SIZE,
    borderRadius: SWITCH_THUMB_SIZE / 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
});

const skS = StyleSheet.create({
  feed: { padding: SP.md, gap: SP.sm, backgroundColor: SCREEN_BG },
  feedHeader: { width: '100%', borderRadius: 0 },
  feedMedia: { width: '100%', borderRadius: RADIUS.lg },
  feedMeta: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm },
  feedAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: SKELETON_GLASS },
  feedLines: { flex: 1, gap: 7 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: SP.sm, padding: SP.md, backgroundColor: SCREEN_BG },
  productCard: { gap: 8, marginBottom: SP.md },
  productImage: { width: '100%', borderRadius: RADIUS.md },
  searchList: { padding: SP.md, gap: SP.sm, backgroundColor: SCREEN_BG },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  searchThumb: { width: 60, borderRadius: RADIUS.md },
  searchLines: { flex: 1, gap: 8 },
  checkout: { flex: 1, backgroundColor: SCREEN_BG },
  checkoutHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SP.md },
  checkoutBody: { flex: 1, padding: SP.md, gap: SP.md },
  checkoutButton: { marginHorizontal: SP.md, marginBottom: SP.lg },
});

// ─── BrandedLoadingState ──────────────────────────────────────────────────────
/**
 * Replaces bare <ActivityIndicator /> on key screens. Shows the brand gradient
 * icon with a slow pulse so loading never looks like an unstyled placeholder.
 */
export function BrandedLoadingState({ message, style }: { message?: string; style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  const { theme } = useAppTheme();
  const colors = useColors();
  useFocusedAnimationLoop(() => Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 950, useNativeDriver: NATIVE_DRIVER, isInteraction: false }),
        Animated.timing(pulse, { toValue: 0.45, duration: 950, useNativeDriver: NATIVE_DRIVER, isInteraction: false }),
      ])
    ), [pulse]);
  return (
    <View style={[blS.root, { backgroundColor: colors.background }, style]}>
      <Animated.View style={{ opacity: pulse }}>
        <LinearGradient
          colors={theme.primaryGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={blS.iconWrap}
        >
          <Icon name="loader" size={ICON.md} color={theme.onAccent} />
        </LinearGradient>
      </Animated.View>
      {message && <Text style={[blS.msg, { color: colors.mutedForeground }]}>{message}</Text>}
    </View>
  );
}

const blS = StyleSheet.create({
  root:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.md, backgroundColor: BG },
  iconWrap:{ width: 56, height: 56, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center' },
  msg:     { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, textAlign: 'center', maxWidth: 200 },
});

// ─── Toast (simple inline variant) ───────────────────────────────────────────

interface ToastProps {
  message: string;
  visible: boolean;
  variant?: 'success' | 'error' | 'info';
}

export function Toast({ message, visible, variant = 'success' }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: ANIM.fast, useNativeDriver: true }).start();
  }, [visible]);
  const palette = useColors();
  const statusColors = { success: palette.success, error: palette.destructive, info: palette.info };
  const color = statusColors[variant];
  return (
    <Animated.View accessibilityLiveRegion={variant === 'error' ? 'assertive' : 'polite'} style={[toS.root, { opacity, backgroundColor: palette.card, borderColor: color + '44' }]}>
      <Icon name={variant === 'success' ? 'check-circle' : variant === 'error' ? 'alert-circle' : 'info'} size={ICON.sm} color={color} />
      <Text style={[toS.text, { color }]}>{message}</Text>
    </Animated.View>
  );
}

const toS = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD,
          borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: SP.md, paddingVertical: SP.sm,
          marginHorizontal: SP.md },
  text: { fontSize: FS.sm, fontFamily: FONT.medium, flex: 1 },
});

// ─── BottomSheet handle ────────────────────────────────────────────────────────

export function SheetHandle() {
  return (
    <View style={{ alignItems: 'center', paddingTop: SP.sm, paddingBottom: SP.xs }}>
      <View style={{ width: 36, height: 4, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.15)' }} />
    </View>
  );
}

// ─── ThreadDivider ─────────────────────────────────────────────────────────────
/**
 * The signature Brandthread visual motif: a stitched-line divider that replaces
 * plain 1px hairlines throughout the app. Uses SVG strokeDasharray to render a
 * thread-stitch pattern that works identically on iOS and Android.
 *
 * Usage:
 *   <ThreadDivider />                        — full-width stitch line
 *   <ThreadDivider label="or" />             — stitch line with centred label
 *   <ThreadDivider accent={BLUE_DIM} />      — coloured variant
 */
interface ThreadDividerProps {
  label?: string;
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

export function ThreadDivider({ label, accent, style }: ThreadDividerProps) {
  const { theme } = useAppTheme();
  const resolvedAccent = accent ?? theme.accent;
  const StitchLine = () => (
    <View style={{ flex: 1, height: 8 }}>
      <Svg height="8" width="100%" style={{ overflow: 'visible' }}>
        <SvgLine
          x1="0" y1="4" x2="100%" y2="4"
          stroke={resolvedAccent}
          strokeWidth="1"
          strokeDasharray="8,4"
          strokeLinecap="round"
          strokeOpacity="0.5"
        />
      </Svg>
    </View>
  );

  if (label) {
    return (
      <View style={[tdS.row, style]}>
        <StitchLine />
        <Text style={[tdS.label, { color: resolvedAccent }]}>{label}</Text>
        <StitchLine />
      </View>
    );
  }
  return (
    <View style={[tdS.solo, style]}>
      <StitchLine />
    </View>
  );
}

const tdS = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm,
           marginVertical: SP.xs, paddingHorizontal: SP.md },
  solo:  { marginVertical: SP.xs, paddingHorizontal: SP.md },
  label: { fontSize: FS.xs, fontFamily: FONT.medium, opacity: 0.7 },
});
