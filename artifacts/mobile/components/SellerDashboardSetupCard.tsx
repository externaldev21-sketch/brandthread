import React from 'react';
import { StyleSheet, Text } from 'react-native';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

/**
 * Brand-new-seller empty state. Never shows fabricated top products/recent
 * orders/action-needed sections — instead a single, honest CTA into the
 * existing "add a product" setup task (same route the setup checklist uses).
 */
export function SellerDashboardSetupCard({
  theme,
  onAddProduct,
  onOpenSetup,
  hasSetupChecklist,
}: {
  theme: AppThemePreset;
  onAddProduct: () => void;
  onOpenSetup: () => void;
  hasSetupChecklist: boolean;
}) {
  return (
    <PressableScale
      onPress={hasSetupChecklist ? onOpenSetup : onAddProduct}
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.borderSubtle }]}
      testID="seller-dashboard-setup-card"
      accessibilityRole="button"
      accessibilityLabel="List your first product to start selling"
    >
      <Text style={[styles.title, { color: theme.text }]}>List your first product</Text>
      <Text style={[styles.body, { color: theme.muted }]}>
        Your sales, orders, and store activity will show up here as soon as your first product goes live.
      </Text>
      <PrimaryButton label="Add a product" icon="plus" small onPress={onAddProduct} style={styles.button} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: SP.lg,
    // Card opens straight on the title (no icon tile); the title's own line
    // height already adds a few px above the glyphs, so trim the top.
    paddingTop: SP.md + SP.xs,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    alignItems: 'flex-start',
    gap: SP.xs,
  },
  title: {
    fontFamily: FONT.bold,
    fontSize: FS.md,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    lineHeight: 20,
    marginBottom: SP.sm,
  },
  button: {
    alignSelf: 'stretch',
  },
});
