/**
 * Brandthread Design System — Button (Phase 1)
 *
 * Wraps the existing PrimaryButton/SecondaryButton/TertiaryButton press-feel
 * (components/BrandthreadUI.tsx) with a single typed API, adds the missing
 * `destructive` variant and a full-width sticky bottom CTA variant with
 * safe-area handling. Colors always come from the active 12-theme palette
 * (useAppTheme / useColors) — never hardcoded.
 *
 * Layout/interaction reference only (never colors/fonts/shapes): Nike Bag
 * Checkout pill, SSENSE "ADD TO BAG" block, Gymshark stacked pills.
 */
import React from 'react';
import {
  ActivityIndicator, Animated, Platform, Pressable, PressableProps,
  StyleProp, StyleSheet, Text, View, ViewStyle,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { hapticLight, hapticWarning } from '@/lib/haptics';
import { COMP, FILL_ELEVATED, FONT, RED } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { radius } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import { splitButtonStyle } from '@/lib/buttonStyle';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';
/**
 * 'default' (lg, 52pt) and 'small' (md, 44pt) are the original two sizes —
 * unchanged, every existing call site keeps its current height. 'compact'
 * (sm, 36pt) is for tight inline row actions (e.g. Accept/Decline on a
 * message-request row) where even 'small' is taller than the row wants.
 */
export type ButtonSize = 'default' | 'small' | 'compact';

export interface ButtonProps {
  label: string;
  /**
   * Takes the underlying GestureResponderEvent optionally — most callers
   * ignore it, but a Button nested inside another pressable row (e.g. a
   * quick action on an order row) needs it to call event.stopPropagation()
   * so the row's own onPress doesn't also fire on web.
   */
  onPress: (event?: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  /** Overrides the default (the label) — useful when several buttons on one screen share a label, e.g. per-row "Follow". */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Shared press-in/out feel: a firm ~0.96 scale settle (critically damped,
 * no overshoot — see PRESS_SPRING in constants/motion.ts) plus a fill/opacity
 * shift on the same layer (never a separate translucent circle/pill and
 * never an outer ring — see tests/no-translucent-chip-highlight.test.ts and
 * tests/no-outer-focus-ring.test.ts).
 */
function usePressScale() {
  const scale = React.useRef(new Animated.Value(1)).current;
  const pressed = React.useRef(new Animated.Value(0)).current;
  const nativeDriver = Platform.OS !== 'web';
  const onPressIn = () => {
    pressScaleAnim(scale, PRESS_SCALE).start();
    Animated.timing(pressed, { toValue: 1, duration: 90, useNativeDriver: nativeDriver }).start();
  };
  const onPressOut = () => {
    pressScaleAnim(scale, 1).start();
    Animated.timing(pressed, { toValue: 0, duration: 140, useNativeDriver: nativeDriver }).start();
  };
  return { scale, pressed, onPressIn, onPressOut };
}

export function Button({
  label, onPress, variant = 'primary', size = 'default', icon,
  loading = false, disabled = false, fullWidth = false, style, accessibilityHint, accessibilityLabel, testID,
}: ButtonProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const { scale, pressed, onPressIn, onPressOut } = usePressScale();
  const isDisabled = disabled || loading;
  const { outerStyle, innerStyle } = splitButtonStyle(style);
  const disabledFill = theme.id === 'monochrome' ? FILL_ELEVATED : palette.elevated;
  const height = size === 'compact' ? 36 : size === 'small' ? COMP.buttonHSm : COMP.buttonH;
  // Label size scales with the button size — it used to stay fixed at
  // TYPE_SCALE.headline (17px) for every size, which read oversized on a
  // 36pt 'compact' button (Instagram's own-profile buttons are ~13-14pt
  // semibold on ~32-34pt buttons).
  const labelType = size === 'compact'
    ? { fontSize: 14, lineHeight: 18, fontFamily: FONT.semibold }
    : size === 'small'
      ? { fontSize: 15, lineHeight: 20, fontFamily: FONT.semibold }
      : TYPE_SCALE.headline;

  const handlePress = (event: GestureResponderEvent) => {
    if (isDisabled) return;
    if (variant === 'destructive') hapticWarning();
    else hapticLight();
    onPress(event);
  };

  const variantStyle = ((): { bg: string; fg: string; border?: string } => {
    switch (variant) {
      // Disabled fill: the one elevated grey (BRANDTHREAD_DESIGN.md addendum) on
      // Monochrome, where cardElevated is pure black and the button vanished.
      case 'primary': return { bg: isDisabled ? disabledFill : theme.accent, fg: isDisabled ? palette.mutedForeground : theme.onAccent };
      case 'secondary': return { bg: 'transparent', fg: isDisabled ? palette.mutedForeground : palette.foreground, border: isDisabled ? palette.border : palette.foreground };
      case 'tertiary': return { bg: 'transparent', fg: isDisabled ? palette.mutedForeground : theme.accentLight };
      case 'destructive': return { bg: isDisabled ? disabledFill : RED, fg: isDisabled ? palette.mutedForeground : palette.background };
    }
  })();

  const isFilled = variant === 'primary' || variant === 'destructive';
  // Filled buttons darken on press; outline/ghost buttons pick up a faint
  // theme-tinted fill. Never a separate translucent circle/pill layer, and
  // no android_ripple — the ripple's spreading-circle wash is exactly the
  // "translucent circle highlight" look the owner asked to remove.
  const pressOverlayColor = isFilled ? '#00000026' : `${theme.accent}1F`;
  const overlayOpacity = pressed.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      testID={testID}
      style={[fullWidth && styles.fullWidth, outerStyle]}
      android_ripple={{ color: isFilled ? '#00000026' : `${theme.accent}2E`, borderless: false }}
    >
      <Animated.View
        style={[
          styles.base,
          { height, borderRadius: radius.md, transform: [{ scale }] },
          isFilled ? { backgroundColor: variantStyle.bg } : { backgroundColor: 'transparent' },
          variant === 'secondary' && { borderWidth: 1, borderColor: variantStyle.border },
          fullWidth && styles.fullWidth,
          isDisabled && !isFilled && { opacity: 0.5 },
          innerStyle,
        ]}
      >
        <View style={[StyleSheet.absoluteFill, { borderRadius: radius.md, overflow: 'hidden' }]} pointerEvents="none">
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: pressOverlayColor, opacity: overlayOpacity }]} />
        </View>
        {loading ? (
          <ActivityIndicator color={variantStyle.fg} size="small" />
        ) : (
          <>
            {icon && <Icon name={icon} size={size === 'compact' ? 17 : 20} color={variantStyle.fg} />}
            {/* An icon-only button passes label="" (with an accessibilityLabel)
                — no empty Text, so the icon sits dead centre. */}
            {label ? (
              <Text style={[styles.label, labelType, { color: variantStyle.fg }]} numberOfLines={1} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
                {label}
              </Text>
            ) : null}
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Full-width sticky bottom CTA with safe-area inset handling — the "Add to
 * bag" / "Checkout" bar anchored above the home indicator.
 */
export interface StickyBottomCTAProps extends Omit<ButtonProps, 'fullWidth' | 'style'> {
  /** Optional content rendered above the button, e.g. a price row. */
  header?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

export function StickyBottomCTA({ header, containerStyle, ...buttonProps }: StickyBottomCTAProps) {
  const insets = useSafeAreaInsets();
  const palette = useColors();
  return (
    <View
      style={[
        styles.stickyWrap,
        {
          paddingBottom: Math.max(insets.bottom, SPACING.md),
          backgroundColor: palette.background,
          borderTopColor: palette.border,
        },
        containerStyle,
      ]}
    >
      {header}
      <Button {...buttonProps} fullWidth />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.xl,
  },
  fullWidth: { width: '100%' },
  label: { fontFamily: FONT.semibold },
  stickyWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    gap: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
