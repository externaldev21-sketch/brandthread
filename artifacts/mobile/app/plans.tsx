import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_KEY } from './_layout';

interface Plan {
  id: string;
  name: string;
  tagline: string;
  price: string;
  period: string;
  originalPrice?: string;
  trial?: string;
  features: string[];
  current?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For solo entrepreneurs',
    price: '$0',
    period: '/mo',
    features: [
      'Sell online & in your storefront',
      'Card rates from 2.9% + 30¢ USD',
      'Up to 25 products',
      'Basic analytics',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For growing brands',
    price: '$29',
    period: '/mo',
    originalPrice: '$59',
    trial: '3-month trial',
    features: [
      'Everything in Starter',
      'Card rates from 2.7% + 30¢ USD',
      'Up to 5 staff accounts',
      'Discounted shipping rates',
      'AI Design Studio',
    ],
  },
  {
    id: 'pro',
    name: 'Brandthread Pro',
    tagline: 'For scaling teams',
    price: '$79',
    period: '/mo',
    features: [
      'Everything in Growth',
      'Card rates from 2.5% + 30¢ USD',
      'Up to 15 staff accounts',
      'Manufacturer Hub & Automation',
      'Priority 24/7 support',
    ],
    current: true,
  },
  {
    id: 'scale',
    name: 'Scale',
    tagline: 'For established businesses',
    price: '$199',
    period: '/mo',
    trial: '1-month trial',
    features: [
      'Everything in Pro',
      'Card rates from 2.25% + 30¢ USD',
      'Unlimited staff accounts',
      'Dedicated account manager',
      'White-glove onboarding',
    ],
  },
];

export default function PlansScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { fromOnboarding } = useLocalSearchParams<{ fromOnboarding?: string }>();
  const isOnboarding = fromOnboarding === 'true';
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const topPad = Platform.OS === 'web' ? 24 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom;

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleClose() {
    haptic();
    router.back();
  }

  async function handleSelect(plan: Plan) {
    if (plan.current && !isOnboarding) return;
    haptic();
    setLoadingId(plan.id);

    if (isOnboarding) {
      // Finalise onboarding — mark complete and go to the seller dashboard
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      router.replace('/(tabs)/' as never);
      return;
    }

    setTimeout(() => {
      setLoadingId(null);
      Alert.alert(`Switch to ${plan.name}`, `You're now on the ${plan.name} plan.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }, 400);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={{ width: 40 }} />
        <View style={styles.headerTitleBlock}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {isOnboarding ? 'Choose your plan' : 'Select a plan'}
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {isOnboarding ? 'Start free, upgrade anytime' : 'Change anytime, no long-term contract'}
          </Text>
        </View>
        {isOnboarding ? (
          <View style={{ width: 40 }} />
        ) : (
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: colors.secondary }]}
            activeOpacity={0.7}
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="x" size={18} color={colors.foreground} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 40, gap: 14 }}
      >
        {PLANS.map((plan) => (
          <View
            key={plan.id}
            style={[
              styles.card,
              {
                backgroundColor: plan.current ? '#17140F' : colors.card,
                borderColor: plan.current ? colors.primary : colors.border,
              },
            ]}
          >
            <View style={styles.cardTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.planName, { color: plan.current ? colors.primary : colors.foreground }]}>
                  {plan.name}
                </Text>
                <Text style={[styles.planTagline, { color: plan.current ? `${colors.primaryForeground}99` : colors.mutedForeground }]}>
                  {plan.tagline}
                </Text>
              </View>
              {plan.current && (
                <View style={[styles.currentBadge, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.currentBadgeText, { color: colors.primaryForeground }]}>CURRENT</Text>
                </View>
              )}
            </View>

            <View style={styles.featureList}>
              {plan.features.map((f) => (
                <View key={f} style={styles.featureRow}>
                  <Feather
                    name="check"
                    size={14}
                    color={plan.current ? colors.primary : colors.success}
                    style={{ marginTop: 2 }}
                  />
                  <Text style={[styles.featureText, { color: plan.current ? colors.primaryForeground : colors.foreground }]}>
                    {f}
                  </Text>
                </View>
              ))}
            </View>

            {plan.trial && (
              <View style={[styles.trialPill, { backgroundColor: plan.current ? colors.primary + '22' : `${colors.success}22` }]}>
                <Text style={[styles.trialText, { color: plan.current ? colors.primary : colors.success }]}>{plan.trial}</Text>
              </View>
            )}

            <View style={styles.priceRow}>
              {plan.originalPrice && (
                <Text style={[styles.originalPrice, { color: plan.current ? `${colors.primaryForeground}99` : colors.mutedForeground }]}>
                  {plan.originalPrice}
                </Text>
              )}
              <Text style={[styles.price, { color: plan.current ? colors.primary : colors.foreground }]}>
                {plan.price}
              </Text>
              <Text style={[styles.period, { color: plan.current ? `${colors.primaryForeground}99` : colors.mutedForeground }]}>
                {plan.period}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.ctaBtn,
                {
                  backgroundColor: plan.current ? 'transparent' : colors.primary,
                  borderWidth: plan.current ? 1 : 0,
                  borderColor: colors.primary,
                  opacity: loadingId === plan.id ? 0.6 : 1,
                },
              ]}
              activeOpacity={0.8}
              disabled={plan.current || loadingId !== null}
              onPress={() => handleSelect(plan)}
            >
              <Text
                style={[
                  styles.ctaText,
                  { color: plan.current ? colors.primary : colors.primaryForeground },
                ]}
              >
                {isOnboarding
                  ? (loadingId === plan.id ? 'Starting…' : 'Get started')
                  : plan.current
                    ? 'Current Plan'
                    : loadingId === plan.id
                      ? 'Switching…'
                      : `Switch to ${plan.name}`}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitleBlock: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, textAlign: 'center' },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  planName: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  planTagline: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  currentBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  currentBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  featureList: { gap: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  trialPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  trialText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  originalPrice: { fontSize: 15, fontFamily: 'Inter_500Medium', textDecorationLine: 'line-through' },
  price: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  period: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 4 },
  ctaBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
