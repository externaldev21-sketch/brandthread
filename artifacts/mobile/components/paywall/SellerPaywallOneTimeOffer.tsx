/**
 * One-time offer sheet — shown after a seller dismisses the exit drawer,
 * ONLY when `isOneTimeOfferAvailable` (lib/paywallRetentionConfig.ts) is
 * true. Off by default: no real discounted product exists yet, so this
 * component is currently unreachable in production. The discount is always
 * computed from the real plan price — never a separate hard-coded number.
 *
 * Runs on the shared `<Sheet>`, like SellerPaywallExitDrawer: the offer is
 * the body, the claim CTA is pinned in the footer.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FONT, FS } from '@/lib/theme';
import type { SellerPlanDefinition } from '@/lib/sellerPlans';
import { SellerPaywallCTA } from './SellerPaywallCTA';
import type { useAppTheme } from '@/contexts/AppThemeContext';
import type { ButtonProps } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/BottomSheet';

export interface SellerPaywallOneTimeOfferProps {
  visible: boolean;
  onClose: () => void;
  theme: ReturnType<typeof useAppTheme>['theme'];
  plan: SellerPlanDefinition;
  discountPercent: number;
  onAccept: ButtonProps['onPress'];
  loading?: boolean;
  disabled?: boolean;
}

export function SellerPaywallOneTimeOffer({
  visible, onClose, theme, plan, discountPercent, onAccept, loading, disabled,
}: SellerPaywallOneTimeOfferProps) {
  const discountedCents = Math.round(plan.priceCents * (1 - discountPercent / 100));
  const discountedLabel = `$${(discountedCents / 100).toFixed(2)}`;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      testID="seller-paywall-one-time-offer"
      accessibilityLabel="One-time offer"
      footer={(
        <SellerPaywallCTA
          theme={theme}
          label={`Claim ${discountPercent}% off`}
          onPress={onAccept}
          loading={loading}
          disabled={disabled}
          testID="seller-paywall-one-time-offer-cta"
          subtext="One-time offer, applied to your first month only."
        />
      )}
    >
      <View style={styles.wrap}>
        <Text style={[styles.eyebrow, { color: theme.muted }]}>A ONE-TIME OFFER FOR NEW BRANDS</Text>
        <Text style={[styles.title, { color: theme.text }]}>
          {discountPercent}% off {plan.name} for your first month
        </Text>
        <Text style={[styles.priceRow, { color: theme.text }]}>
          {discountedLabel}
          <Text style={[styles.strike, { color: theme.muted }]}>  {plan.priceLabel}</Text>
        </Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 4 },
  eyebrow: { fontSize: FS.xs, fontFamily: FONT.semibold, letterSpacing: 1.2 },
  title: { fontSize: FS.xl, fontFamily: FONT.bold, textAlign: 'center', marginTop: 8 },
  priceRow: { fontSize: 26, fontFamily: FONT.semibold, marginTop: 12 },
  strike: { fontSize: FS.sm, fontFamily: FONT.regular, textDecorationLine: 'line-through' },
});
