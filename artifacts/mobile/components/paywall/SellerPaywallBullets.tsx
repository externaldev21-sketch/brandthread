/**
 * Short, scannable benefit bullets — users don't read paragraphs on a
 * paywall. Kept as its own component so copy/length can be A/B tested.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { FONT, FS } from '@/lib/theme';
import type { useAppTheme } from '@/contexts/AppThemeContext';

export interface SellerPaywallBulletsProps {
  theme: ReturnType<typeof useAppTheme>['theme'];
  bullets: string[];
}

export function SellerPaywallBullets({ theme, bullets }: SellerPaywallBulletsProps) {
  return (
    <View style={styles.list}>
      {bullets.map((bullet) => (
        <View key={bullet} style={styles.row}>
          <Icon name="check" size={15} color={theme.text} style={{ marginTop: 2 }} />
          <Text style={[styles.text, { color: theme.text }]}>{bullet}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  text: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 19 },
});
