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
        <Feather name="plus-circle" size={20} color={theme.accent} />
      </View>
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
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    alignItems: 'flex-start',
    gap: SP.xs,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.xs,
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
