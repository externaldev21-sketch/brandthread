import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';

/**
 * One shared empty/error state used on every list and grid: icon, one-line
 * message, one clear action. Pass `variant="error"` for failures so the icon
 * reads as a problem rather than "nothing here yet".
 */
export function EmptyState({
  icon,
  message,
  actionLabel,
  onAction,
  variant = 'empty',
}: {
  icon: keyof typeof Feather.glyphMap;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: 'empty' | 'error';
}) {
  const { theme } = useAppTheme();
  const iconColor = variant === 'error' ? theme.error : theme.muted;

  return (
    <View style={styles.wrap}>
      <View style={[styles.iconCircle, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Feather name={icon} size={ICON.xl} color={iconColor} />
      </View>
      <Text style={[styles.message, { color: theme.muted }]}>{message}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onAction}
          style={[styles.actionBtn, { backgroundColor: theme.accent }]}
        >
          <Text style={[styles.actionLabel, { color: theme.onAccent }]}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SP.xxl,
    paddingHorizontal: SP.lg,
    gap: SP.md,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: RADIUS.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    fontFamily: FONT.medium,
    fontSize: FS.base,
    textAlign: 'center',
  },
  actionBtn: {
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm + 2,
    borderRadius: RADIUS.pill,
    marginTop: SP.xs,
  },
  actionLabel: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
});
