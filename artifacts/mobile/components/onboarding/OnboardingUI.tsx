/**
 * Shared onboarding primitives: pill buttons, floating-label inputs,
 * staggered reveals and the segmented verification-code field.
 *
 * These are presentation-only. Every value, handler and validation rule is
 * owned by the calling screen and passed straight through — the primitives
 * only decide how state *looks* (floated label, focus ring, error tint).
 */
import React, { forwardRef, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { identityOrNone } from '@/lib/animationUtils';
import { MOTION, PRESS_SCALE, RADIUS, SPACE, TYPE, useOnboardingMotion } from './onboardingTokens';

// ─── Reveal ───────────────────────────────────────────────────────────────────

/** Staggered entry: rises ~25pt and fades in. Instant under Reduce Motion. */
export function Reveal({
  index = 0,
  delay = 0,
  children,
  style,
}: {
  index?: number;
  delay?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduceMotion } = useOnboardingMotion();
  const entering = reduceMotion
    ? undefined
    : FadeInDown.duration(MOTION.revealMs).delay(delay + index * MOTION.staggerMs).easing(MOTION.reveal);
  return <Animated.View entering={entering} style={style}>{children}</Animated.View>;
}

function flattenText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('');
}

/**
 * The one big idea on each screen. Explicit `\n` breaks become separate
 * lines that rise in one after another.
 */
export function StepHeadline({
  children,
  size = 'headline',
  delay = 0,
  style,
  testID,
}: {
  children: React.ReactNode;
  size?: 'display' | 'headline' | 'title1';
  delay?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const { reduceMotion } = useOnboardingMotion();
  const text = flattenText(children);
  const lines = text.split('\n');
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={text.replace(/\n/g, ' ')} testID={testID}>
      {lines.map((line, i) => (
        <Animated.View
          key={`${i}-${line}`}
          entering={reduceMotion ? undefined : FadeInDown.duration(MOTION.revealMs).delay(delay + i * MOTION.staggerMs).easing(MOTION.reveal)}
        >
          <Text style={[TYPE[size], { color: theme.text }, style]}>{line}</Text>
        </Animated.View>
      ))}
    </View>
  );
}

/** Short muted subtitle under a headline. */
export function StepSub({ children, index = 1, style }: { children: React.ReactNode; index?: number; style?: StyleProp<TextStyle> }) {
  const { theme } = useAppTheme();
  return (
    <Reveal index={index}>
      <Text style={[TYPE.body, { color: theme.muted, marginTop: SPACE.sm }, style]}>{children}</Text>
    </Reveal>
  );
}

// ─── PressableScale ──────────────────────────────────────────────────────────

/**
 * Any tappable surface in the flow (cards, rows, chips): scales to 0.97 on
 * press. Accessibility props pass straight through to the Pressable.
 */
export function PressableScale({
  children,
  style,
  onPress,
  disabled,
  ...a11y
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
} & Pick<
  React.ComponentProps<typeof Pressable>,
  'testID' | 'accessibilityRole' | 'accessibilityState' | 'accessibilityLabel' | 'hitSlop'
>) {
  const { reduceMotion } = useOnboardingMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: identityOrNone([{ scale: scale.value }]) }));
  return (
    <Animated.View style={pressStyle}>
      <Pressable
        {...a11y}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => { if (!reduceMotion) scale.value = withTiming(PRESS_SCALE, { duration: 90 }); }}
        onPressOut={() => { scale.value = reduceMotion ? 1 : withSpring(1, { damping: 14, stiffness: 320 }); }}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** Short running stitch that sews itself in (selection accent). */
