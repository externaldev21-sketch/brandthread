import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useRevenueCat } from '@/lib/revenueCat';
import { SELLER_PACKAGE_IDS, type SellerPlanId } from '@/lib/sellerBilling';
import { recommendSellerPlan, SELLER_PLANS } from '@/lib/sellerPlans';

export function SellerPlanRecommendationStep({
  brandStage,
  goals,
  selectedPlanId,
  onSelect,
  onContinue,
}: {
  brandStage: string;
  goals: string[];
  selectedPlanId: SellerPlanId;
  onSelect: (planId: SellerPlanId) => void;
  onContinue: () => void;
}) {
  const { theme } = useAppTheme();
  const { packages } = useRevenueCat();
  const recommendation = recommendSellerPlan(brandStage, goals);

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <Text style={[styles.eyebrow, { color: theme.secondary }]}>YOUR PERSONALIZED PLAN</Text>
      <Text style={styles.title}>We recommend {SELLER_PLANS.find((plan) => plan.id === recommendation.planId)?.onboardingName}</Text>
      <Text style={styles.reason}>{recommendation.reason}</Text>
      <Text style={styles.guidance}>This is guidance, not a gate. Pick any plan, and change it before subscribing.</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.planRow}>
        {SELLER_PLANS.map((plan) => {
          const selected = selectedPlanId === plan.id;
          const recommended = recommendation.planId === plan.id;
          const product = packages.find((pkg) => pkg.identifier === SELLER_PACKAGE_IDS[plan.id])?.product;
          const price = Platform.OS === 'web' ? plan.priceLabel : product?.priceString ?? plan.priceLabel;
          return (
            <TouchableOpacity
              key={plan.id}
              testID={`onboarding-plan-${plan.id}`}
              activeOpacity={0.82}
              onPress={() => onSelect(plan.id)}
              style={[
                styles.card,
                selected && { borderColor: theme.accent, backgroundColor: theme.accentDim },
              ]}
            >
              <View style={styles.badgeRow}>
                {recommended && (
                  <View style={[styles.badge, { backgroundColor: theme.secondaryDim }]}>
                    <Feather name="star" size={10} color={theme.secondary} />
                    <Text style={[styles.badgeText, { color: theme.secondary }]}>RECOMMENDED</Text>
                  </View>
                )}
                {selected && <Feather name="check-circle" size={18} color={theme.accentLight} />}
              </View>
              <Text style={styles.planName}>{plan.onboardingName}</Text>
              {plan.onboardingName !== plan.name && <Text style={styles.internalName}>Scale plan</Text>}
              <Text style={styles.tagline}>{plan.tagline}</Text>
              <Text style={[styles.price, selected && { color: theme.accentLight }]}>{price}<Text style={styles.period}>/mo</Text></Text>
              <View style={styles.features}>
                {plan.features.map((feature) => (
                  <View key={feature} style={styles.featureRow}>
                    <Feather name="check" size={13} color={selected ? theme.accentLight : '#34D399'} />
                    <Text style={styles.feature}>{feature}</Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TouchableOpacity onPress={onContinue} activeOpacity={0.86} style={[styles.continue, { backgroundColor: theme.accent }]}>
        <Text style={[styles.continueText, { color: theme.onAccent }]}>
          Continue with {SELLER_PLANS.find((plan) => plan.id === selectedPlanId)?.onboardingName}
        </Text>
      </TouchableOpacity>
      <Text style={styles.chargeNote}>No charge is made on this step.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, paddingTop: 10, paddingBottom: 40 },
  eyebrow: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.2, marginBottom: 8 },
  title: { color: '#FFF', fontSize: 30, lineHeight: 36, fontFamily: 'Inter_700Bold', letterSpacing: -0.7 },
  reason: { color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 21, fontFamily: 'Inter_500Medium', marginTop: 10 },
  guidance: { color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 18, fontFamily: 'Inter_400Regular', marginTop: 8 },
  planRow: { gap: 12, paddingVertical: 22, paddingRight: 24 },
  card: { width: 270, minHeight: 390, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.11)', backgroundColor: 'rgba(255,255,255,0.045)', padding: 18 },
  badgeRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', gap: 5, alignItems: 'center', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  planName: { color: '#FFF', fontSize: 24, fontFamily: 'Inter_700Bold', marginTop: 10 },
  internalName: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: -1 },
  tagline: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular', marginTop: 3 },
  price: { color: '#FFF', fontSize: 30, fontFamily: 'Inter_700Bold', marginTop: 14 },
  period: { color: 'rgba(255,255,255,0.42)', fontSize: 12, fontFamily: 'Inter_400Regular' },
  features: { gap: 10, marginTop: 18 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  feature: { flex: 1, color: 'rgba(255,255,255,0.78)', fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  continue: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  continueText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  chargeNote: { color: 'rgba(255,255,255,0.35)', fontSize: 11, textAlign: 'center', marginTop: 8, fontFamily: 'Inter_400Regular' },
});
