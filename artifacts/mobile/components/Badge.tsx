import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'gold' | 'default';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  colors?: { success: string; warning: string; destructive: string; info: string; primary: string; secondary: string; mutedForeground: string };
}

export function Badge({ label, variant = 'default', colors: colorsProp }: BadgeProps) {
  const themeColors = useColors();
  const colors = colorsProp ?? themeColors;

  const config: Record<BadgeVariant, { bg: string; text: string }> = {
    success: { bg: '#4C9A5E22', text: colors.success },
    warning: { bg: '#B98A2E22', text: colors.warning },
    error: { bg: '#EF444422', text: colors.destructive },
    info: { bg: '#4A6FA522', text: colors.info },
    gold: { bg: '#00C85322', text: colors.primary },
    default: { bg: colors.secondary, text: colors.mutedForeground },
  };

  const { bg, text } = config[variant];

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

// ─── CountBadge (Phase 1 design system) ───────────────────────────────────────
// A small numeric count bubble (unread counts, cart quantity, notification
// dots) — the same shape used by the buyer/seller tab bar badge
// (components/tab-bar/TabBarParts.tsx TabBarBadge), exposed here for reuse
// outside the tab bar. Renders nothing when count is 0 or less.

export interface CountBadgeProps {
  count: number;
  max?: number;
  accentColor?: string;
  onAccentColor?: string;
}

export function CountBadge({ count, max = 99, accentColor, onAccentColor }: CountBadgeProps) {
  const themeColors = useColors();
  const bg = accentColor ?? themeColors.primary;
  const fg = onAccentColor ?? themeColors.primaryForeground;
  if (count <= 0) return null;
  const label = count > max ? `${max}+` : String(count);
  return (
    <View style={[countBadgeStyles.root, { backgroundColor: bg }, label.length > 1 && countBadgeStyles.wide]}>
      <Text style={[countBadgeStyles.label, { color: fg }]} maxFontSizeMultiplier={1.1}>{label}</Text>
    </View>
  );
}

const countBadgeStyles = StyleSheet.create({
  root: {
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 2,
  },
  wide: { paddingHorizontal: 4 },
  label: { fontSize: 11, fontFamily: 'Inter_700Bold', lineHeight: 13 },
});