export function StitchAccent({ active, color, style }: { active: boolean; color: string; style?: StyleProp<ViewStyle> }) {
  const { reduceMotion } = useOnboardingMotion();
  const sewn = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    sewn.value = reduceMotion ? (active ? 1 : 0) : withTiming(active ? 1 : 0, { duration: 420, easing: MOTION.draw });
  }, [active, reduceMotion, sewn]);
  const sewStyle = useAnimatedStyle(() => ({ opacity: sewn.value, transform: [{ scaleX: sewn.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.stitch, { transformOrigin: 'left center' }, sewStyle, style]}>
      {Array.from({ length: 14 }).map((_, i) => (
        <View key={i} style={[styles.stitchDash, { backgroundColor: color }]} />
      ))}
    </Animated.View>
  );
}

// ─── PillButton ───────────────────────────────────────────────────────────────

export type PillVariant = 'primary' | 'secondary' | 'ghost';

export function PillButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  trailing,
  haptic = true,
  testID,
  accessibilityLabel,
  style,
  textStyle,
}: {
  label: string;
  onPress: () => void;
  variant?: PillVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Light impact on press. Turn off where the handler already fires one. */
  haptic?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const { theme } = useAppTheme();
  const { reduceMotion, lightTap } = useOnboardingMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: identityOrNone([{ scale: scale.value }]) }));
  const inactive = disabled || loading;

  const content = loading ? (
    <ActivityIndicator
      color={variant === 'primary' && !disabled ? theme.onAccent : theme.text}
      size="small"
    />
  ) : (
    <View style={styles.pillRow}>
      {icon}
      <Text
        numberOfLines={1}
        style={[
          styles.pillText,
          variant === 'primary'
            ? disabled ? { color: theme.subtle } : getOnAccentTextStyle(theme)
            : { color: variant === 'ghost' ? theme.muted : theme.text },
          textStyle,
        ]}
      >
        {label}
      </Text>
      {trailing}
    </View>
  );

  return (
    <Animated.View style={[pressStyle, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPressIn={() => {
          if (!reduceMotion) scale.value = withTiming(PRESS_SCALE, { duration: 90 });
        }}
        onPressOut={() => {
          scale.value = reduceMotion ? 1 : withSpring(1, { damping: 14, stiffness: 320 });
        }}
        onPress={() => {
          if (haptic) lightTap();
          onPress();
        }}
      >
        {variant === 'primary' && !disabled ? (
          <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.pill}>
            {content}
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.pill,
              variant === 'primary' && styles.pillDisabled,
              variant === 'secondary' && { borderWidth: 1, borderColor: theme.border },
            ]}
          >
            {content}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── FloatingInput ────────────────────────────────────────────────────────────

export type FloatingInputProps = TextInputProps & {
  label: string;
  /** Inline error (visual only — the caller decides when it applies). */
  error?: string | false | null;
  hint?: string | null;
  /** Show a quiet check once the caller's own rule is satisfied. */
  valid?: boolean;
  /** Trailing accessory (e.g. show/hide password). */
  right?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
};

const FIELD_HEIGHT = 60;

export const FloatingInput = forwardRef<TextInput, FloatingInputProps>(function FloatingInput(
  { label, error, hint, valid, right, containerStyle, style, onFocus, onBlur, value, placeholder, ...rest },
  ref,
) {
  const { theme } = useAppTheme();
  const { reduceMotion } = useOnboardingMotion();
  const [focused, setFocused] = useState(false);
  const hasValue = typeof value === 'string' ? value.length > 0 : !!value;
  const floated = focused || hasValue;
  const float = useSharedValue(floated ? 1 : 0);
  const focus = useSharedValue(0);

  useEffect(() => {
    float.value = reduceMotion ? (floated ? 1 : 0) : withTiming(floated ? 1 : 0, { duration: 180 });
  }, [floated, reduceMotion, float]);
  useEffect(() => {
    focus.value = reduceMotion ? (focused ? 1 : 0) : withTiming(focused ? 1 : 0, { duration: 180 });
  }, [focused, reduceMotion, focus]);

  const restBorder = error ? theme.error : theme.border;
  const activeBorder = error ? theme.error : theme.text;
  const frameStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [restBorder, activeBorder]),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(float.value, [0, 1], [0, -11]) },
      { scale: interpolate(float.value, [0, 1], [1, 0.8]) },
    ],
  }));

  const message = error || hint;
  return (
    <View style={[styles.fieldWrap, containerStyle]}>
      <Animated.View style={[styles.field, { backgroundColor: theme.surface }, frameStyle]}>
        <Animated.Text
          pointerEvents="none"
          numberOfLines={1}
          style={[
            styles.floatLabel,
            { color: error ? theme.error : floated ? theme.muted : theme.subtle },
            labelStyle,
          ]}
        >
          {label}
        </Animated.Text>
        <TextInput
          ref={ref}
          value={value}
          placeholder={focused ? placeholder : undefined}
          placeholderTextColor={theme.subtle}
          selectionColor={theme.text}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[styles.fieldInput, { color: theme.text }, style]}
          {...rest}
        />
        {right ?? (valid && !error ? (
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(160)} style={styles.fieldAccessory}>
            <Feather name="check" size={16} color={theme.text} />
          </Animated.View>
        ) : null)}
      </Animated.View>
      {message ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(160)} style={styles.messageRow}>
          {error ? <Feather name="alert-circle" size={12} color={theme.error} /> : null}
          <Text style={[TYPE.caption, { color: error ? theme.error : theme.muted, flex: 1 }]}>{message}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
});

