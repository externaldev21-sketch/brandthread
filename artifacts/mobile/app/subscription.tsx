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
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { invalidatePlanCache } from '@/hooks/useSubscriptionPlan';
import { isManagerRole, parseRoleError } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import { formatCents } from '@/lib/money';
import { pollSubscriptionStatus } from '@/lib/pollSubscriptionStatus';
import { useTeamRole } from '@/hooks/useTeamRole';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { DEMO_PERKS, findPlanPerk, formatFeeRate, type PerksResponse } from '@/lib/proPerks';
import { SkeletonBlock } from '@/components/ui/Skeleton';
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
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const isSellerPreview = isSellerDevPreview() && (!authLoaded || !isSignedIn || !userId);
  const { available: revenueCatAvailable, packages: revenueCatPackages, purchase, restore, managementURL } = useRevenueCat();
  const growthStudioTools = React.useMemo(() => getGrowthStudioTools(theme), [theme]);

  const [activeTab,   setActiveTab]   = useState<'plan' | 'billing'>('plan');
  const { currentRole, isLoadingRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);
  const [statusLoading, setStatusLoading] = useState(!isSellerPreview);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [perks, setPerks] = useState<PerksResponse | null>(null);
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
    if (isSellerPreview) {
      setStatusLoading(false);
      return;
    }
    setStatusLoading(true);
    setStatusError(false);
    try {
      const data = await api.seller.subscription.status();
      applyStatus(data);
      setStatusLoaded(true);
    } catch {
      // Keep the last known subscription state on transient failures.
      setStatusError(true);
    } finally {
      setStatusLoading(false);
    }
  }, [api, applyStatus, isSellerPreview]);

  // Commission depends on the plan — read it from the server, never hardcode it.
  useEffect(() => {
    if (isSellerPreview) {
      setPerks(isPreviewDemoMode() ? DEMO_PERKS : null);
      return;
    }
    let cancelled = false;
    Promise.resolve()
      .then(() => api.seller.subscription.perks())
      .then((result) => { if (!cancelled) setPerks(result); })
      .catch(() => { /* non-fatal: the commission line is hidden */ });
    return () => { cancelled = true; };
  }, [api, isSellerPreview]);

  useFocusEffect(
    useCallback(() => {
      if (isSellerPreview) return;
      invalidatePlanCache();
      fetchStatus();
    }, [fetchStatus, isSellerPreview]),
  );

  useEffect(() => {
    if (isSellerPreview) return;
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
  }, [api, applyStatus, isSellerPreview]);

  function haptic() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }

  async function handleChangePlan(planId: string) {
    if (isSellerPreview) return;
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
      // Closing the App Store sheet is not an error.
      if (e?.userCancelled) return;
      if (parseRoleError(e)) {
        Alert.alert('Only the store owner can do this');
        return;
      }
      Alert.alert('Checkout error', e?.message ?? 'Could not start checkout. Please try again.');
    }
  }

  async function handleOpenPortal() {
    if (isSellerPreview) return;
    haptic();
    try {
      const target = getBillingRecoveryTarget(currentPlan.effectiveProvider, managementURL);
      if (target === 'revenuecat') {
        await Linking.openURL(managementURL!);
        return;
      }
      if (target === 'subscription') {
        Alert.alert("Couldn't open billing", 'Subscription management is not available yet.');
        return;
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
    if (isSellerPreview) return;
    haptic();
    try {
      await restore();
      invalidatePlanCache();
      await fetchStatus();
      Alert.alert('Purchases restored', 'Your subscription has been refreshed.');
    } catch (e: any) {
      Alert.alert("Couldn't restore purchases", 'Please check your connection and try again.');
    }
  }

  // Status pill
  const statusColor =
    currentPlan.status === 'active'    ? theme.success
    : currentPlan.status === 'trialing' ? theme.secondary
    : currentPlan.status === 'past_due' ? theme.warning
    : currentPlan.status === 'canceled' ? theme.error
    : theme.onAccent;

  const statusLabel =
    currentPlan.status === 'active'    ? 'Active'
    : currentPlan.status === 'trialing' ? 'Trial'
    : currentPlan.status === 'past_due' ? 'Past due'
    : currentPlan.status === 'canceled' ? 'Cancelled'
    : 'Not subscribed';

  const commissionPerk = findPlanPerk(perks, selectedPlan);
  const commissionRate = commissionPerk ? formatFeeRate(commissionPerk.platformFeeBps) : null;
  const statusUnavailable = statusError && !statusLoaded;

  if (isLoadingRole && !isSellerPreview) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Subscription" />
        <View style={styles.accessLoading}>
          <ActivityIndicator color={theme.accent} />
        </View>
      </View>
    );
  }

  if (!isSellerPreview && currentRole !== 'owner' && !isReadOnly) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Subscription" />
        <RoleLockedView screenTitle="subscription & billing" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Subscription" />

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['plan', 'billing'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            testID={`seller-subscription-tab-${t}`}
            style={[styles.tab, activeTab === t && styles.tabActive]}
            onPress={() => { haptic(); setActiveTab(t); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === t }}
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
            {statusUnavailable && (
              <TouchableOpacity style={[styles.retryRow, { marginBottom: SP.md }]} onPress={fetchStatus} accessibilityRole="button" testID="seller-subscription-status-retry">
                <Feather name="refresh-cw" size={13} color={MUTED} />
                <Text style={styles.retryText}>Couldn’t load your plan — Tap to retry</Text>
              </TouchableOpacity>
            )}
            {/* Current plan summary card */}
            {!statusUnavailable && (
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
                  {commissionRate && (
                    <Text style={[styles.currentPlanRenews, { color: theme.onAccent, marginTop: 8, opacity: 0.6 }, getOnAccentTextStyle(theme)]}>
                      + {commissionRate} platform commission on sales
                    </Text>
                  )}
                </>
              )}
            </LinearGradient>
            )}

            {/* Plan options */}
            <Text style={styles.sectionTitle}>All plans</Text>
             {SELLER_PLANS.map((plan) => {
              // status 'none' = no paid plan yet, so Starter stays selectable.
              const isCurrent = plan.id === selectedPlan && currentPlan.status !== 'none';
              const isDowngrade = plan.id === 'starter' && currentPlan.status !== 'none';
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
                         <Feather name="check" size={14} color={FG} />
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
                    {!isReadOnly && !isSellerPreview && !isCurrent && (
                    <TouchableOpacity
                      testID={`seller-subscription-change-${plan.id}`}
                      style={[styles.changePlanBtn, isDowngrade && styles.changePlanBtnOutline]}
                      onPress={() => handleChangePlan(plan.id)}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.changePlanText, isDowngrade && { color: MUTED }]}>
                        {isDowngrade ? 'Downgrade' : currentPlan.status === 'none' ? `Choose ${plan.name}` : `Switch to ${plan.name}`}
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
                  <Text style={styles.growthComparisonTitle}>
                    {hasGrowthAccess ? 'What’s included in your plan' : 'What’s included in Growth'}
                  </Text>
                  <Text style={styles.growthComparisonSubtitle}>
                    {hasGrowthAccess ? 'Your Growth Studio toolkit at a glance' : 'Studio tools that unlock with Growth'}
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
                    { backgroundColor: hasGrowthAccess ? `${FG}18` : `${SUBTLE}12` },
                  ]}>
                    <Feather
                      name={hasGrowthAccess ? 'check' : 'lock'}
                      size={11}
                      color={hasGrowthAccess ? FG : SUBTLE}
                    />
                    <Text style={[
                      styles.growthFeatureStatusText,
                      { color: hasGrowthAccess ? FG : SUBTLE },
                    ]}>
                      {hasGrowthAccess ? 'Included' : 'Growth only'}
                    </Text>
                  </View>
                </View>
              ))}

              <View style={styles.growthComparisonDivider} />
              <Text style={styles.growthExtrasLabel}>Growth perks</Text>
              {GROWTH_EXTRAS.map((perk) => (
                <View key={perk.label} style={styles.growthPerkRow}>
                  <View style={[
                    styles.growthPerkIcon,
                    { backgroundColor: hasGrowthAccess ? `${FG}18` : `${SUBTLE}12` },
                  ]}>
                    <Feather
                      name={hasGrowthAccess ? 'check' : 'lock'}
                      size={11}
                      color={hasGrowthAccess ? FG : SUBTLE}
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

              {!isReadOnly && !isSellerPreview && (
                <TouchableOpacity testID="seller-subscription-cancel" style={styles.cancelBtn} onPress={handleOpenPortal} accessibilityRole="button">
                  <Text style={styles.cancelText}>{Platform.OS === 'web' ? 'Manage or cancel subscription' : 'Manage subscription'}</Text>
               </TouchableOpacity>
             )}
              {!isReadOnly && !isSellerPreview && Platform.OS !== 'web' && (
                <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} testID="seller-revenuecat-restore" accessibilityRole="button">
                  <Text style={styles.restoreText}>Restore purchases</Text>
                </TouchableOpacity>
              )}

              {/* Apple guideline 3.1.2 — auto-renew disclosure + Terms/Privacy links */}
              <View style={styles.legalFooter}>
                <Text style={styles.legalFooterText}>
                  Subscriptions renew automatically at the price shown unless you cancel at least 24 hours before the period ends. Manage or cancel in your App Store account settings.
                </Text>
                <View style={styles.legalLinksRow}>
                  <Text style={styles.legalLink} accessibilityRole="link" onPress={() => { haptic(); router.push('/terms' as never); }}>
                    Terms of Use
                  </Text>
                  <Text style={styles.legalLinkDivider}>·</Text>
                  <Text style={styles.legalLink} accessibilityRole="link" onPress={() => { haptic(); router.push('/privacy' as never); }}>
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
              <SkeletonBlock width="100%" height={232} radius={RADIUS.lg} />
            ) : statusUnavailable ? (
              <TouchableOpacity style={styles.retryRow} onPress={fetchStatus} accessibilityRole="button">
                <Feather name="refresh-cw" size={13} color={MUTED} />
                <Text style={styles.retryText}>Couldn’t load billing details — Tap to retry</Text>
              </TouchableOpacity>
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
                {currentPlan.status === 'none' && (
                  <Text style={styles.billingEmpty}>No active subscription yet. Choose a plan on the Plan tab.</Text>
                )}
                <View style={styles.billingCard}>
                  {currentPlan.trialEnd && (
                    <View style={styles.billingRow}>
                      <Text style={styles.billingLabel}>Trial ends</Text>
                      <Text style={styles.billingValue}>{currentPlan.trialEnd}</Text>
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
                    <Text style={styles.billingValue}>{commissionRate ? `${commissionRate} per sale` : '—'}</Text>
                  </View>
                  <View style={[styles.billingRow, { borderBottomWidth: 0 }]}>
                    <Text style={styles.billingLabel}>Payment method</Text>
                    <Text style={styles.billingValue}>{currentPlan.paymentMethodLabel ?? '—'}</Text>
                  </View>
                </View>

                  {!isReadOnly && !isSellerPreview && (
                    <TouchableOpacity testID="seller-subscription-manage-billing" style={styles.manageBillingBtn} onPress={handleOpenPortal} accessibilityRole="button">
                     <Feather name="external-link" size={16} color={FG} />
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
  tabRow:             { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, marginHorizontal: SP.md },
  tab:                { flex: 1, paddingVertical: SP.sm, alignItems: 'center' },
  tabActive:          { borderBottomWidth: 2, borderBottomColor: FG },
  tabText:            { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  tabTextActive:      { color: FG },
  scroll:             { padding: SP.md },
  currentPlanCard:    { borderRadius: RADIUS.xl, padding: SP.lg, marginBottom: SP.lg },
  currentPlanRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SP.sm },
  // Text colour here is always overridden inline with theme.onAccent (+ getOnAccentTextStyle)
  // since this card sits on primaryGradient; the base value just needs to be theme-safe.
  currentPlanLabel:   { color: ON_ACCENT, fontSize: FS.xs, fontFamily: FONT.medium },
  currentPlanName:    { color: ON_ACCENT, fontSize: FS.xxl, fontFamily: FONT.semibold },
  currentPlanRenews:  { color: ON_ACCENT, fontSize: FS.sm, fontFamily: FONT.regular },
  statusPill:         { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  statusText:         { fontSize: FS.xs, fontFamily: FONT.medium },
  sectionTitle:       { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  planCard:           { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
  planCardHighlight:  { borderColor: FG, backgroundColor: CARD_ELEVATED },
  planCardFeatured:   {
    borderColor: PURPLE,
    backgroundColor: CARD_ELEVATED,
    borderWidth: 2,
    shadowColor: PURPLE,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 7,
  },
   growthComparison:   { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
   growthComparisonHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.lg },
   growthComparisonIcon: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
   growthComparisonHeading: { flex: 1 },
   growthComparisonTitle: { color: FG, fontSize: FS.md, fontFamily: FONT.semibold },
   growthComparisonSubtitle: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
   growthFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.md },
   growthToolIcon: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
   growthFeatureLabels: { flex: 1, paddingTop: 1 },
   growthFeatureTitle: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold },
   growthFeatureDescription: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18, marginTop: 2 },
   growthFeatureStatus: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 4, marginTop: 1 },
   growthFeatureStatusText: { fontSize: FS.xs, fontFamily: FONT.medium },
   growthComparisonDivider: { height: 1, backgroundColor: BORDER, marginTop: SP.xs, marginBottom: SP.md },
   growthExtrasLabel: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.sm },
   growthPerkRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
   growthPerkIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
   growthPerkText: { color: FG, fontSize: FS.sm, fontFamily: FONT.regular, flex: 1 },
   growthPerkTextDim: { color: SUBTLE },
   growthPerkStatus: { color: SUBTLE, fontSize: FS.xs, fontFamily: FONT.medium },
  popularBadge:       { alignSelf: 'flex-start', backgroundColor: `${FG}1A`, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginBottom: SP.sm },
  popularText:        { color: FG, fontSize: FS.xs, fontFamily: FONT.semibold, letterSpacing: 0.5 },
  planHeader:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SP.md },
  planName:           { color: FG, fontSize: FS.lg, fontFamily: FONT.semibold },
  planTagline:        { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
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
  legalFooter:        { paddingTop: SP.sm, paddingHorizontal: SP.xs, gap: 12 },
  legalFooterText:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 18, textAlign: 'center' },
  legalLinksRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  legalLink:          { fontSize: FS.sm, fontFamily: FONT.medium, color: FG, textDecorationLine: 'underline' },
  legalLinkDivider:   { fontSize: FS.sm, color: MUTED },
  pastDueAlert:       { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, backgroundColor: `${RED}1F`, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: `${RED}73`, padding: SP.md, marginBottom: SP.md },
  pastDueIcon:        { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: `${RED}29` },
  pastDueCopy:        { flex: 1, gap: 4 },
  pastDueTitle:       { color: RED, fontSize: FS.sm, fontFamily: FONT.semibold },
  pastDueBody:        { color: FG, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  billingRow:         { flexDirection: 'row', justifyContent: 'space-between', padding: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  billingLabel:       { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular },
  retryRow:           { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: SP.sm, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingVertical: SP.sm, paddingHorizontal: SP.md },
  retryText:          { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  billingEmpty:       { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, marginBottom: SP.md },
  billingValue:       { color: FG, fontSize: FS.sm, fontFamily: FONT.medium },
  manageBillingBtn:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER },
  manageBillingText:  { flex: 1, color: FG, fontSize: FS.sm, fontFamily: FONT.medium },
  });
};
