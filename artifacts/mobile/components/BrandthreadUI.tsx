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
  Switch, SwitchProps, PressableProps,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import Svg, { Line as SvgLine } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, SCREEN_BG, SURFACE, CARD, CARD_ELEVATED,
  SURFACE_GLASS, CARD_GLASS, CARD_ELEVATED_GLASS, SKELETON_GLASS,
  BORDER, BORDER_ACTIVE, BORDER_FOCUS,
  FG, MUTED, SUBTLE,
  SUCCESS, SUCCESS_DIM, GREEN_BRIGHT,
  BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM,
  SHADOW_PURPLE, SHADOW_SM,
} from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { hapticLight, hapticMedium, hapticSelection } from '@/lib/haptics';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { undoExpiresAt } from '@/lib/undoRecovery';

// ─── Shared undo action/toast ─────────────────────────────────────────────────
// Mutations remain responsible for their own server/local rollback. This provider
// only owns the short-lived, accessible action affordance and its expiry.
export interface UndoAction {
  message: string;
  undo: () => void | Promise<void>;
  durationMs?: number;
}
type UndoToastContextValue = { showUndo: (action: UndoAction) => void; dismissUndo: () => void };
const UndoToastContext = createContext<UndoToastContextValue | null>(null);

export function UndoToastProvider({ children }: { children: React.ReactNode }) {
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
        <View accessibilityLiveRegion="polite" style={undoS.root}>
          <Text style={undoS.message}>{action.message}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Undo: ${action.message}`} onPress={undo} disabled={undoing} style={undoS.button}>
            <Text style={undoS.buttonText}>{undoing ? 'Restoring…' : 'Undo'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </UndoToastContext.Provider>
  );
}
const undoS = StyleSheet.create({
  root: { position: 'absolute', left: SP.md, right: SP.md, bottom: SP.xl, minHeight: 52, borderRadius: RADIUS.md, backgroundColor: '#272738', borderWidth: 1, borderColor: BORDER_ACTIVE, paddingHorizontal: SP.md, flexDirection: 'row', alignItems: 'center', gap: SP.sm, zIndex: 1000, elevation: 1000 },
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
  children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  activeScale?: number;
  activeOpacity?: number;
}

export function PressableScale({ children, onPress, style, disabled, hitSlop, activeScale = 0.97, activeOpacity = 0.85, ...rest }: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      {...rest}
      accessibilityRole={rest.accessibilityRole ?? 'button'}
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={(e) => {
        Animated.parallel([
          Animated.spring(scale, { toValue: activeScale, useNativeDriver: true, tension: 100, friction: 15 }),
          Animated.timing(opacity, { toValue: activeOpacity, duration: 50, useNativeDriver: true }),
        ]).start();
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 100, friction: 15 }),
          Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        ]).start();
        rest.onPressOut?.(e);
      }}
      style={typeof style === 'function' ? style : undefined}
    >
      {(state) => (
        <Animated.View style={[typeof style === 'function' ? undefined : style, { minHeight: COMP.minTouchTarget, transform: [{ scale }], opacity }]}>
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
    Animated.timing(progress, {
      toValue: 1,
      delay,
      duration: ANIM.normal,
      useNativeDriver: Platform.OS !== 'web',
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
  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: SCREEN_BG,
    paddingTop: noSafeTop ? 0 : insets.top,
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
  return (
    <View style={hdrS.root}>
      <View style={hdrS.left}>
        {onBack && (
          <PressableScale
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onBack(); }}
            style={hdrS.back}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </PressableScale>
        )}
        <View>
          {gradient ? (
            <LinearGradient colors={[theme.accent, theme.accentLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={hdrS.gradTitleWrap}>
              <Text style={[hdrS.gradTitle, { color: theme.accent }]}>{title}</Text>
            </LinearGradient>
          ) : (
            <Text style={hdrS.title}>{title}</Text>
          )}
          {subtitle && <Text style={hdrS.subtitle}>{subtitle}</Text>}
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
                borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
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
  const s: ViewStyle = {
    backgroundColor: elevated ? CARD_ELEVATED_GLASS : CARD_GLASS,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    ...(glow ? { ...SHADOW_PURPLE, shadowColor: theme.accent } : {}),
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
  const cardColors = colors ?? [theme.accentDim, theme.secondaryDim] as const;
  const inner = (
    <LinearGradient
      colors={cardColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[gcS.card, { borderColor: theme.accent + '66' }, glow && { ...SHADOW_PURPLE, shadowColor: theme.accent } as ViewStyle, style]}
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
  card: { borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER_ACTIVE, padding: SP.md, overflow: 'hidden' },
});

// ─── PrimaryButton ────────────────────────────────────────────────────────────

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  colors?: readonly [string, string, ...string[]];
}

export function PrimaryButton({
  label, onPress, icon, loading, disabled, small, style, colors,
}: PrimaryButtonProps) {
  const { theme } = useAppTheme();
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
      style={[{ borderRadius: RADIUS.md, overflow: 'hidden' }, style]}
    >
      <LinearGradient
        colors={disabled ? ['#3A3A4E', '#3A3A4E'] : buttonColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[pbS.inner, { height: h }]}
      >
        {loading ? (
          <ActivityIndicator color={disabled ? MUTED : foreground} size="small" />
        ) : (
          <>
            {icon && <Feather name={icon} size={ICON.sm} color={disabled ? MUTED : foreground} />}
            <Text style={[pbS.label, disabled ? { color: MUTED, fontSize: small ? FS.sm : FS.base, opacity: 0.5 } : [onAccentTextStyle, { fontSize: small ? FS.sm : FS.base }]]}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </PressableScale>
  );
}

const pbS = StyleSheet.create({
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  label: { fontFamily: FONT.bold, letterSpacing: 0.2 },
});

// ─── SecondaryButton ──────────────────────────────────────────────────────────

interface SecondaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
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
      {icon && <Feather name={icon} size={ICON.sm} color={resolvedAccent} />}
      <Text style={[sbS.label, { fontSize: small ? FS.sm : FS.base, color: resolvedAccent }]}>{label}</Text>
    </PressableScale>
  );
}

const sbS = StyleSheet.create({
  root:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
           borderRadius: RADIUS.md, borderWidth: 1, backgroundColor: 'rgba(199,205,213,0.08)' },
  label: { fontFamily: FONT.semibold },
});

// ─── TertiaryButton ───────────────────────────────────────────────────────────

interface TertiaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
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
      style={[{ height: h, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, opacity: disabled ? 0.4 : 1 }, style]}
    >
      {icon && <Feather name={icon} size={ICON.sm} color={resolvedAccent} />}
      <Text style={{ fontFamily: FONT.semibold, fontSize: small ? FS.sm : FS.base, color: resolvedAccent }}>{label}</Text>
    </PressableScale>
  );
}

// ─── IconButton ───────────────────────────────────────────────────────────────

interface IconButtonProps {
  name: keyof typeof Feather.glyphMap;
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
  const label = accessibilityLabel ?? `${name.replace(/-/g, ' ')}${badgeCount ? `, ${badgeCount} notifications` : ''}`;
  return (
    <PressableScale
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={[ibS.root, style]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Feather name={name} size={size} color={color} />
      {badge && (
        <View style={[ibS.badge, { backgroundColor: theme.accent }]}>
          {badgeCount !== undefined && badgeCount > 0
            ? <Text style={[ibS.badgeText, { color: theme.onAccent }]}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
            : null}
        </View>
      )}
    </PressableScale>
  );
}

const ibS = StyleSheet.create({
  root:      { width: COMP.iconBtn, height: COMP.iconBtn, borderRadius: RADIUS.sm, backgroundColor: CARD,
               borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  badge:     { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 8, fontFamily: FONT.bold, textAlign: 'center' },
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
  return (
    <View style={[srS.root, focused && [srS.focused, { borderColor: theme.accent }], style]}>
      <Feather name="search" size={ICON.sm} color={focused ? theme.accentLight : MUTED} />
      <TextInput
        style={srS.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={SUBTLE}
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
          <Feather name="x" size={ICON.sm} color={MUTED} />
        </PressableScale>
      )}
    </View>
  );
}

const srS = StyleSheet.create({
  root:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD,
             borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
             paddingHorizontal: SP.md, height: COMP.inputH - 4 },
  focused: { borderColor: BORDER_FOCUS },
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
  return (
    <PressableScale
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      accessibilityLabel={count !== undefined ? `${label}, ${count}` : label}
      accessibilityState={{ selected: active }}
      style={[fcS.chip, active && [fcS.active, { backgroundColor: theme.accentDim, borderColor: theme.accent + '88' }]]}
    >
      <Text style={[fcS.label, active && [fcS.activeLabel, { color: theme.accentLight }]]}>{label}</Text>
      {count !== undefined && (
        <View style={[fcS.count, active && [fcS.activeCount, { backgroundColor: theme.accentDim }]]}>
          <Text style={[fcS.countText, active && [fcS.activeCountText, { color: theme.accentLight }]]}>{count}</Text>
        </View>
      )}
    </PressableScale>
  );
}

const fcS = StyleSheet.create({
  chip:         { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, height: 34,
                  borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  active:       { borderColor: BORDER_ACTIVE },
  label:        { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  activeLabel:  { fontFamily: FONT.semibold },
  count:        { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.pill, paddingHorizontal: 5, paddingVertical: 1 },
  activeCount:  {},
  countText:    { fontSize: 10, fontFamily: FONT.bold, color: MUTED },
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
  const c = variant === 'purple' ? { bg: theme.accentDim, fg: theme.accentLight } : STATUS_COLORS[variant];
  return (
    <View style={[stS.root, { backgroundColor: c.bg, paddingHorizontal: small ? 6 : 9, paddingVertical: small ? 2 : 4 }]}>
      <Text style={[stS.label, { color: c.fg, fontSize: small ? 9 : FS.xs }]}>{label}</Text>
    </View>
  );
}

const stS = StyleSheet.create({
  root:  { borderRadius: RADIUS.pill },
  label: { fontFamily: FONT.bold, letterSpacing: 0.2 },
});

// ─── EmptyState ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  action?: { label: string; onPress: () => void; icon?: keyof typeof Feather.glyphMap };
  secondaryAction?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ icon, title, description, action, secondaryAction, style }: EmptyStateProps) {
  const { theme } = useAppTheme();
  return (
    <View style={[esS.root, style]}>
      <View style={esS.illustration} accessibilityElementsHidden>
        <View style={[esS.orbit, { borderColor: theme.accent + '30' }]} />
        <View style={[esS.spark, esS.sparkOne, { backgroundColor: theme.secondary }]} />
        <View style={[esS.spark, esS.sparkTwo, { backgroundColor: theme.accentLight }]} />
        <View style={[esS.floor, { backgroundColor: theme.accentDim }]} />
        <LinearGradient
          colors={[theme.accentDim, theme.secondaryDim]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[esS.artCard, { borderColor: theme.accent + '70' }]}
        >
          <View style={[esS.artInset, { backgroundColor: theme.accent + '18' }]}>
            <Feather name={icon} size={34} color={theme.accentLight} />
          </View>
          <View style={esS.artLines}>
            <View style={[esS.artLine, { backgroundColor: theme.accentLight + '66', width: 35 }]} />
            <View style={[esS.artLine, { backgroundColor: theme.secondary + '55', width: 24 }]} />
          </View>
        </LinearGradient>
      </View>
      <Text style={esS.title}>{title}</Text>
      <Text style={esS.desc}>{description}</Text>
      {action && (
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
  illustration: { width: 150, height: 128, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  orbit: { position: 'absolute', width: 122, height: 122, borderRadius: 61, borderWidth: 1 },
  floor: { position: 'absolute', bottom: 10, width: 94, height: 16, borderRadius: 12, transform: [{ scaleX: 1.2 }] },
  artCard: { width: 91, height: 94, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-4deg' }] },
  artInset: { width: 57, height: 57, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  artLines: { position: 'absolute', bottom: 10, right: 9, gap: 3, alignItems: 'flex-end' },
  artLine: { height: 3, borderRadius: 2 },
  spark: { position: 'absolute', width: 7, height: 7, borderRadius: 4 },
  sparkOne: { top: 20, right: 14 },
  sparkTwo: { left: 19, bottom: 27, width: 5, height: 5 },
  title:   { fontSize: FS.lg, fontFamily: FONT.bold, color: FG, textAlign: 'center', letterSpacing: -0.2 },
  desc:    { maxWidth: 330, fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 21 },
  actions: { width: '100%', gap: SP.sm, marginTop: SP.sm },
  btn:     { width: '100%' },
});

export function BrandedLoader({ label = 'Stitching things together…', style }: {
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const pulse = useRef(new Animated.Value(0.72)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.72, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={[brLoaderS.root, style]}>
      <Animated.View style={[brLoaderS.mark, { backgroundColor: theme.accentDim, borderColor: theme.accent + '70', opacity: pulse, transform: [{ scale: pulse }] }]}>
        <View style={[brLoaderS.thread, { borderColor: theme.accentLight }]} />
        <Feather name="scissors" size={22} color={theme.accentLight} />
      </Animated.View>
      <Text style={brLoaderS.label}>{label}</Text>
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
      <Text style={shS.title}>{title}</Text>
      {action && (
        <PressableScale
          onPress={action.onPress}
          accessibilityLabel={action.label}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[shS.action, { color: theme.accentLight }]}>{action.label}</Text>
        </PressableScale>
      )}
    </View>
  );
}

const shS = StyleSheet.create({
  root:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: SP.md, marginBottom: SP.sm },
  title:  { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  action: { fontSize: FS.sm, fontFamily: FONT.medium },
});

// ─── StatCard ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  icon: keyof typeof Feather.glyphMap;
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
        <Feather name={icon} size={ICON.sm} color={resolvedAccent} />
      </View>
      <Text style={scS.value}>{value}</Text>
      <Text style={scS.label}>{label}</Text>
      {change && (
        <View style={scS.changeRow}>
          <Feather name={positive ? 'trending-up' : 'trending-down'} size={10} color={positive ? SUCCESS : RED} />
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
  change:   { fontSize: 10, fontFamily: FONT.semibold },
});

// ─── QuickActionCard ──────────────────────────────────────────────────────────

interface QuickActionCardProps {
  icon: keyof typeof Feather.glyphMap;
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
      style={[qaS.root, style]}
      testID={`quick-action-card-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <View style={[qaS.iconWrap, { backgroundColor: resolvedAccent + '18' }]}>
        <Feather name={icon} size={ICON.md} color={resolvedAccent} />
        {badge && <View style={[qaS.dot, { backgroundColor: theme.accent }]} />}
      </View>
      <Text
        style={qaS.label}
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
             borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
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
  text: { fontSize: 8, fontFamily: FONT.bold, letterSpacing: 0.5 },
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
      <Feather name="lock" size={9} color={theme.onAccent} />
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
  text: { fontSize: 8, fontFamily: FONT.bold, letterSpacing: 0.5 },
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
}