/** Eye toggle for password fields. */
export function RevealToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={onToggle}
      style={styles.fieldAccessory}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={shown ? 'Hide password' : 'Show password'}
    >
      <Feather name={shown ? 'eye-off' : 'eye'} size={18} color={theme.muted} />
    </Pressable>
  );
}

// ─── CodeCells ────────────────────────────────────────────────────────────────

/**
 * Six-cell verification code display over a real (visually hidden) input,
 * so paste, SMS/email autofill and the number pad all work natively.
 */
export function CodeCells({
  value,
  onChangeText,
  length = 6,
  autoFocus,
  testID,
  onSubmitEditing,
}: {
  value: string;
  onChangeText: (next: string) => void;
  length?: number;
  autoFocus?: boolean;
  testID?: string;
  onSubmitEditing?: () => void;
}) {
  const { theme } = useAppTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={styles.codeRow} accessible={false}>
      {Array.from({ length }).map((_, i) => {
        const char = value[i] ?? '';
        const active = focused && i === Math.min(value.length, length - 1);
        return (
          <View
            key={i}
            style={[
              styles.codeCell,
              { backgroundColor: theme.surface, borderColor: active ? theme.text : char ? theme.muted : theme.border },
            ]}
          >
            <Text style={[styles.codeChar, { color: theme.text }]}>{char}</Text>
          </View>
        );
      })}
      <TextInput
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus={autoFocus}
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        caretHidden
        returnKeyType={onSubmitEditing ? 'go' : undefined}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel="Verification code"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.codeHiddenInput}
      />
    </Pressable>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

export function HairlineDivider({ children }: { children?: React.ReactNode }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.divider}>
      <View style={[styles.divLine, { backgroundColor: theme.border }]} />
      {children}
      <View style={[styles.divLine, { backgroundColor: theme.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 56,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pillDisabled: { backgroundColor: 'rgba(255,255,255,0.06)' },
  pillRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pillText: { fontSize: 16, lineHeight: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.1 },

  fieldWrap: { marginBottom: SPACE.sm },
  field: {
    height: FIELD_HEIGHT,
    borderRadius: RADIUS.field,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  floatLabel: {
    position: 'absolute',
    left: 18,
    right: 48,
    top: 20,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: 'Inter_500Medium',
    transformOrigin: 'left center',
  },
  fieldInput: {
    flex: 1,
    height: FIELD_HEIGHT,
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 6,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    // The field frame is the focus indicator; drop the browser's rectangle.
    outlineWidth: 0,
  },
  fieldAccessory: { paddingHorizontal: 16, height: FIELD_HEIGHT, justifyContent: 'center' },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, paddingTop: 6 },

  codeRow: { flexDirection: 'row', gap: SPACE.xs, justifyContent: 'space-between', marginBottom: SPACE.md },
  codeCell: {
    flex: 1,
    maxWidth: 56,
    height: 64,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeChar: { fontSize: 26, fontFamily: 'Inter_700Bold' },
  codeHiddenInput: { ...StyleSheet.absoluteFill, opacity: 0.011, color: 'transparent' },

  stitch: { flexDirection: 'row', gap: 5, height: 2, overflow: 'hidden' },
  stitchDash: { width: 7, height: 1.5, borderRadius: 1 },

  divider: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginVertical: SPACE.md },
  divLine: { flex: 1, height: StyleSheet.hairlineWidth },
});
