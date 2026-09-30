/**
 * Paywall headline — big USP + one-line subtitle. Pulled out as its own
 * component so the paywall can A/B test copy variants without touching
 * plan-selector or CTA logic.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FONT, FS } from '@/lib/theme';
import type { useAppTheme } from '@/contexts/AppThemeContext';

export interface SellerPaywallHeadlineProps {
  theme: ReturnType<typeof useAppTheme>['theme'];
  eyebrow: string;
  title: string;
  subtitle: string;
}

export function SellerPaywallHeadline({ theme, eyebrow, title, subtitle }: SellerPaywallHeadlineProps) {
  return (
    <View style={styles.hero}>
      <Text style={[styles.eyebrow, { color: theme.muted }]} allowFontScaling={false}>{eyebrow}</Text>
      <Text style={[styles.title, { color: theme.text }]} allowFontScaling={false}>{title}</Text>
      <Text style={[styles.subtitle, { color: theme.muted }]}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 6, alignItems: 'center', paddingHorizontal: 4 },
  eyebrow: { fontSize: FS.xs, fontFamily: FONT.semibold, letterSpacing: 1.5, textAlign: 'center' },
  title: { fontSize: FS.xxl, fontFamily: FONT.bold, letterSpacing: -0.4, lineHeight: 34, textAlign: 'center' },
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', marginTop: 2 },
});
