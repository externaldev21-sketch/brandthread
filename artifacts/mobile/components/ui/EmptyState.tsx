/**
 * Brandthread Design System — EmptyState (BRANDTHREAD_DESIGN.md, "Copy").
 *
 * One line saying what goes here, plus at most one action. No illustration,
 * no icon badge, no upbeat filler. ("No orders yet." / "Share your store".)
 *
 * `components/BrandthreadUI.tsx`'s EmptyState (icon badge + description)
 * stays for the screens that use it today; restyled screens move to this one.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { Button } from '@/components/ui/Button';

export interface EmptyStateProps {
  /** One plain sentence, e.g. "No orders yet." */
  title: string;
  action?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function EmptyState({ title, action, style, testID }: EmptyStateProps) {
  const palette = useColors();
  return (
    <View style={[styles.root, style]} testID={testID}>
      <Text style={[styles.title, { color: palette.foreground }]}>{title}</Text>
      {action && (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant="secondary"
          size="small"
          testID={testID ? `${testID}-action` : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', gap: SPACING.md, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xxl },
  title: { ...TEXT.headline, textAlign: 'center' },
});
