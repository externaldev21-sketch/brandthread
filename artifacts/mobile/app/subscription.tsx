/**
 * Seller subscription & billing screen.
 *
 * Tiers (matching the three-tier catalogue):
 *   starter  $29/mo
 *   growth   $79/mo
 *   scale   $199/mo
 *
 * All plans carry a 5% platform commission on sales.
 * New subscriptions start with a 5-day free trial (card collected upfront).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Linking, AppState, AppStateStatus,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, PURPLE_LIGHT,
  CYAN, SUCCESS, ORANGE, RED, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { invalidatePlanCache } from '@/hooks/useSubscriptionPlan';
import { isManagerRole, parseRoleError } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import { formatCents } from '@/lib/money';
import { useTeamRole } from '@/hooks/useTeamRole';

// ─── Static plan catalogue ────────────────────────────────────────────────────

interface PlanFeature { text: string; included: boolean }
interface Plan {
  id:       string;
  name:     string;
  tagline:  string;
  price:    string;
  period:   string;
  highlight?: boolean;
  features: PlanFeature[];
}

const PLANS: Plan[] = [
  {
    id:      'starter',
    name:    'Starter',
    tagline: 'Launch your brand',
    price:   '$29',
    period:  '/mo',
    features: [
      { text: 'Storefront + AI Store Builder', included: true },
      { text: 'Up to 25 products',             included: true },
      { text: 'Standard checkout',             included: true },
      { text: 'Basic analytics',               included: true },
      { text: 'Community & freelancer marketplace', included: true },
      { text: 'AI Design Studio',              included: false },
      { text: 'Manufacturer Hub',              included: false },
      { text: 'Live shopping',                 included: false },
    ],
  },
  {
    id:      'growth',
    name:    'Growth',
    tagline: 'Scale your catalog',
    price:   '$79',
    period:  '/mo',
    highlight: true,
    features: [
      { text: 'Everything in Starter',         included: true },
      { text: 'Unlimited products',            included: true },
      { text: 'AI Design Studio (full)',       included: true },
      { text: 'Manufacturer Hub + drops',      included: true },
      { text: 'Live shopping',                 included: true },
      { text: 'Up to 3 team seats',            included: true },
      { text: 'Boost & promotion credits',     included: true },
      { text: 'Advanced analytics',            included: false },
      { text: 'Unlimited team seats',          included: false },
    ],
  },
  {
    id:      'scale',
    name:    'Scale',
    tagline: 'Enterprise-grade operations',
    price:   '$199',
    period:  '/mo',
    features: [
      { text: 'Everything in Growth',          included: true },
      { text: 'Unlimited team seats',          included: true },
      { text: 'Advanced analytics',            included: true },
      { text: 'Priority manufacturer intros',  included: true },
      { text: 'White-glove support',           included: true },
      { text: 'Early access to new features',  included: true },
    ],
  },
];

interface UsageStat { label: string; used: number; limit: number | null; unit?: string }
const USAGE: UsageStat[] = [
  { label: 'Products',       used: 18, limit: null, unit: 'of unlimited' },
  { label: 'Orders',         used: 147, limit: null, unit: 'this month' },
  { label: 'Storage',        used: 2.4, limit: 50, unit: 'GB' },
  { label: 'Team seats',     used: 2, limit: 3 },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SubscriptionScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();

  const [activeTab,   setActiveTab]   = useState<'plan' | 'usage' | 'billing'>('plan');
  const { currentRole, isLoadingRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);
  const [statusLoading, setStatusLoading] = useState(true);
  const [currentPlan, setCurrentPlan] = useState({
    name:               'Starter',
    price:              '$29',
    period:             'month',
    renewsOn:           '—',
    trialEnd:           null as string | null,
    status:             'none',
    amountCents:        0,
    paymentMethodLabel: null as string | null,
  });

  // Derive the active plan id from loaded data
  const selectedPlan = currentPlan.name.toLowerCase();

  const portalOpenedRef = useRef(false);

  const fetchStatus = useCallback(() => {
    setStatusLoading(true);
    api.seller.subscription.status()
      .then(data => {
        const planName =
          data.plan === 'growth' ? 'Growth'
          : data.plan === 'scale'  ? 'Scale'
          : 'Starter';
        const planPrice =
          data.plan === 'growth' ? '$79'
          : data.plan === 'scale'  ? '$199'
          : '$29';
        setCurrentPlan({
          name:               planName,
          price:              data.amountCents > 0 ? formatCents(data.amountCents) : planPrice,
          period:             'month',
          renewsOn:           data.renewsOn ?? '—',
          trialEnd:           data.trialEnd ?? null,
          status:             data.status,
          amountCents:        data.amountCents,
          paymentMethodLabel: data.paymentMethodLabel,
        });
      })
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      invalidatePlanCache();
      fetchStatus();
    }, [fetchStatus]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active' && portalOpenedRef.current) {
        portalOpenedRef.current = false;
        invalidatePlanCache();
        fetchStatus();
      }
    });
    return () => subscription.remove();
  }, [fetchStatus]);

  function haptic() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }

  async function handleChangePlan(planId: string) {
    haptic();
    // Only treat the current plan as "already selected" when there's an active subscription.
    // status:'none' means no paid plan yet — Starter must remain selectable.
    if (planId === selectedPlan && currentPlan.status !== 'none') return;

    if (planId === 'starter' && currentPlan.status !== 'none') {
      Alert.alert(
        'Downgrade plan',
        'To change or cancel your subscription, use the billing portal.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open portal', onPress: handleOpenPortal },
        ],
      );
      return;
    }

    try {
      const { url } = await api.seller.subscription.checkout(planId as 'starter' | 'growth' | 'scale');
      portalOpenedRef.current = true;
      Linking.openURL(url);
    } catch (e: any) {
      if (parseRoleError(e)) {
        Alert.alert('Only the store owner can do this');
        return;
      }
      Alert.alert('Checkout error', e?.message ?? 'Could not start checkout. Please try again.');
    }
  }

  async function handleOpenPortal() {
    haptic();
    try {
      const { url } = await api.seller.subscription.portal();
      portalOpenedRef.current = true;
      Linking.openURL(url);
    } catch (e: any) {
      if (parseRoleError(e)) {
        Alert.alert('Only the store owner can do this');
        return;
      }
      Alert.alert('Portal error', e?.message ?? 'Could not open billing portal. Please try again.');
    }
  }

  // Status pill
  const statusColor =
    currentPlan.status === 'active'    ? SUCCESS
    : currentPlan.status === 'trialing' ? CYAN
    : currentPlan.status === 'past_due' ? ORANGE
    : currentPlan.status === 'canceled' ? RED
    : MUTED;

  const statusLabel =
    currentPlan.status === 'active'    ? 'Active'
    : currentPlan.status === 'trialing' ? 'Trial'
    : currentPlan.status === 'past_due' ? 'Past Due'
    : currentPlan.status === 'canceled' ? 'Cancelled'
    : 'Free';

  if (isLoadingRole) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { haptic(); router.back(); }} style={styles.backBtn}>
            <Feather name="chevron-left" size={24} color={FG} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Subscription</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.accessLoading}>
          <ActivityIndicator color={PURPLE} />
        </View>
      </View>
    );
  }

  if (currentRole !== 'owner' && !isReadOnly) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { haptic(); router.back(); }} style={styles.backBtn}>
            <Feather name="chevron-left" size={24} color={FG} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Subscription</Text>
          <View style={styles.backBtn} />
        </View>
        <RoleLockedView screenTitle="subscription & billing" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

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

        {/* ── Plan tab ── */}
        {activeTab === 'plan' && (
          <>
            {/* Current plan summary card */}
            <LinearGradient colors={theme.primaryGradient as any} style={styles.currentPlanCard}>
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

                  {/* Trial end or renewal line */}
                  {currentPlan.trialEnd ? (
                    <Text style={styles.currentPlanRenews}>
                      Free trial ends {currentPlan.trialEnd} · then {currentPlan.price}/mo
                    </Text>
                  ) : currentPlan.status === 'active' ? (
                    <Text style={styles.currentPlanRenews}>
                      Renews {currentPlan.renewsOn} · {currentPlan.price}/mo
                    </Text>
                  ) : (
                    <Text style={styles.currentPlanRenews}>
                      Upgrade to unlock more features
                    </Text>
                  )}

                  {/* Commission reminder */}
                  <Text style={[styles.currentPlanRenews, { marginTop: 8, opacity: 0.6 }]}>
                    + 5% platform commission on sales
                  </Text>
                </>
              )}
            </LinearGradient>

            {/* Plan options */}
            <Text style={styles.sectionTitle}>All plans</Text>
            {PLANS.map((plan) => {
              const isCurrent = plan.id === selectedPlan;
              return (
                <View key={plan.id} style={[styles.planCard, isCurrent && styles.planCardHighlight, plan.highlight && !isCurrent && styles.planCardFeatured]}>
                  {isCurrent && (
                    <View style={styles.popularBadge}>
                      <Text style={styles.popularText}>CURRENT PLAN</Text>
                    </View>
                  )}
                  {plan.highlight && !isCurrent && (
                    <View style={[styles.popularBadge, { backgroundColor: PURPLE_DIM }]}>
                      <Text style={[styles.popularText, { color: PURPLE_LIGHT }]}>MOST POPULAR</Text>
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
                        <Feather name={f.included ? 'check' : 'x'} size={14} color={f.included ? SUCCESS : SUBTLE} />
                        <Text style={[styles.featureText, !f.included && styles.featureTextDim]}>{f.text}</Text>
                      </View>
                    ))}
                  </View>
                   {!isReadOnly && !isCurrent && (
                    <TouchableOpacity
                      style={[styles.changePlanBtn, plan.id === 'starter' && styles.changePlanBtnOutline]}
                      onPress={() => handleChangePlan(plan.id)}
                    >
                      <Text style={[styles.changePlanText, plan.id === 'starter' && { color: MUTED }]}>
                        {plan.id === 'starter' ? 'Downgrade' : `Switch to ${plan.name}`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

             {!isReadOnly && (
               <TouchableOpacity style={styles.cancelBtn} onPress={handleOpenPortal}>
                 <Text style={styles.cancelText}>Manage or cancel subscription</Text>
               </TouchableOpacity>
             )}
          </>
        )}

        {/* ── Usage tab ── */}
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

        {/* ── Billing tab ── */}
        {activeTab === 'billing' && (
          <>
            <Text style={styles.sectionTitle}>Billing details</Text>
            {statusLoading ? (
              <ActivityIndicator color={PURPLE} style={{ marginTop: SP.lg }} />
            ) : (
              <>
                <View style={styles.billingCard}>
                  {currentPlan.trialEnd && (
                    <View style={[styles.billingRow, { backgroundColor: `${CYAN}11` }]}>
                      <Text style={styles.billingLabel}>Trial ends</Text>
                      <Text style={[styles.billingValue, { color: CYAN }]}>{currentPlan.trialEnd}</Text>
                    </View>
                  )}
                  <View style={styles.billingRow}>
                    <Text style={styles.billingLabel}>Next invoice</Text>
                    <Text style={styles.billingValue}>{currentPlan.renewsOn}</Text>
                  </View>
                  <View style={styles.billingRow}>
                    <Text style={styles.billingLabel}>Amount</Text>
                    <Text style={styles.billingValue}>
                      {currentPlan.amountCents > 0 ? `${currentPlan.price}/mo` : '—'}
                    </Text>
                  </View>
                  <View style={styles.billingRow}>
                    <Text style={styles.billingLabel}>Platform commission</Text>
                    <Text style={styles.billingValue}>5% per sale</Text>
                  </View>
                  <View style={[styles.billingRow, { borderBottomWidth: 0 }]}>
                    <Text style={styles.billingLabel}>Payment method</Text>
                    <Text style={styles.billingValue}>{currentPlan.paymentMethodLabel ?? '—'}</Text>
                  </View>
                </View>

                 {!isReadOnly && (
                   <TouchableOpacity style={styles.manageBillingBtn} onPress={handleOpenPortal}>
                     <Feather name="external-link" size={16} color={PURPLE} />
                     <Text style={styles.manageBillingText}>Manage billing &amp; invoices</Text>
                     <Feather name="chevron-right" size={16} color={MUTED} />
                   </TouchableOpacity>
                 )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: { accent: string; accentLight: string; accentDim: string; secondary: string; secondaryDim: string }) => {
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  return StyleSheet.create({
  root:               { flex: 1, backgroundColor: BG },
  accessLoading:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  planCardHighlight:  { borderColor: SUCCESS, backgroundColor: CARD_ELEVATED },
  planCardFeatured:   { borderColor: PURPLE, backgroundColor: CARD_ELEVATED },
  popularBadge:       { alignSelf: 'flex-start', backgroundColor: `${SUCCESS}22`, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginBottom: SP.sm },
  popularText:        { color: SUCCESS, fontSize: 10, fontFamily: FONT.semibold, letterSpacing: 0.5 },
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
};
