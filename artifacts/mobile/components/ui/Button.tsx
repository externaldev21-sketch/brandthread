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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { hapticLight, hapticWarning } from '@/lib/haptics';
import { COMP, FONT, RED } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS, PRESS_SCALE } from '@/constants/motion';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';
export type ButtonSize = 'default' | 'small';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Feather.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  /** Overrides the default (the label) — useful when several buttons on one screen share a label, e.g. per-row "Follow". */
  accessibilityLabel?: string;
  testID?: string;
}

/** Shared press-in/out feel: settle to PRESS_SCALE over PRESS_DURATION_MS, never below 1 at rest. */
function usePressScale() {
  const scale = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';
  const onPressIn = () => Animated.timing(scale, { toValue: PRESS_SCALE, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 6 }).start();
  return { scale, onPressIn, onPressOut };
}

export function Button({
  label, onPress, variant = 'primary', size = 'default', icon,
  loading = false, disabled = false, fullWidth = false, style, accessibilityHint, accessibilityLabel, testID,
}: ButtonProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const { scale, onPressIn, onPressOut } = usePressScale();
  const isDisabled = disabled || loading;
  const height = size === 'small' ? COMP.buttonHSm : COMP.buttonH;

  const handlePress = () => {
    if (isDisabled) return;
    if (variant === 'destructive') hapticWarning();
    else hapticLight();
    onPress();
  };

  const variantStyle = ((): { bg: string; fg: string; border?: string } => {
    switch (variant) {
      case 'primary': return { bg: isDisabled ? palette.elevated : theme.accent, fg: isDisabled ? palette.mutedForeground : theme.onAccent };
      case 'secondary': return { bg: 'transparent', fg: isDisabled ? palette.mutedForeground : palette.foreground, border: isDisabled ? palette.border : palette.foreground };
      case 'tertiary': return { bg: 'transparent', fg: isDisabled ? palette.mutedForeground : theme.accentLight };
      case 'destructive': return { bg: isDisabled ? palette.elevated : RED, fg: isDisabled ? palette.mutedForeground : palette.background };
    }
  })();

  const isFilled = variant === 'primary' || variant === 'destructive';

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
      style={[fullWidth && styles.fullWidth]}
    >
      <Animated.View
        style={[
          styles.base,
          { height, borderRadius: RADII.pill, transform: [{ scale }] },
          isFilled ? { backgroundColor: variantStyle.bg } : { backgroundColor: 'transparent' },
          variant === 'secondary' && { borderWidth: 1, borderColor: variantStyle.border },
          fullWidth && styles.fullWidth,
          isDisabled && !isFilled && { opacity: 0.5 },
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={variantStyle.fg} size="small" />
        ) : (
          <>
            {icon && <Feather name={icon} size={18} color={variantStyle.fg} />}
            <Text style={[styles.label, TYPE_SCALE.headline, { color: variantStyle.fg }]} numberOfLines={1}>
              {label}
            </Text>
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
  label: { fontFamily: FONT.semibold, letterSpacing: 0.1 },
  stickyWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    gap: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
