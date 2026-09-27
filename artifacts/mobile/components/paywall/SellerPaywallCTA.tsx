/**
 * Trial CTA block: shared Button (56-64pt) + "No commitment" line + the
 * real billing line pulled from the selected plan's price.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FONT, FS } from '@/lib/theme';
import { Button, type ButtonProps } from '@/components/ui/Button';
import type { useAppTheme } from '@/contexts/AppThemeContext';

export interface SellerPaywallCTAProps {
  theme: ReturnType<typeof useAppTheme>['theme'];
  label: string;
  onPress: ButtonProps['onPress'];
  icon?: ButtonProps['icon'];
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  subtext?: string;
  billingLine?: string | null;
}

export function SellerPaywallCTA({
  theme, label, onPress, icon, loading, disabled, testID, subtext, billingLine,
}: SellerPaywallCTAProps) {
  return (
    <View style={styles.section}>
      <Button
        label={label}
        onPress={onPress}
        icon={icon}
        loading={loading}
        disabled={disabled}
        fullWidth
        style={styles.button}
        testID={testID}
      />
      {subtext && <Text style={[styles.subtext, { color: theme.muted }]}>{subtext}</Text>}
      {billingLine && <Text style={[styles.billingLine, { color: theme.muted }]}>{billingLine}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6, alignItems: 'center' },
  button: { height: 60 },
  subtext: { fontSize: FS.xs, fontFamily: FONT.medium },
  billingLine: { fontSize: FS.xs, fontFamily: FONT.regular },
});
