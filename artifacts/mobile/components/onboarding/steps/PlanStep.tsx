/**
 * Seller plan + free trial, right after the store preview (value before
 * plan). Shopify's "Start your free trial" step
 * (https://mobbin.com/screens/fbd02e89-25a2-45fd-b10e-ec9bc994be98) with its
 * selectable list rows for the plans, reskinned. There is no skip: seller
 * tools open only with a trial or a paid plan (Dev's decision).
 *
 * Under the cards, Dev's exact copy:
 * "Free for 7 days. You won't be charged until Oct 20. We'll remind you 2 days before. Cancel anytime."
 * The numbers come from the store's intro offer on iOS/Android and from the
 * shared server config on web, so the copy always matches what happens.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import type { SellerPlanId } from '@/lib/sellerBilling';
import { trialCopy } from '@/lib/sellerPlanConfig';
import type { PlanTier } from '@/lib/planTiers';
import { PlanTierCard } from '@/components/plans/PlanTierCard';
import { CompareFeaturesSheet } from '@/components/plans/CompareFeaturesSheet';

export function PlanStep({
  brandName, tiers, commissionPercent, recommendedId, selectedId, onSelect, priceLabel, trialDays, reminderDaysBefore,
  onStart, starting, error, onRestore,
}: {
  brandName: string;
  /** From the shared plan config: product cap first, then the differences. */
  tiers: PlanTier[];
  commissionPercent: number | null;
  recommendedId: SellerPlanId;
  selectedId: SellerPlanId;
  onSelect: (id: SellerPlanId) => void;
  priceLabel: (id: SellerPlanId) => string | null;
  trialDays: (id: SellerPlanId) => number | null;
  reminderDaysBefore: number;
  onStart: () => void;
  starting: boolean;
  error?: string | null;
  /** Native only: App Store / Play "Restore purchases". */
  onRestore?: () => void;
}) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const selectedPrice = priceLabel(selectedId);
  const days = trialDays(selectedId);
  const pricesLoading = tiers.some((t) => priceLabel(t.id) === null);
  const [compareOpen, setCompareOpen] = useState(false);

  return (
    <View style={styles.root} testID="onboarding-plan-step">
      <ScrollView testID="onboarding-plan-scroll" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>
          {days ? 'Start your free trial' : 'Choose your plan'}
        </Text>
        <Text style={[styles.subtitle, { color: palette.mutedForeground }]}>Pick a plan for {brandName}.</Text>

        <View style={styles.cards}>
          {tiers.map((tier, i) => (
            <PlanTierCard
              key={tier.id}
              testID={`onboarding-plan-${tier.id}`}
              tier={tier}
              below={tiers[i - 1] ?? null}
              selected={tier.id === selectedId}
              onSelect={() => onSelect(tier.id)}
              priceLabel={priceLabel(tier.id)}
              badge={tier.id === recommendedId ? 'Recommended' : null}
            />
          ))}
        </View>

        <Pressable onPress={() => setCompareOpen(true)} accessibilityRole="button" hitSlop={8} style={styles.compare} testID="onboarding-plan-compare">
          <Text style={[styles.compareText, { color: palette.foreground }]}>Compare all features</Text>
        </Pressable>

        {days ? (
          <Text testID="onboarding-plan-trial-copy" style={[styles.trial, { color: palette.foreground }]}>
            {trialCopy(days, reminderDaysBefore)}
          </Text>
        ) : null}
        {error ? <Text testID="onboarding-plan-error" style={[styles.error, { color: palette.destructive }]}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}>
        <Button
          label={days ? 'Start free trial' : 'Subscribe'}
          onPress={onStart}
          loading={starting}
          disabled={pricesLoading || !selectedPrice}
          fullWidth
          testID="onboarding-plan-start"
          style={pricesLoading || !selectedPrice ? styles.disabledFill : undefined}
        />
        {selectedPrice ? (
          <Text style={[styles.legal, { color: palette.mutedForeground }]}>
            {days ? `After the trial, ${selectedPrice} a month until you cancel. ` : `${selectedPrice} a month until you cancel. `}
            <Text style={styles.link} onPress={() => router.push('/terms' as never)} accessibilityRole="link">Terms</Text>
            {' · '}
            <Text style={styles.link} onPress={() => router.push('/privacy' as never)} accessibilityRole="link">Privacy</Text>
          </Text>
        ) : null}
        {onRestore ? (
          <Pressable onPress={onRestore} accessibilityRole="button" hitSlop={8} style={styles.restore} testID="onboarding-plan-restore">
            <Text style={[styles.restoreText, { color: palette.mutedForeground }]}>Restore purchases</Text>
          </Pressable>
        ) : null}
      </View>

      <CompareFeaturesSheet visible={compareOpen} onClose={() => setCompareOpen(false)} tiers={tiers} commissionPercent={commissionPercent} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingTop: SPACING.sm, paddingBottom: SPACING.xl },
  title: { ...TEXT.title1 },
  subtitle: { ...TEXT.subhead, marginTop: SPACING.sm },
  cards: { gap: SPACING.sm, marginTop: SPACING.xl },
  compare: { alignSelf: 'flex-start', paddingVertical: SPACING.sm, marginTop: SPACING.xs },
  compareText: { ...TEXT.subhead, fontFamily: FONT.semibold, textDecorationLine: 'underline' },
  trial: { ...TEXT.subhead, marginTop: SPACING.md },
  error: { ...TEXT.footnote, marginTop: SPACING.sm },
  footer: { paddingTop: SPACING.xs, gap: SPACING.xs },
  legal: { ...TEXT.caption, textAlign: 'center' },
  link: { textDecorationLine: 'underline' },
  restore: { alignSelf: 'center', paddingVertical: SPACING.xs },
  restoreText: { ...TEXT.footnote, fontFamily: FONT.medium },
  disabledFill: { backgroundColor: FILL_ELEVATED },
});
