import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

/**
 * Brand-new-seller empty state. Never shows fabricated top products/recent
 * orders/action-needed sections — instead a single, honest CTA into the
 * existing "add a product" setup task (same route the setup checklist uses).
 *
 * Sized ~20-25% down from the first cut (Dev, reviewing a 393x852
 * screenshot): 36px icon tile, 17px title, 13px body, 16px padding and a
 * slim 36px button that sizes to its own label — the old `alignSelf:
 * 'stretch'` + 44px PrimaryButton rendered its label flush against the
 * rounded right edge and clipped the last glyph ("Add a produc").
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
      <View style={[styles.iconWrap, { backgroundColor: theme.accentDim }]}>
        <Feather name="plus-circle" size={17} color={theme.accent} />
      </View>
      <Text style={[styles.title, { color: theme.text }]}>List your first product</Text>
      <Text style={[styles.body, { color: theme.muted }]}>
        Your sales, orders, and store activity will show up here as soon as your first product goes live.
      </Text>
      <PrimaryButton label="Add a product" icon="plus" small onPress={onAddProduct} style={styles.button} testID="seller-dashboard-setup-add-product" />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: SP.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    alignItems: 'flex-start',
    gap: SP.xs,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: {
    fontFamily: FONT.bold,
    fontSize: FS.md, // 17
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: FONT.regular,
    fontSize: FS.sm, // 13
    lineHeight: 18,
    marginBottom: SP.xs,
  },
  // Sized to its own label (never stretched or fixed-width), slim 36px —
  // the shared PrimaryButton supplies the equal 16px side padding.
  button: {
    alignSelf: 'flex-start',
    height: 36,
  },
});
