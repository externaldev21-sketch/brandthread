/**
 * Seller subscription & billing screen.
 *
 * Tiers (matching the three-tier catalogue):
 *   starter  $29/mo
 *   growth   $79/mo
 *   pro     $199/mo
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
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
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

// ─── Screen ───────────────────────────────────────────────────────────────────
// Note: there is no real usage-metrics API in this codebase yet, so the Usage
// tab (which previously showed hardcoded fake numbers) has been removed
// rather than ship fabricated personal usage stats. Re-add it once a real
// backing endpoint exists.

export default function SubscriptionScreen() {
  const { theme } = useAppTheme();
  const {
    accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM,
    text: FG, muted: MUTED, subtle: SUBTLE, border: BORDER, card: CARD, cardElevated: CARD_ELEVATED,
    success: SUCCESS, warning: ORANGE, error: RED, background: BG,
  } = theme;
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();
  const { available: revenueCatAvailable, packages: revenueCatPackages, purchase, restore, managementURL } = useRevenueCat();
  const growthStudioTools = React.useMemo(() => getGrowthStudioTools(theme), [theme]);

  const [activeTab,   setActiveTab]   = useState<'plan' | 'billing'>('plan');
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
  const hasGrowthAccess = selectedPlan === 'growth' || selectedPlan === 'pro';

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
      const { url } = await api.seller.subscription.checkout(planId as 'starter' | 'growth' | 'pro');
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
      Alert.alert('Purchases restored', 'Your subscription has been refreshed.');
    } catch (e: any) {
      Alert.alert('Restore error', e?.message ?? 'Could not restore purchases. Please try again.');
    }
  }

  // Status pill
  const statusColor =
    currentPlan.status === 'active'    ? theme.success
    : currentPlan.status === 'trialing' ? theme.secondary
    : currentPlan.status === 'past_due' ? theme.warning
    : currentPlan.status === 'canceled' ? theme.error
    : theme.muted;

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
            <Feather name="chevron-left" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Subscription</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.accessLoading}>
          <ActivityIndicator color={theme.accent} />
        </View>
      </View>
    );
  }

  if (currentRole !== 'owner' && !isReadOnly) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { haptic(); router.back(); }} style={styles.backBtn}>
            <Feather name="chevron-left" size={24} color={theme.text} />
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
          <Feather name="chevron-left" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['plan', 'billing'] as const).map((t) => (
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
                <View key={plan.id} style={[styles.planCard, plan.highlight && styles.planCardFeatured, isCurrent && styles.planCardHighlight]}>
                  {isCurrent && (
                    <View style={styles.popularBadge}>
                      <Text style={styles.popularText}>CURRENT PLAN</Text>
                    </View>
                  )}
                  {plan.highlight && (
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

              {/* Apple guideline 3.1.2 — auto-renew disclosure + Terms/Privacy links */}
              <View style={styles.legalFooter}>
                <Text style={styles.legalFooterText}>
                  Subscriptions renew automatically at the price shown unless you cancel at least 24 hours before the period ends. Manage or cancel in your App Store account settings.
                </Text>
                <View style={styles.legalLinksRow}>
                  <Text style={styles.legalLink} onPress={() => { haptic(); router.push('/terms' as never); }}>
                    Terms of Use
                  </Text>
                  <Text style={styles.legalLinkDivider}>·</Text>
                  <Text style={styles.legalLink} onPress={() => { haptic(); router.push('/privacy' as never); }}>
                    Privacy Policy
                  </Text>
                </View>
              </View>
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

const createStyles = (theme: AppThemePreset) => {
  const {
    accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM,
    text: FG, muted: MUTED, subtle: SUBTLE, border: BORDER, card: CARD, cardElevated: CARD_ELEVATED,
    success: SUCCESS, warning: ORANGE, error: RED, background: BG, onAccent: ON_ACCENT,
  } = theme;
  return StyleSheet.create({
  root:               { flex: 1, backgroundColor: 'transparent' },
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
  // Text colour here is always overridden inline with theme.onAccent (+ getOnAccentTextStyle)
  // since this card sits on primaryGradient; the base value just needs to be theme-safe.
  currentPlanLabel:   { color: ON_ACCENT, fontSize: FS.xs, fontFamily: FONT.medium },
  currentPlanName:    { color: ON_ACCENT, fontSize: FS.xxl, fontFamily: FONT.semibold },
  currentPlanRenews:  { color: ON_ACCENT, fontSize: FS.xs, fontFamily: FONT.regular },
  statusPill:         { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  statusText:         { fontSize: FS.xs, fontFamily: FONT.medium },
  sectionTitle:       { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  planCard:           { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
  planCardHighlight:  { borderColor: SUCCESS, backgroundColor: CARD_ELEVATED },
  planCardFeatured:   {
    borderColor: PURPLE,
    backgroundColor: CARD_ELEVATED,
    borderWidth: 2,
    shadowColor: PURPLE,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 7,
    transform: [{ scale: 1.015 }],
  },
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
   growthFeatureStatusText: { fontSize: FS.xs, fontFamily: FONT.medium },
   growthComparisonDivider: { height: 1, backgroundColor: BORDER, marginTop: SP.xs, marginBottom: SP.md },
   growthExtrasLabel: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.sm },
   growthPerkRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
   growthPerkIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
   growthPerkText: { color: FG, fontSize: FS.sm, fontFamily: FONT.regular, flex: 1 },
   growthPerkTextDim: { color: SUBTLE },
   growthPerkStatus: { color: SUBTLE, fontSize: FS.xs, fontFamily: FONT.medium },
  popularBadge:       { alignSelf: 'flex-start', backgroundColor: `${SUCCESS}22`, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginBottom: SP.sm },
  popularText:        { color: SUCCESS, fontSize: FS.xs, fontFamily: FONT.semibold, letterSpacing: 0.5 },
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
  changePlanText:     { color: ON_ACCENT, fontSize: FS.sm, fontFamily: FONT.semibold },
  cancelBtn:          { alignItems: 'center', paddingVertical: SP.lg },
  restoreBtn:         { alignItems: 'center', paddingVertical: SP.sm, marginBottom: SP.md },
  restoreText:        { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  cancelText:         { color: SUBTLE, fontSize: FS.sm, fontFamily: FONT.regular },
  billingCard:        { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md, overflow: 'hidden' },
  legalFooter:        { paddingTop: SP.sm, paddingHorizontal: SP.xs, gap: 10 },
  legalFooterText:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 16, textAlign: 'center' },
  legalLinksRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  legalLink:          { fontSize: FS.xs, fontFamily: FONT.medium, color: FG, textDecorationLine: 'underline' },
  legalLinkDivider:   { fontSize: FS.xs, color: MUTED },
  pastDueAlert:       { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, backgroundColor: `${RED}1F`, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: `${RED}73`, padding: SP.md, marginBottom: SP.md },
  pastDueIcon:        { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: `${RED}29` },
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
