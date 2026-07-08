import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'gold' | 'default';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export function Badge({ label, variant = 'default' }: BadgeProps) {
  const colors = useColors();

  const config: Record<BadgeVariant, { bg: string; text: string }> = {
    success: { bg: '#4C9A5E22', text: colors.success },
    warning: { bg: '#B98A2E22', text: colors.warning },
    error: { bg: '#EF444422', text: colors.destructive },
    info: { bg: '#4A6FA522', text: colors.info },
    gold: { bg: '#C1440E22', text: colors.primary },
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
