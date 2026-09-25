/**
 * Brandthread Design System — ErrorState (Phase 1)
 *
 * A single consistent shape for "something went wrong, try again" states —
 * message + Retry button, vertically centered, matching EmptyState's rhythm
 * (components/BrandthreadUI.tsx) so error and empty states never look like
 * two different apps.
 */
import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

export interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({
  message = 'Something went wrong. Please try again.',
  onRetry,
  retryLabel = 'Retry',
  style,
}: ErrorStateProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  return (
    <View style={[styles.root, style]}>
      <View style={[styles.iconCircle, { borderColor: theme.accent + '40' }]}>
        <Feather name="alert-triangle" size={26} color={palette.mutedForeground} />
      </View>
      <Text style={[TYPE_SCALE.headline, { fontFamily: FONT.semibold, color: palette.foreground, textAlign: 'center' }]}>
        {message}
      </Text>
      {onRetry && (
        <Button label={retryLabel} onPress={onRetry} variant="secondary" size="small" style={styles.retryBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xxl },
  iconCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xxs },
  retryBtn: { marginTop: SPACING.xs, minWidth: 140 },
});
