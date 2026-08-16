import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, PURPLE_LIGHT,
  CYAN, SUCCESS, ORANGE, RED, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useApi } from '@/hooks/useApi';

// ─── Static plan catalogue ────────────────────────────────────────────────────

interface PlanFeature { text: string; included: boolean }
interface Plan {
  id: string;
  name: string;
  tagline: string;
  price: string;
  period: string;
  highlight?: boolean;
  features: PlanFeature[];
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For solo entrepreneurs',
    price: '$0',
    period: '/mo',
    features: [
      { text: 'Up to 25 products', included: true },
      { text: 'Basic storefront', included: true },
      { text: 'Card rates 2.9% + 30¢', included: true },
      { text: 'AI Design Studio', included: false },
      { text: 'Manufacturer Hub', included: false },
      { text: 'Advanced analytics', included: false },
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For growing brands',
    price: '$29',
    period: '/mo',
    highlight: true,
    features: [
      { text: 'Unlimited products', included: true },
      { text: 'Custom storefront + domain', included: true },
      { text: 'Card rates 2.7% + 30¢', included: true },
      { text: 'AI Design Studio', included: true },
      { text: 'Manufacturer Hub', included: true },
      { text: 'Advanced analytics', included: false },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For established brands',
    price: '$79',
    period: '/mo',
    features: [
      { text: 'Everything in Growth', included: true },
      { text: 'Card rates 2.4% + 30¢', included: true },
      { text: 'Advanced analytics', included: true },
      { text: 'Priority support', included: true },
      { text: 'Dedicated account manager', included: true },
      { text: 'Custom integrations', included: true },
    ],
  },
];

interface UsageStat { label: string; used: number; limit: number | null; unit?: string }
const USAGE: UsageStat[] = [
  { label: 'Products',     used: 18, limit: null, unit: 'of unlimited' },
  { label: 'Orders',       used: 147, limit: null, unit: 'this month' },
  { label: 'Storage',      used: 2.4, limit: 50, unit: 'GB' },
  { label: 'Staff accounts', used: 2, limit: 5 },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();

  const [activeTab, setActiveTab] = useState<'plan' | 'usage' | 'billing'>('plan');
  const [statusLoading, setStatusLoading] = useState(true);
  const [currentPlan, setCurrentPlan] = useState({
    name:               'Starter',
    price:              '$0',
    period:             'month',
    renewsOn:           '—',
    status:             'none',
    amountCents:        0,
    paymentMethodLabel: null as string | null,
  });

  // Derive the active plan id from loaded data
  const selectedPlan = currentPlan.name.toLowerCase();

  useEffect(() => {
    api.seller.subscription.status()
      .then(data => {
        const planName =
          data.plan === 'growth' ? 'Growth'
          : data.plan === 'pro'  ? 'Pro'
          : 'Starter';
        setCurrentPlan({
          name:               planName,
          price:              data.amountCents > 0 ? `$${data.amountCents / 100}` : '$0',
          period:             'month',
          renewsOn:           data.renewsOn ?? '—',
          status:             data.status,
          amountCents:        data.amountCents,
          paymentMethodLabel: data.paymentMethodLabel,
        });
      })
      .catch(() => { /* keep defaults (Starter / free) */ })
      .finally(() => setStatusLoading(false));
  }, []);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleChangePlan(planId: string) {
    haptic();
    if (planId === selectedPlan) return;

    if (planId === 'starter') {
      Alert.alert(
        'Downgrade to Starter',
        'To cancel your subscription, use the billing portal.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open portal', onPress: handleOpenPortal },
        ],
      );
      return;
    }

