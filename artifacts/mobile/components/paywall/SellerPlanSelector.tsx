/**
 * Plan selector — recommended tier + one neighbor by default, "View all
 * plans" reveals the rest (never more than 2 cards up front). The top tier
 * always renders inverted (white card / black text) for premium contrast.
 * Self-contained so it can be swapped for an A/B variant without touching
 * the rest of the paywall.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { weeklyEquivalentFor } from '@/lib/sellerPlansDisplay';
import type { SellerPlanDefinition } from '@/lib/sellerPlans';
import type { useAppTheme } from '@/contexts/AppThemeContext';
import { minHitSlop } from '@/lib/hitSlop';

// "View all plans" is a 32pt-tall full-width text link.
const VIEW_ALL_HIT_SLOP = minHitSlop({ height: 32 });

export interface PlanPricing {
  priceLabel: string | null;
  period: string;
  loading: boolean;
  failed: boolean;
}

export interface SellerPlanSelectorProps {
  theme: ReturnType<typeof useAppTheme>['theme'];
  plans: SellerPlanDefinition[];
  recommendedId: string | null;
  currentPlanId: string | null;
  isOnboarding: boolean;
  selectedId: string | null;
  onSelect: (planId: SellerPlanDefinition['id']) => void;
  getPricing: (plan: SellerPlanDefinition) => PlanPricing;
  /** Compact mode drops the feature list — used inside the exit drawer. */
  compact?: boolean;
}

export function SellerPlanSelector({
  theme, plans, recommendedId, currentPlanId, isOnboarding, selectedId, onSelect, getPricing, compact,
}: SellerPlanSelectorProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [showAll, setShowAll] = useState(false);

  const recommendedIndex = recommendedId ? plans.findIndex((p) => p.id === recommendedId) : -1;
  const neighborId = recommendedIndex === -1
    ? null
    : plans[recommendedIndex + 1]?.id ?? plans[recommendedIndex - 1]?.id ?? null;
  const defaultVisibleIds = Array.from(new Set(
    [recommendedId, neighborId, !isOnboarding ? currentPlanId : null].filter(Boolean),
  )) as string[];
  const visiblePlans = showAll || defaultVisibleIds.length >= plans.length
    ? plans
    : plans.filter((p) => defaultVisibleIds.includes(p.id));
  const hasHiddenPlans = !showAll && visiblePlans.length < plans.length;
  const isTopTier = (planId: string) => plans[plans.length - 1]?.id === planId;

  function haptic() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }

  return (
    <View style={styles.section}>
      {visiblePlans.map((plan) => {
        const isRecommended = plan.id === recommendedId;
        const isCurrent = !isOnboarding && plan.id === currentPlanId;
        const isSelected = plan.id === selectedId;
        const inverted = isTopTier(plan.id);
        const pricing = getPricing(plan);

        return (
          <TouchableOpacity
            key={plan.id}
            activeOpacity={0.85}
            onPress={() => { haptic(); onSelect(plan.id); }}
            testID={`seller-plan-card-${plan.id}`}
            style={[
              styles.card,
              inverted && styles.cardInverted,
              isSelected && (inverted ? styles.cardSelectedInverted : styles.cardSelected),
            ]}
          >
            {isRecommended && (
              <View style={[styles.recBadge, inverted && styles.recBadgeOnInverted]}>
                <Text style={[styles.recBadgeText, inverted && styles.recBadgeTextOnInverted]}>RECOMMENDED</Text>
              </View>
            )}

            <View style={styles.topRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.planName, inverted && styles.textOnInverted]}>{plan.name}</Text>
                {!compact && <Text style={[styles.tagline, inverted && styles.mutedOnInverted]}>{plan.tagline}</Text>}
              </View>
              <View style={styles.priceCol}>
                {pricing.loading ? (
                  <View style={styles.priceSkeleton} />
                ) : (
                  <Text style={[styles.priceLabel, inverted && styles.textOnInverted]}>
                    {pricing.failed ? '—' : pricing.priceLabel}
                  </Text>
                )}
                <Text style={[styles.pricePeriod, inverted && styles.mutedOnInverted]}>{pricing.period}</Text>
                {!pricing.loading && !pricing.failed && (
                  <Text style={[styles.priceWeekly, inverted && styles.mutedOnInverted]}>{weeklyEquivalentFor(plan)}</Text>
                )}
              </View>
            </View>

            {isCurrent && (
              <View style={styles.currentRow}>
                <Feather name="check-circle" size={13} color={inverted ? theme.background : theme.success} />
                <Text style={[styles.currentRowText, inverted && styles.mutedOnInverted]}>Current plan</Text>
              </View>
            )}

            {!compact && (
              <View style={styles.featureList}>
                {plan.features.slice(0, 4).map((f) => (
                  <View key={f} style={styles.featureRow}>
                    <Feather name="check" size={13} color={inverted ? theme.background : theme.text} style={{ marginTop: 2 }} />
                    <Text style={[styles.featureText, inverted && styles.textOnInverted]}>{f}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.radioRow}>
              <Feather
                name={isSelected ? 'check-circle' : 'circle'}
                size={18}
                color={inverted ? theme.background : (isSelected ? theme.text : theme.muted)}
              />
              <Text style={[styles.radioText, inverted && styles.textOnInverted]}>
                {isSelected ? 'Selected' : 'Select this plan'}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}

      {hasHiddenPlans && (
        <TouchableOpacity
          style={styles.viewAllRow}
          onPress={() => { haptic(); setShowAll(true); }}
          hitSlop={VIEW_ALL_HIT_SLOP}
          accessibilityRole="button"
          testID="seller-plans-view-all"
        >
          <Text style={styles.viewAllText}>View all plans</Text>
          <Feather name="chevron-down" size={14} color={theme.muted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  section: { gap: 12 },
  card: {
    backgroundColor: theme.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.border,
    padding: SP.lg, gap: SP.sm,
  },
  cardSelected: { borderColor: theme.text, borderWidth: 2 },
  cardInverted: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  cardSelectedInverted: {
    borderColor: '#FFFFFF', borderWidth: 2, shadowColor: '#FFFFFF', shadowOpacity: 0.25,
    shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  textOnInverted: { color: '#0A0A0B' },
  mutedOnInverted: { color: 'rgba(10,10,11,0.6)' },

  recBadge: { alignSelf: 'center', backgroundColor: theme.accent, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 2 },
  recBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.onAccent, letterSpacing: 0.6 },
  recBadgeOnInverted: { backgroundColor: '#0A0A0B' },
  recBadgeTextOnInverted: { color: '#FFFFFF' },

  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  planName: { fontSize: FS.xl, fontFamily: FONT.semibold, color: theme.text },
  tagline: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  priceCol: { alignItems: 'flex-end' },
  priceLabel: { fontSize: 26, fontFamily: FONT.semibold, color: theme.text, letterSpacing: -0.5 },
  pricePeriod: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  priceWeekly: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 1 },

  currentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  currentRowText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.success },

  featureList: { gap: 6 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text, lineHeight: 18 },

  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  radioText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },

  viewAllRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: SP.sm },
  viewAllText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted, textDecorationLine: 'underline' },

  priceSkeleton: { width: 64, height: 26, borderRadius: RADIUS.xs, backgroundColor: theme.border },
});