export function FormInput({
  label, value, onChange, placeholder, multiline, secureTextEntry, keyboardType,
  returnKeyType, onSubmitEditing, style, rightElement,
}: FormInputProps) {
  const [focused, setFocused] = useState(false);
  const { theme } = useAppTheme();
  return (
    <View style={[fiS.wrap, style]}>
      {label && <Text style={fiS.label}>{label}</Text>}
      <View style={[fiS.inputRow, focused && [fiS.focusedRow, { borderColor: theme.accent }], multiline && fiS.multilineRow]}>
        <TextInput
          style={[fiS.input, multiline && fiS.multilineInput]}
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
    </View>
  );
}

const fiS = StyleSheet.create({
  wrap:         { gap: SP.sm },
  label:        { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 0.2 },
  inputRow:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD,
                  borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
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
          <Text style={pcS.pct}>{percent}% complete</Text>
          {label && <Text style={pcS.label}>{label}</Text>}
        </View>
        {onContinue && (
          <PrimaryButton label="Continue" onPress={onContinue} small style={{ alignSelf: 'flex-end', minWidth: 108 }} />
        )}
      </View>
      <View style={pcS.track}>
        <Animated.View style={[pcS.fill, { backgroundColor: theme.accent, width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      </View>
      {nextLabel && <Text style={pcS.next}>Next: {nextLabel}</Text>}
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
  icon: keyof typeof Feather.glyphMap;
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
      style={[ncS.root, style]}
    >
      <View style={[ncS.iconWrap, { backgroundColor: resolvedAccent + '18' }]}>
        <Feather name={icon} size={ICON.md} color={resolvedAccent} />
      </View>
      <View style={ncS.body}>
        <View style={ncS.labelRow}>
          <Text style={ncS.label}>{label}</Text>
          {badge !== undefined && badge !== false && (
            typeof badge === 'number'
              ? <View style={[ncS.badgeCount, { backgroundColor: theme.accent }]}><Text style={[ncS.badgeText, { color: theme.onAccent }]}>{badge}</Text></View>
              : <View style={[ncS.dot, { backgroundColor: theme.accent }]} />
          )}
        </View>
        {description && <Text style={ncS.desc} numberOfLines={1}>{description}</Text>}
      </View>
      {right ?? <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />}
    </PressableScale>
  );
}

const ncS = StyleSheet.create({
  root:       { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: 13,
                paddingHorizontal: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md,
                borderWidth: 1, borderColor: BORDER },
  iconWrap:   { width: 40, height: 40, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  body:       { flex: 1 },
  labelRow:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  label:      { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
  desc:       { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  dot:        { width: 6, height: 6, borderRadius: 3 },
  badgeCount: { borderRadius: RADIUS.pill, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText:  { fontSize: 9, fontFamily: FONT.bold },
});

// ─── LoadingSkeleton ──────────────────────────────────────────────────────────

export function LoadingSkeleton({ height = 80, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
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

export function HapticSwitch({ onValueChange, ...props }: SwitchProps) {
  return (
    <Switch
      {...props}
      onValueChange={(value) => {
        hapticSelection();
        onValueChange?.(value);
      }}
    />
  );
}

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
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 950, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 950, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <View style={[blS.root, style]}>
      <Animated.View style={{ opacity: pulse }}>
        <LinearGradient
          colors={theme.primaryGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={blS.iconWrap}
        >
          <Feather name="loader" size={ICON.md} color={theme.onAccent} />
        </LinearGradient>
      </Animated.View>
      {message && <Text style={blS.msg}>{message}</Text>}
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
  const colors = { success: SUCCESS, error: RED, info: BLUE };
  const color = colors[variant];
  return (
    <Animated.View style={[toS.root, { opacity, borderColor: color + '44' }]}>
      <Feather name={variant === 'success' ? 'check-circle' : variant === 'error' ? 'alert-circle' : 'info'} size={ICON.sm} color={color} />
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
  label: { fontSize: FS.xs, fontFamily: FONT.medium, letterSpacing: 0.8,
           textTransform: 'uppercase', opacity: 0.7 },
});
