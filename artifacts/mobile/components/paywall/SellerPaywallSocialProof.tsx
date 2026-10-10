/**
 * Social proof line. Qualitative copy only — never an invented number/rating.
 * Swap `text` for a real rating/count once real data exists.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { FONT, FS } from '@/lib/theme';
import type { useAppTheme } from '@/contexts/AppThemeContext';

export interface SellerPaywallSocialProofProps {
  theme: ReturnType<typeof useAppTheme>['theme'];
  text: string;
}

export function SellerPaywallSocialProof({ theme, text }: SellerPaywallSocialProofProps) {
  return (
    <View style={styles.row}>
      <Icon name="users" size={13} color={theme.muted} />
      <Text style={[styles.text, { color: theme.muted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  text: { fontSize: FS.xs, fontFamily: FONT.regular },
});
