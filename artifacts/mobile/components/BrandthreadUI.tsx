/**
 * Brandthread Shared UI Components
 *
 * Every Seller screen should import from here.
 * Do not create one-off buttons, cards or headers in individual screen files.
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, ActivityIndicator, Animated, Platform,
  ViewStyle, TextStyle, StyleProp, Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import Svg, { Line as SvgLine } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE, BORDER_FOCUS,
  FG, MUTED, SUBTLE, ON_DARK,
  SUCCESS, SUCCESS_DIM, GREEN_BRIGHT,
  BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM,
  SHADOW_PURPLE, SHADOW_SM,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

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
    backgroundColor: BG,
    paddingTop: noSafeTop ? 0 : insets.top,
    paddingBottom: noSafeBottom ? 0 : 0,
  };
  if (scrollable) {
    return (
      <View style={[containerStyle, style]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, SP.md) + COMP.tabBarH + SP.md }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
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
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onBack(); }}
            style={hdrS.back}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
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
    backgroundColor: elevated ? CARD_ELEVATED : CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    ...(glow ? { ...SHADOW_PURPLE, shadowColor: theme.accent } : {}),
  };
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={[s, style]}>
        {children}
      </TouchableOpacity>
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
      <TouchableOpacity activeOpacity={0.82} onPress={onPress}>
        {inner}
      </TouchableOpacity>
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
  const buttonColors = colors ?? [theme.accent, theme.accentLight] as const;
  const foreground = colors ? ON_DARK : theme.onAccent;
  const h = small ? COMP.buttonHSm : COMP.buttonH;
  return (
    <TouchableOpacity
      activeOpacity={disabled || loading ? 1 : 0.85}
      onPress={() => {
        if (disabled || loading) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={[{ borderRadius: RADIUS.md, overflow: 'hidden' }, style]}
    >
      <LinearGradient
        colors={disabled ? ['#3A3A4E', '#3A3A4E'] : buttonColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[pbS.inner, { height: h }]}
      >
        {loading ? (
          <ActivityIndicator color={foreground} size="small" />
        ) : (
          <>
            {icon && <Feather name={icon} size={ICON.sm} color={disabled ? MUTED : foreground} />}
            <Text style={[pbS.label, { color: foreground, fontSize: small ? FS.sm : FS.base, opacity: disabled ? 0.5 : 1 }]}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
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
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.8}
      onPress={() => {
        if (disabled) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={[sbS.root, { height: h, borderColor: resolvedAccent + '55', backgroundColor: resolvedAccent + '14', opacity: disabled ? 0.5 : 1 }, style]}
    >
      {icon && <Feather name={icon} size={ICON.sm} color={resolvedAccent} />}
      <Text style={[sbS.label, { fontSize: small ? FS.sm : FS.base, color: resolvedAccent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const sbS = StyleSheet.create({
  root:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
           borderRadius: RADIUS.md, borderWidth: 1, backgroundColor: 'rgba(139,92,246,0.08)' },
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
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.65}
      onPress={() => {
        if (disabled) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={[{ height: h, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, opacity: disabled ? 0.4 : 1 }, style]}
    >
      {icon && <Feather name={icon} size={ICON.sm} color={resolvedAccent} />}
      <Text style={{ fontFamily: FONT.semibold, fontSize: small ? FS.sm : FS.base, color: resolvedAccent }}>{label}</Text>
    </TouchableOpacity>
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
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ name, onPress, color = FG, size = ICON.md, badge, badgeCount, style }: IconButtonProps) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
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
    </TouchableOpacity>
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
        onFocus={() => { setFocused(true); onFocus?.(); }}
        onBlur={() => { setFocused(false); onBlur?.(); }}
        returnKeyType="search"
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={ICON.sm} color={MUTED} />
        </TouchableOpacity>
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
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      style={[fcS.chip, active && [fcS.active, { backgroundColor: theme.accentDim, borderColor: theme.accent + '88' }]]}
      activeOpacity={0.8}
    >
      <Text style={[fcS.label, active && [fcS.activeLabel, { color: theme.accentLight }]]}>{label}</Text>
      {count !== undefined && (
        <View style={[fcS.count, active && [fcS.activeCount, { backgroundColor: theme.accentDim }]]}>
          <Text style={[fcS.countText, active && [fcS.activeCountText, { color: theme.accentLight }]]}>{count}</Text>
        </View>
      )}
    </TouchableOpacity>
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
      <View style={esS.iconWrap}>
        <LinearGradient colors={[theme.accentDim, theme.secondaryDim]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[esS.iconBg, { borderColor: theme.accent + '66' }]}>
          <Feather name={icon} size={ICON.xl} color={theme.accentLight} />
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
  root:    { alignItems: 'center', paddingHorizontal: SP.xl, paddingVertical: SP.xxl, gap: SP.md },
  iconWrap:{ marginBottom: SP.sm },
  iconBg:  { width: 72, height: 72, borderRadius: RADIUS.xl, alignItems: 'center', justifyContent: 'center',
             borderWidth: 1, borderColor: BORDER_ACTIVE },
  title:   { fontSize: FS.lg, fontFamily: FONT.bold, color: FG, textAlign: 'center', letterSpacing: -0.2 },
  desc:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 20 },
  actions: { width: '100%', gap: SP.sm, marginTop: SP.sm },
  btn:     { width: '100%' },
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
        <TouchableOpacity onPress={action.onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[shS.action, { color: theme.accentLight }]}>{action.label}</Text>
        </TouchableOpacity>
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
    <TouchableOpacity
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={[qaS.root, style]}
      activeOpacity={0.8}
    >
      <View style={[qaS.iconWrap, { backgroundColor: resolvedAccent + '18' }]}>
        <Feather name={icon} size={ICON.md} color={resolvedAccent} />
        {badge && <View style={[qaS.dot, { backgroundColor: theme.accent }]} />}
      </View>
      <Text style={qaS.label} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const qaS = StyleSheet.create({
  root:    { alignItems: 'center', gap: SP.sm, backgroundColor: CARD,
             borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: 14 },
  iconWrap:{ width: 44, height: 44, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  dot:     { position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 4 },
  label:   { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textAlign: 'center' },
});

// ─── GuidedTip ────────────────────────────────────────────────────────────────

interface GuidedTipProps {
  id: string;
  text: string;
  dismissedIds: string[];
  onDismiss: (id: string) => void;
  style?: StyleProp<ViewStyle>;
}

export function GuidedTip({ id, text, dismissedIds, onDismiss, style }: GuidedTipProps) {
  const { theme } = useAppTheme();
  if (dismissedIds.includes(id)) return null;
  return (
    <View style={[gtS.root, { backgroundColor: theme.accentDim, borderColor: theme.accent + '33' }, style]}>
      <Feather name="zap" size={ICON.xs} color={theme.accentLight} style={{ marginTop: 1 }} />
      <Text style={gtS.text}>{text}</Text>
      <TouchableOpacity
        onPress={() => onDismiss(id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather name="x" size={ICON.xs} color={MUTED} />
      </TouchableOpacity>
    </View>
  );
}

const gtS = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
          borderRadius: RADIUS.sm, borderWidth: 1,
          paddingHorizontal: SP.md, paddingVertical: SP.sm, marginHorizontal: SP.md },
  text: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 18 },
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
    <TouchableOpacity
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={[ncS.root, style]}
      activeOpacity={0.8}
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
    </TouchableOpacity>
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

export function LoadingSkeleton({ height = 80, style }: { height?: number; style?: ViewStyle }) {
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
      style={[{ height, backgroundColor: CARD, borderRadius: RADIUS.md, opacity: anim }, style]}
    />
  );
}

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
          colors={[theme.accent, theme.accentLight]}
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
