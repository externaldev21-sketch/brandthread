import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useRouter } from 'expo-router';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { useLaunchChecklist } from '@/hooks/useLaunchChecklist';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

/**
 * Brand-new-seller empty state. Never shows fabricated top products/recent
 * orders/action-needed sections — instead a single, honest CTA into the
 * existing "add a product" setup task (same route the setup checklist uses).
 *
 * Sized ~20-25% down from the first cut (Dev, reviewing a 393x852
 * screenshot): 17px title, 13px body, compact padding and a
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
  const router = useRouter();
  // Products are live but nothing has sold yet: the next step is sharing the
  // store, not adding a first product (first_product counts live products only).
  const { checklist } = useLaunchChecklist();
  const hasLiveProduct = checklist?.steps.find((step) => step.id === 'first_product')?.done ?? false;
  if (hasLiveProduct) {
    const share = () => router.push('/share-store' as never);
    return (
      <View
        style={[styles.card, { backgroundColor: theme.card, borderColor: theme.borderSubtle }]}
        testID="seller-dashboard-share-card"
      >
        <PressableScale onPress={share} accessibilityRole="button" accessibilityLabel="Share your store to get your first sale">
          <View style={styles.cardContent}>
            <Text style={[styles.title, { color: theme.text }]}>Share your store</Text>
            <Text style={[styles.body, { color: theme.muted }]}>
              Your products are live. Share your store link to get your first sale.
            </Text>
          </View>
        </PressableScale>
        <PrimaryButton label="Share your store" icon="share" small onPress={share} style={styles.button} testID="seller-dashboard-share-store" />
      </View>
    );
  }
  return (
    <View
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.borderSubtle }]}
      testID="seller-dashboard-setup-card"
    >
      <PressableScale
        onPress={hasSetupChecklist ? onOpenSetup : onAddProduct}
        accessibilityRole="button"
        accessibilityLabel="List your first product to start selling"
      >
      <View style={styles.cardContent}>
      <Text style={[styles.title, { color: theme.text }]}>List your first product</Text>
      <Text style={[styles.body, { color: theme.muted }]}>
        Your sales, orders, and store activity will show up here as soon as your first product goes live.
      </Text>
      </View>
      </PressableScale>
      <PrimaryButton label="Add a product" icon="plus" small onPress={onAddProduct} style={styles.button} testID="seller-dashboard-setup-add-product" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: SP.md,
    paddingTop: SP.sm,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    alignItems: 'flex-start',
    gap: SP.xs,
  },
  cardContent: {
    gap: SP.xs,
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
