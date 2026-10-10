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
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { radius } from '@/constants/radii';
import { SELLER_PLANS } from '@/lib/sellerPlans';
import type { SellerPlanId } from '@/lib/sellerBilling';
import { trialCopy } from '@/lib/sellerPlanConfig';

export function PlanStep({
  brandName, recommendedId, selectedId, onSelect, priceLabel, trialDays, reminderDaysBefore,
  onStart, starting, error, onRestore,
}: {
  brandName: string;
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
  const pricesLoading = SELLER_PLANS.some((p) => priceLabel(p.id) === null);

  return (
    <View style={styles.root} testID="onboarding-plan-step">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>
          {days ? 'Start your free trial' : 'Choose your plan'}
        </Text>
        <Text style={[styles.subtitle, { color: palette.mutedForeground }]}>Pick a plan for {brandName}.</Text>

        <View style={styles.cards}>
          {SELLER_PLANS.map((plan) => {
            const selected = plan.id === selectedId;
            const price = priceLabel(plan.id);
            return (
              <Pressable
                key={plan.id}
                testID={`onboarding-plan-${plan.id}`}
                onPress={() => onSelect(plan.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${plan.name}${price ? `, ${price} a month` : ''}`}
                style={[styles.card, { borderColor: selected ? palette.foreground : 'transparent' }]}
              >
                <View style={[styles.radio, { borderColor: selected ? palette.foreground : palette.mutedForeground }]}>
                  {selected ? <View style={[styles.radioDot, { backgroundColor: palette.foreground }]} /> : null}
                </View>
                <View style={styles.cardText}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.planName, { color: palette.foreground }]}>{plan.name}</Text>
                    {plan.id === recommendedId ? (
                      <Text style={[styles.recommended, { color: palette.mutedForeground }]}>Recommended</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.tagline, { color: palette.mutedForeground }]} numberOfLines={2}>{plan.tagline}</Text>
                </View>
                {price ? (
                  <Text style={[styles.price, { color: palette.foreground }]}>{price}<Text style={[styles.per, { color: palette.mutedForeground }]}>/mo</Text></Text>
                ) : (
                  <ActivityIndicator size="small" color={palette.mutedForeground} />
                )}
              </Pressable>
            );
          })}
        </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingTop: SPACING.sm, paddingBottom: SPACING.xl },
  title: { ...TEXT.title1 },
  subtitle: { ...TEXT.subhead, marginTop: SPACING.sm },
  cards: { gap: SPACING.sm, marginTop: SPACING.xl },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 72,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: radius.md, backgroundColor: FILL_ELEVATED, borderWidth: 1,
  },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  cardText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: SPACING.xs },
  planName: { ...TEXT.headline },
  recommended: { ...TEXT.caption, fontFamily: FONT.medium },
  tagline: { ...TEXT.footnote, marginTop: 2 },
  price: { ...TEXT.money },
  per: { ...TEXT.footnote },
  trial: { ...TEXT.subhead, marginTop: SPACING.lg },
  error: { ...TEXT.footnote, marginTop: SPACING.sm },
  footer: { paddingTop: SPACING.xs, gap: SPACING.xs },
  legal: { ...TEXT.caption, textAlign: 'center' },
  link: { textDecorationLine: 'underline' },
  restore: { alignSelf: 'center', paddingVertical: SPACING.xs },
  restoreText: { ...TEXT.footnote, fontFamily: FONT.medium },
  disabledFill: { backgroundColor: FILL_ELEVATED },
});