    try {
      const { url } = await api.seller.subscription.checkout(planId as 'growth' | 'pro');
      Linking.openURL(url);
    } catch (e: any) {
      Alert.alert('Checkout error', e?.message ?? 'Could not start checkout. Please try again.');
    }
  }

  async function handleOpenPortal() {
    haptic();
    try {
      const { url } = await api.seller.subscription.portal();
      Linking.openURL(url);
    } catch (e: any) {
      Alert.alert('Portal error', e?.message ?? 'Could not open billing portal. Please try again.');
    }
  }

  // Status pill appearance
  const statusColor =
    currentPlan.status === 'active'    ? SUCCESS
    : currentPlan.status === 'trialing' ? CYAN
    : currentPlan.status === 'past_due' ? ORANGE
    : currentPlan.status === 'canceled' ? RED
    : currentPlan.name !== 'Starter'    ? SUCCESS
    : MUTED;

  const statusLabel =
    currentPlan.status === 'active'    ? 'Active'
    : currentPlan.status === 'trialing' ? 'Trial'
    : currentPlan.status === 'past_due' ? 'Past Due'
    : currentPlan.status === 'canceled' ? 'Cancelled'
    : currentPlan.name !== 'Starter'    ? 'Active'
    : 'Free';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { haptic(); router.back(); }} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['plan', 'usage', 'billing'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, activeTab === t && styles.tabActive]}
            onPress={() => { haptic(); setActiveTab(t); }}
          >
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + SP.xl }]}>
        {activeTab === 'plan' && (
          <>
            {/* Current plan summary */}
            <LinearGradient colors={['#3B1FA3', '#6D28D9']} style={styles.currentPlanCard}>
              {statusLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <View style={styles.currentPlanRow}>
                    <View>
                      <Text style={styles.currentPlanLabel}>Current plan</Text>
                      <Text style={styles.currentPlanName}>{currentPlan.name}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: `${statusColor}30` }]}>
                      <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                    </View>
                  </View>
                  <Text style={styles.currentPlanRenews}>
                    {currentPlan.name !== 'Starter'
                      ? `Renews ${currentPlan.renewsOn} · ${currentPlan.price}/${currentPlan.period}`
                      : 'Free plan — upgrade to unlock more features'}
                  </Text>
                </>
              )}
            </LinearGradient>

            {/* Plan options */}
            <Text style={styles.sectionTitle}>Plans</Text>
            {PLANS.map((plan) => {
              const isCurrent = plan.id === selectedPlan;
              return (
                <View key={plan.id} style={[styles.planCard, isCurrent && styles.planCardHighlight]}>
                  {isCurrent && (
                    <View style={styles.popularBadge}>
                      <Text style={styles.popularText}>CURRENT PLAN</Text>
                    </View>
                  )}
                  <View style={styles.planHeader}>
                    <View>
                      <Text style={styles.planName}>{plan.name}</Text>
                      <Text style={styles.planTagline}>{plan.tagline}</Text>
                    </View>
                    <View style={styles.planPriceCol}>
                      <Text style={styles.planPrice}>{plan.price}</Text>
                      <Text style={styles.planPeriod}>{plan.period}</Text>
                    </View>
                  </View>
                  <View style={styles.featureList}>
                    {plan.features.map((f) => (
                      <View key={f.text} style={styles.featureRow}>
                        <Feather
                          name={f.included ? 'check' : 'x'}
                          size={14}
                          color={f.included ? SUCCESS : SUBTLE}
                        />
                        <Text style={[styles.featureText, !f.included && styles.featureTextDim]}>
                          {f.text}
                        </Text>
                      </View>
                    ))}
                  </View>
                  {!isCurrent && (
                    <TouchableOpacity
                      style={[styles.changePlanBtn, plan.id === 'starter' && styles.changePlanBtnOutline]}
                      onPress={() => handleChangePlan(plan.id)}
                    >
                      <Text style={[styles.changePlanText, plan.id === 'starter' && { color: MUTED }]}>
                        {plan.id === 'starter' ? 'Downgrade' : 'Upgrade to ' + plan.name}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            <TouchableOpacity style={styles.cancelBtn} onPress={handleOpenPortal}>
              <Text style={styles.cancelText}>Manage or cancel subscription</Text>
            </TouchableOpacity>
          </>
        )}

        {activeTab === 'usage' && (
          <>
            <Text style={styles.sectionTitle}>Usage this period</Text>
            {USAGE.map((u) => {
              const pct = u.limit ? Math.min(u.used / u.limit, 1) : null;
              return (
                <View key={u.label} style={styles.usageCard}>
                  <View style={styles.usageHeader}>
                    <Text style={styles.usageLabel}>{u.label}</Text>
                    <Text style={styles.usageValue}>
                      {u.limit ? `${u.used} / ${u.limit} ${u.unit ?? ''}` : `${u.used} ${u.unit ?? ''}`}
                    </Text>
                  </View>
                  {pct !== null && (
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${pct * 100}%` as any, backgroundColor: pct > 0.85 ? ORANGE : PURPLE }]} />
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}

        {activeTab === 'billing' && (
          <>
            <Text style={styles.sectionTitle}>Billing details</Text>
            {statusLoading ? (
              <ActivityIndicator color={PURPLE} style={{ marginTop: SP.lg }} />
            ) : (
              <>
                <View style={styles.billingCard}>
                  <View style={styles.billingRow}>
                    <Text style={styles.billingLabel}>Next invoice</Text>
                    <Text style={styles.billingValue}>{currentPlan.renewsOn}</Text>
                  </View>
                  <View style={styles.billingRow}>
                    <Text style={styles.billingLabel}>Amount</Text>
                    <Text style={styles.billingValue}>
                      {currentPlan.amountCents > 0 ? `${currentPlan.price}/mo` : 'Free'}
                    </Text>
                  </View>
                  <View style={styles.billingRow}>
                    <Text style={styles.billingLabel}>Payment method</Text>
                    <Text style={styles.billingValue}>
                      {currentPlan.paymentMethodLabel ?? '—'}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity style={styles.manageBillingBtn} onPress={handleOpenPortal}>
                  <Feather name="external-link" size={16} color={PURPLE} />
                  <Text style={styles.manageBillingText}>Manage billing &amp; invoices</Text>
                  <Feather name="chevron-right" size={16} color={MUTED} />
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:               { flex: 1, backgroundColor: BG },
  header:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:            { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:        { flex: 1, textAlign: 'center', color: FG, fontSize: FS.lg, fontFamily: FONT.semibold },
  tabRow:             { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, marginHorizontal: SP.md },
  tab:                { flex: 1, paddingVertical: SP.sm, alignItems: 'center' },
  tabActive:          { borderBottomWidth: 2, borderBottomColor: PURPLE },
  tabText:            { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  tabTextActive:      { color: PURPLE },
  scroll:             { padding: SP.md },
  currentPlanCard:    { borderRadius: RADIUS.xl, padding: SP.lg, marginBottom: SP.lg },
  currentPlanRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SP.sm },
  currentPlanLabel:   { color: 'rgba(255,255,255,0.7)', fontSize: FS.xs, fontFamily: FONT.medium },
  currentPlanName:    { color: '#FFFFFF', fontSize: FS.xxl, fontFamily: FONT.semibold },
  currentPlanRenews:  { color: 'rgba(255,255,255,0.65)', fontSize: FS.xs, fontFamily: FONT.regular },
  statusPill:         { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  statusText:         { fontSize: FS.xs, fontFamily: FONT.medium },
  sectionTitle:       { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  planCard:           { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
  planCardHighlight:  { borderColor: PURPLE, backgroundColor: CARD_ELEVATED },
  popularBadge:       { alignSelf: 'flex-start', backgroundColor: PURPLE_DIM, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginBottom: SP.sm },
  popularText:        { color: PURPLE_LIGHT, fontSize: 10, fontFamily: FONT.semibold, letterSpacing: 0.5 },
  planHeader:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SP.md },
  planName:           { color: FG, fontSize: FS.lg, fontFamily: FONT.semibold },
  planTagline:        { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  planPriceCol:       { alignItems: 'flex-end' },
  planPrice:          { color: FG, fontSize: FS.xl, fontFamily: FONT.semibold },
  planPeriod:         { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular },
  featureList:        { gap: SP.sm, marginBottom: SP.md },
  featureRow:         { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  featureText:        { color: FG, fontSize: FS.sm, fontFamily: FONT.regular },
  featureTextDim:     { color: SUBTLE },
  changePlanBtn:      { backgroundColor: PURPLE, borderRadius: RADIUS.md, paddingVertical: SP.sm, alignItems: 'center' },
  changePlanBtnOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: BORDER },
  changePlanText:     { color: '#FFFFFF', fontSize: FS.sm, fontFamily: FONT.semibold },
  cancelBtn:          { alignItems: 'center', paddingVertical: SP.lg },
  cancelText:         { color: SUBTLE, fontSize: FS.sm, fontFamily: FONT.regular },
  usageCard:          { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.sm },
  usageHeader:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.sm },
  usageLabel:         { color: FG, fontSize: FS.sm, fontFamily: FONT.medium },
  usageValue:         { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular },
  progressTrack:      { height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
  progressFill:       { height: 4, borderRadius: 2 },
  billingCard:        { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md, overflow: 'hidden' },
  billingRow:         { flexDirection: 'row', justifyContent: 'space-between', padding: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  billingLabel:       { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular },
  billingValue:       { color: FG, fontSize: FS.sm, fontFamily: FONT.medium },
  manageBillingBtn:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER },
  manageBillingText:  { flex: 1, color: PURPLE, fontSize: FS.sm, fontFamily: FONT.medium },
});
