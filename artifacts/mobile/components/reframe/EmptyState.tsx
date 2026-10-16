import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { X_GUTTER, X_SPACE, X_TYPE, xColors } from '@/constants/reframe';

/**
 * Small, quiet X-style empty state: an optional bold 15 line, a gray 15
 * line, and an optional text button — no icon circle, no big headline, no
 * filled button. Left-aligned on the gutter by default (`align="center"`
 * for a state that sits alone in a tall area).
 */
export function EmptyState({
  title, message, actionLabel, onAction, align = 'left', tone = 'empty', style, testID,
}: {
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  align?: 'left' | 'center';
  /** `error` keeps the same quiet layout; only the action wording differs at call sites. */
  tone?: 'empty' | 'error';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const c = xColors(theme);
  const centered = align === 'center';
  return (
    <View
      style={[styles.wrap, centered && styles.centered, style]}
      testID={testID}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
    >
      {!!title && (
        <Text style={[X_TYPE.name, { color: c.text }, centered && styles.textCenter]} accessibilityRole="header">{title}</Text>
      )}
      {!!message && (
        <Text style={[X_TYPE.body, { color: c.secondary }, centered && styles.textCenter]}>{message}</Text>
      )}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          style={({ pressed }) => [styles.action, centered && styles.actionCentered, pressed && styles.pressed]}
          testID={testID ? `${testID}-action` : undefined}
        >
          <Text style={[X_TYPE.name, { color: c.text }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: X_GUTTER, paddingVertical: X_SPACE[24], gap: X_SPACE[4] },
  centered: { alignItems: 'center' },
  textCenter: { textAlign: 'center' },
  action: { alignSelf: 'flex-start', marginTop: X_SPACE[8], minHeight: 32, justifyContent: 'center' },
  actionCentered: { alignSelf: 'center' },
  pressed: { opacity: 0.6 },
});
