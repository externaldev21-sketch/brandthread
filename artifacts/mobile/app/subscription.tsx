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
  Alert, ActivityIndicator, Linking, AppState, AppStateStatus, Platform,
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
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { invalidatePlanCache } from '@/hooks/useSubscriptionPlan';
import { isManagerRole, parseRoleError } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import { formatCents } from '@/lib/money';
import { pollSubscriptionStatus } from '@/lib/pollSubscriptionStatus';
import { useTeamRole } from '@/hooks/useTeamRole';
import { getGrowthStudioTools, GROWTH_EXTRAS } from '@/lib/growthTools';
import { useRevenueCat } from '@/lib/revenueCat';
import { SELLER_PACKAGE_IDS } from '@/lib/sellerBilling';
import { getSellerPlan, SELLER_PLANS } from '@/lib/sellerPlans';
import {
  getBillingRecoveryTarget,
  isSubscriptionPaymentRecoveryRequired,
  type SubscriptionBillingProvider,
} from '@/lib/subscriptionRecovery';

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
  const { available: revenueCatAvailable, packages: revenueCatPackages, purchase, restore, managementURL } = useRevenueCat();
  const growthStudioTools = React.useMemo(() => getGrowthStudioTools(theme), [theme]);

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
    effectiveProvider:  'none' as SubscriptionBillingProvider,
    amountCents:        0,
    paymentMethodLabel: null as string | null,
  });

  // Derive the active plan id from loaded data
  const selectedPlan = currentPlan.name.toLowerCase();
  const hasGrowthAccess = selectedPlan === 'growth' || selectedPlan === 'scale';

  const externalSessionOpenedRef = useRef<
    { kind: 'checkout'; expectedPlan: string } | { kind: 'portal' } | null
  >(null);

  const applyStatus = useCallback((
    data: Awaited<ReturnType<typeof api.seller.subscription.status>>,
  ) => {
    const plan = getSellerPlan(data.plan) ?? SELLER_PLANS[0];
    setCurrentPlan({
      name:               plan.name,
      price:              data.amountCents > 0 ? formatCents(data.amountCents) : plan.priceLabel,
      period:             'month',
      renewsOn:           data.renewsOn ?? '—',
      trialEnd:           data.trialEnd ?? null,
      status:             data.status,
      effectiveProvider:  data.effectiveProvider,
      amountCents:        data.amountCents,
      paymentMethodLabel: data.paymentMethodLabel,
    });
  }, []);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await api.seller.subscription.status();
      applyStatus(data);
    } catch {
      // Keep the last known subscription state on transient failures.
    } finally {
      setStatusLoading(false);
    }
  }, [api, applyStatus]);

  useFocusEffect(
    useCallback(() => {
      invalidatePlanCache();
      fetchStatus();
    }, [fetchStatus]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      const externalSession = externalSessionOpenedRef.current;
      if (nextState !== 'active' || !externalSession) return;

      externalSessionOpenedRef.current = null;
      invalidatePlanCache();
      setStatusLoading(true);

      const refreshed = await pollSubscriptionStatus({
        loadStatus: api.seller.subscription.status,
        maxAttempts: externalSession.kind === 'checkout' ? 8 : 1,
        shouldStop: (status) =>
          externalSession.kind === 'portal'
          || (
            status.plan === externalSession.expectedPlan
            && (status.status === 'trialing' || status.status === 'active')
          ),
        onStatus: applyStatus,
      });

      if (refreshed) {
        invalidatePlanCache();
      }
      setStatusLoading(false);
    });
    return () => subscription.remove();
  }, [api, applyStatus]);

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
      if (Platform.OS !== 'web') {
        const packageToPurchase = revenueCatPackages.find((pkg) =>
          pkg.identifier === SELLER_PACKAGE_IDS[planId as keyof typeof SELLER_PACKAGE_IDS],
        );
        if (!revenueCatAvailable || !packageToPurchase) {
          throw new Error('Subscriptions are temporarily unavailable. Please try again shortly.');
        }
        await purchase(packageToPurchase);
        invalidatePlanCache();
        await fetchStatus();
        return;
      }
      const { url } = await api.seller.subscription.checkout(planId as 'starter' | 'growth' | 'scale');
      externalSessionOpenedRef.current = { kind: 'checkout', expectedPlan: planId };
      await Linking.openURL(url);
    } catch (e: any) {
      externalSessionOpenedRef.current = null;
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
      const target = getBillingRecoveryTarget(currentPlan.effectiveProvider, managementURL);
      if (target === 'revenuecat') {
        await Linking.openURL(managementURL!);
        return;
      }
      if (target === 'subscription') {
        throw new Error('Subscription management is not available yet.');
      }
      const { url } = await api.seller.subscription.portal();
      externalSessionOpenedRef.current = { kind: 'portal' };
      await Linking.openURL(url);
    } catch (e: any) {
      externalSessionOpenedRef.current = null;
      if (parseRoleError(e)) {
        Alert.alert('Only the store owner can do this');
        return;
      }
      Alert.alert('Portal error', e?.message ?? 'Could not open billing portal. Please try again.');
    }
  }

  async function handleRestore() {
    haptic();
    try {
      await restore();
      invalidatePlanCache();
      await fetchStatus();
      Alert.alert('Purchases restored', 'Your RevenueCat subscription has been refreshed.');
    } catch (e: any) {
      Alert.alert('Restore error', e?.message ?? 'Could not restore purchases. Please try again.');
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
            testID={`seller-subscription-tab-${t}`}
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
                <ActivityIndicator color={theme.onAccent} />
              ) : (
                <>
                  <View style={styles.currentPlanRow}>
                    <View>
                      <Text style={[styles.currentPlanLabel, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Current plan</Text>
                      <Text style={[styles.currentPlanName, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>{currentPlan.name}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: `${statusColor}30` }]}>
                      <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                    </View>
                  </View>

                  {/* Trial end or renewal line */}
                  {currentPlan.status === 'canceled' ? (
                    <Text style={[styles.currentPlanRenews, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                      Access continues until {currentPlan.renewsOn}
                    </Text>
                  ) : currentPlan.trialEnd ? (
                    <Text style={[styles.currentPlanRenews, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                      Free trial ends {currentPlan.trialEnd} · then {currentPlan.price}/mo
                    </Text>
                  ) : currentPlan.status === 'active' ? (
                    <Text style={[styles.currentPlanRenews, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                      Renews {currentPlan.renewsOn} · {currentPlan.price}/mo
                    </Text>
                  ) : (
                    <Text style={[styles.currentPlanRenews, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                      Upgrade to unlock more features
                    </Text>
                  )}

                  {/* Commission reminder */}
                  <Text style={[styles.currentPlanRenews, { color: theme.onAccent, marginTop: 8, opacity: 0.6 }, getOnAccentTextStyle(theme)]}>
                    + 5% platform commission on sales
                  </Text>
                </>
              )}
            </LinearGradient>

            {/* Plan options */}
            <Text style={styles.sectionTitle}>All plans</Text>
             {SELLER_PLANS.map((plan) => {
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
                        <Text style={styles.planPrice}>
                         {Platform.OS === 'web'
                            ? plan.priceLabel
                           : revenueCatPackages.find((pkg) => pkg.identifier === SELLER_PACKAGE_IDS[plan.id as keyof typeof SELLER_PACKAGE_IDS])?.product.priceString ?? '—'}
                       </Text>
                       <Text style={styles.planPeriod}>/mo</Text>
                    </View>
                  </View>
                  <View style={styles.featureList}>
                     {plan.features.map((feature) => (
                       <View key={feature} style={styles.featureRow}>
                         <Feather name="check" size={14} color={SUCCESS} />
                         <Text style={styles.featureText}>{feature}</Text>
                       </View>
                     ))}
                     {plan.notIncluded.map((feature) => (
                       <View key={feature} style={styles.featureRow}>
                         <Feather name="x" size={14} color={SUBTLE} />
                         <Text style={[styles.featureText, styles.featureTextDim]}>{feature}</Text>
                      </View>
                    ))}
                  </View>
                   {!isReadOnly && !isCurrent && (
                    <TouchableOpacity
                      testID={`seller-subscription-change-${plan.id}`}
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

            {/* ── Growth feature comparison ── */}
            <View style={styles.growthComparison}>
              <View style={styles.growthComparisonHeader}>
                <View style={styles.growthComparisonIcon}>
                  <Feather name="layers" size={18} color={PURPLE_LIGHT} />
                </View>
                <View style={styles.growthComparisonHeading}>
                  <Text style={styles.growthComparisonTitle}>What’s included in your plan</Text>
                  <Text style={styles.growthComparisonSubtitle}>
                    Your Growth Studio toolkit at a glance
                  </Text>
                </View>
              </View>

              {growthStudioTools.map((tool) => (
                <View key={tool.id} style={styles.growthFeatureRow}>
                  <View style={[styles.growthToolIcon, { backgroundColor: tool.accentDim }]}>
                    <Feather name={tool.icon} size={16} color={tool.accent} />
                  </View>
                  <View style={styles.growthFeatureLabels}>
                    <Text style={styles.growthFeatureTitle}>{tool.title}</Text>
                    <Text style={styles.growthFeatureDescription}>{tool.desc}</Text>
                  </View>
                  <View style={[
                    styles.growthFeatureStatus,
                    { backgroundColor: hasGrowthAccess ? `${SUCCESS}18` : `${SUBTLE}12` },
                  ]}>
                    <Feather
                      name={hasGrowthAccess ? 'check' : 'lock'}
                      size={11}
                      color={hasGrowthAccess ? SUCCESS : SUBTLE}
                    />
                    <Text style={[
                      styles.growthFeatureStatusText,
                      { color: hasGrowthAccess ? SUCCESS : SUBTLE },
                    ]}>
                      {hasGrowthAccess ? 'Included' : 'Growth only'}
                    </Text>
                  </View>
                </View>
              ))}

              <View style={styles.growthComparisonDivider} />
              <Text style={styles.growthExtrasLabel}>More Growth perks</Text>
              {GROWTH_EXTRAS.map((perk) => (
                <View key={perk.label} style={styles.growthPerkRow}>
                  <View style={[
                    styles.growthPerkIcon,
                    { backgroundColor: hasGrowthAccess ? `${SUCCESS}18` : `${SUBTLE}12` },
                  ]}>
                    <Feather
                      name={hasGrowthAccess ? 'check' : 'lock'}
                      size={11}
                      color={hasGrowthAccess ? SUCCESS : SUBTLE}
                    />
                  </View>
                  <Text style={[
                    styles.growthPerkText,
                    !hasGrowthAccess && styles.growthPerkTextDim,
                  ]}>
                    {perk.label}
                  </Text>
                  {!hasGrowthAccess && (
                    <Text style={styles.growthPerkStatus}>Growth only</Text>
                  )}
                </View>
              ))}
            </View>

             {!isReadOnly && (
                <TouchableOpacity testID="seller-subscription-cancel" style={styles.cancelBtn} onPress={handleOpenPortal}>
                  <Text style={styles.cancelText}>{Platform.OS === 'web' ? 'Manage or cancel subscription' : 'Manage subscription'}</Text>
               </TouchableOpacity>
             )}
              {!isReadOnly && Platform.OS !== 'web' && (
                <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} testID="seller-revenuecat-restore">
                  <Text style={styles.restoreText}>Restore purchases</Text>
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
                  {isSubscriptionPaymentRecoveryRequired(currentPlan.status) && (
                    <View style={styles.pastDueAlert} testID="seller-subscription-past-due-alert">
                      <View style={styles.pastDueIcon}>
                        <Feather name="alert-circle" size={18} color={RED} />
                      </View>
                      <View style={styles.pastDueCopy}>
                        <Text style={styles.pastDueTitle}>Payment failed</Text>
                        <Text style={styles.pastDueBody}>
                          Your last payment didn’t go through. Update your card to keep your features.
                        </Text>
                      </View>
                    </View>
                  )}
                <View style={styles.billingCard}>
                  {currentPlan.trialEnd && (
                    <View style={[styles.billingRow, { backgroundColor: `${CYAN}11` }]}>
                      <Text style={styles.billingLabel}>Trial ends</Text>
                      <Text style={[styles.billingValue, { color: CYAN }]}>{currentPlan.trialEnd}</Text>
                    </View>
                  )}
                  <View style={styles.billingRow}>
                    <Text style={styles.billingLabel}>Next invoice</Text>
                    <Text style={styles.billingValue}>
                      {currentPlan.status === 'canceled' ? '—' : currentPlan.renewsOn}
                    </Text>
                  </View>
                  <View style={styles.billingRow}>
                    <Text style={styles.billingLabel}>Amount</Text>
                    <Text style={styles.billingValue}>
                      {currentPlan.status === 'canceled'
                        ? '$0'
                        : currentPlan.amountCents > 0
                          ? `${currentPlan.price}/mo`
                          : '—'}
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
                    <TouchableOpacity testID="seller-subscription-manage-billing" style={styles.manageBillingBtn} onPress={handleOpenPortal}>
                     <Feather name="external-link" size={16} color={PURPLE} />
                      <Text style={styles.manageBillingText}>{Platform.OS === 'web' ? 'Manage billing & invoices' : 'Manage subscription'}</Text>
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
   growthComparison:   { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
   growthComparisonHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.lg },
   growthComparisonIcon: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
   growthComparisonHeading: { flex: 1 },
   growthComparisonTitle: { color: FG, fontSize: FS.md, fontFamily: FONT.semibold },
   growthComparisonSubtitle: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
   growthFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.md },
   growthToolIcon: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
   growthFeatureLabels: { flex: 1, paddingTop: 1 },
   growthFeatureTitle: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold },
   growthFeatureDescription: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, lineHeight: 16, marginTop: 2 },
   growthFeatureStatus: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.pill, paddingHorizontal: 7, paddingVertical: 4, marginTop: 1 },
   growthFeatureStatusText: { fontSize: 10, fontFamily: FONT.medium },
   growthComparisonDivider: { height: 1, backgroundColor: BORDER, marginTop: SP.xs, marginBottom: SP.md },
   growthExtrasLabel: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.sm },
   growthPerkRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
   growthPerkIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
   growthPerkText: { color: FG, fontSize: FS.sm, fontFamily: FONT.regular, flex: 1 },
   growthPerkTextDim: { color: SUBTLE },
   growthPerkStatus: { color: SUBTLE, fontSize: 10, fontFamily: FONT.medium },
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
  restoreBtn:         { alignItems: 'center', paddingVertical: SP.sm, marginBottom: SP.md },
  restoreText:        { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  cancelText:         { color: SUBTLE, fontSize: FS.sm, fontFamily: FONT.regular },
  usageCard:          { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.sm },
  usageHeader:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.sm },
  usageLabel:         { color: FG, fontSize: FS.sm, fontFamily: FONT.medium },
  usageValue:         { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular },
  progressTrack:      { height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
  progressFill:       { height: 4, borderRadius: 2 },
  billingCard:        { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md, overflow: 'hidden' },
  pastDueAlert:       { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.45)', padding: SP.md, marginBottom: SP.md },
  pastDueIcon:        { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(239,68,68,0.16)' },
  pastDueCopy:        { flex: 1, gap: 3 },
  pastDueTitle:       { color: RED, fontSize: FS.sm, fontFamily: FONT.semibold },
  pastDueBody:        { color: FG, fontSize: FS.xs, fontFamily: FONT.regular, lineHeight: 17 },
  billingRow:         { flexDirection: 'row', justifyContent: 'space-between', padding: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  billingLabel:       { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular },
  billingValue:       { color: FG, fontSize: FS.sm, fontFamily: FONT.medium },
  manageBillingBtn:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER },
  manageBillingText:  { flex: 1, color: PURPLE, fontSize: FS.sm, fontFamily: FONT.medium },
  });
};
