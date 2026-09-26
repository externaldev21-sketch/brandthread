import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';

/**
 * One shared empty/error state used on every list and grid: icon in a thin
 * circle, optional title, a one-sentence message that wraps (never clips), and
 * one clear action with a 44pt+ tap target. Pass `variant="error"` for
 * failures so the icon reads as a problem rather than "nothing here yet".
 *
 * Inside a list that scrolls under a floating tab bar, give it the list's
 * empty-area height via `style={{ minHeight }}` (see ProfileShell /
 * computeEmptyArea) so it centres in the visible gap instead of sitting
 * under the bar.
 */
export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  variant = 'empty',
  style,
  testID,
}: {
  icon: keyof typeof Feather.glyphMap;
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: 'empty' | 'error';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const iconColor = variant === 'error' ? theme.error : theme.muted;

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <View style={[styles.iconCircle, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Feather name={icon} size={ICON.xl} color={iconColor} />
      </View>
      <View style={styles.copy}>
        {title ? <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">{title}</Text> : null}
        <Text style={[styles.message, { color: theme.muted }]}>{message}</Text>
      </View>
      {actionLabel && onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={[styles.actionBtn, { backgroundColor: theme.accent }]}
          testID={testID ? `${testID}-action` : undefined}
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
  copy: { alignItems: 'center', gap: SP.xs, maxWidth: 320, alignSelf: 'center' },
  title: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    textAlign: 'center',
  },
  message: {
    fontFamily: FONT.medium,
    fontSize: FS.base,
    lineHeight: 21,
    textAlign: 'center',
    flexShrink: 1,
  },
  actionBtn: {
    minHeight: 44,
    justifyContent: 'center',
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
