import React from 'react';
import { Text, View } from 'react-native';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { setupCardStyles as styles } from '@/components/SellerDashboardSetupCard';

/**
 * Payout gate prompt in the existing dashboard setup-card styling. Opens the
 * existing Stripe Connect onboarding flow (app/payout-setup.tsx).
 *
 * - `listing`: inline on the listing's Publish step — the listing saves as a
 *   draft until payouts are set up.
 * - `live`: dashboard banner when listings went live before the payout gate.
 */
export function PayoutSetupCard({
  theme,
  variant,
  liveProductCount = 0,
  onSetUpPayouts,
}: {
  theme: AppThemePreset;
  variant: 'listing' | 'live';
  liveProductCount?: number;
  onSetUpPayouts: () => void;
}) {
  const live = variant === 'live';
  const listings = liveProductCount === 1 ? '1 live listing' : `${liveProductCount} live listings`;
  return (
    <View
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.borderSubtle }]}
      testID={live ? 'seller-dashboard-finish-payouts-banner' : 'add-product-payout-setup-card'}
      accessibilityRole="summary"
    >
      <View style={styles.cardContent}>
        <Text style={[styles.title, { color: theme.text }]}>{live ? 'Finish payout setup' : 'Set up payouts'}</Text>
        <Text style={[styles.body, { color: theme.muted }]}>
          {live
            ? `You have ${listings}. Finish payout setup with Stripe so money from their sales reaches your bank.`
            : 'Connect a payout account with Stripe before this goes live. Until then it saves as a draft.'}
        </Text>
      </View>
      <PrimaryButton
        label={live ? 'Finish setup' : 'Set up payouts'}
        icon="credit-card"
        small
        onPress={onSetUpPayouts}
        style={styles.button}
        testID={live ? 'seller-dashboard-finish-payouts' : 'add-product-set-up-payouts'}
      />
    </View>
  );
}
