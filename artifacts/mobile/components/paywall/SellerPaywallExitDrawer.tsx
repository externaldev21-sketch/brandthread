/**
 * Exit drawer — shown when a seller tries to leave the paywall without
 * starting a trial. Keeps the recommended plan selected, reframes its real
 * price per week/day, shows the other plans compactly, and repeats the same
 * trial CTA. No discount here — that only ever lives in
 * SellerPaywallOneTimeOffer, gated separately.
 *
 * Runs on the shared `<Sheet>` (spring open, flick to dismiss, title row
 * with a circular close); the trial CTA is pinned in the sheet's footer so
 * it stays above the home indicator.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FONT, FS, SP } from '@/lib/theme';
import { weeklyEquivalentFor, dailyEquivalentFor } from '@/lib/sellerPlansDisplay';
import type { SellerPlanDefinition } from '@/lib/sellerPlans';
import { SellerPlanSelector, type PlanPricing } from './SellerPlanSelector';
import { SellerPaywallCTA } from './SellerPaywallCTA';
import type { useAppTheme } from '@/contexts/AppThemeContext';
import type { ButtonProps } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/BottomSheet';

export interface SellerPaywallExitDrawerProps {
  visible: boolean;
  onClose: () => void;
  theme: ReturnType<typeof useAppTheme>['theme'];
  plans: SellerPlanDefinition[];
  recommendedId: string | null;
  currentPlanId: string | null;
  isOnboarding: boolean;
  selectedId: string | null;
  onSelect: (planId: SellerPlanDefinition['id']) => void;
  getPricing: (plan: SellerPlanDefinition) => PlanPricing;
  selectedPlan: SellerPlanDefinition;
  hasRealTrialOffer: boolean;
  onStartTrial: ButtonProps['onPress'];
  loading?: boolean;
  ctaDisabled?: boolean;
}

export function SellerPaywallExitDrawer({
  visible, onClose, theme, plans, recommendedId, currentPlanId, isOnboarding,
  selectedId, onSelect, getPricing, selectedPlan, hasRealTrialOffer, onStartTrial, loading, ctaDisabled,
}: SellerPaywallExitDrawerProps) {
  const weekly = weeklyEquivalentFor(selectedPlan);
  const daily = dailyEquivalentFor(selectedPlan);
  const pricing = getPricing(selectedPlan);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Not ready to commit?"
      testID="seller-paywall-exit-drawer"
      footer={(
        <SellerPaywallCTA
          theme={theme}
          label={hasRealTrialOffer ? 'Start my 5-day free trial' : `Choose ${selectedPlan.name}`}
          onPress={onStartTrial}
          icon={hasRealTrialOffer ? 'chevron-right' : undefined}
          loading={loading}
          disabled={ctaDisabled}
          testID="seller-paywall-exit-drawer-cta"
          subtext="No commitment. Cancel anytime."
        />
      )}
    >
      {!pricing.loading && !pricing.failed && (
        <Text style={[styles.reframe, { color: theme.muted }]}>
          {`${pricing.priceLabel ?? selectedPlan.priceLabel}${pricing.period}, that's about ${weekly}${daily ? ` (${daily})` : ''}`}
        </Text>
      )}

      <View style={{ marginTop: SP.md }}>
        <SellerPlanSelector
          theme={theme}
          plans={plans}
          recommendedId={recommendedId}
          currentPlanId={currentPlanId}
          isOnboarding={isOnboarding}
          selectedId={selectedId}
          onSelect={onSelect}
          getPricing={getPricing}
          compact
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reframe: { fontSize: FS.sm, fontFamily: FONT.regular },
});
