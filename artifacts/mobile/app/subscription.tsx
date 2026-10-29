/**
 * Seller subscription & billing screen.
 *
 * Tiers (matching the three-tier catalogue):
 *   starter  $29/mo
 *   growth   $79/mo
 *   pro     $199/mo
 *
 * All plans carry a 5% platform commission on sales.
 * New subscriptions start with a free trial (card collected upfront); length
 * from the shared plan config (lib/sellerPlanConfig.ts).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Linking, AppState, AppStateStatus, Platform } from 'react-native';

import { useAuth } from '@clerk/expo';

import { Icon } from '@/components/ui/Icon';

import { useRouter, useFocusEffect } from 'expo-router';

import { LinearGradient } from 'expo-linear-gradient';

import { haptics, haptic } from '@/lib/haptics';

import { showToast } from '@/lib/toast';



import { ScreenHeader } from '@/components/ScreenHeader';

import { FONT, FS, SP, RADIUS, ON_LIGHT_MUTED } from '@/lib/theme';

import { getOnAccentTextStyle, useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

import { useApi } from '@/hooks/useApi';

import { invalidatePlanCache } from '@/hooks/useSubscriptionPlan';

import { isManagerRole, parseRoleError } from '@/lib/roleError';

import { RoleLockedView } from '@/components/RoleLockedView';
import { RetryRow } from '@/components/ui/RetryRow';

import { formatCents } from '@/lib/money';

import { STORE_BILLED_NOTICE, WEB_BILLED_NOTICE, currentPlanSummary, manageSubscriptionAction } from '@/lib/currentPlan';

import { pollSubscriptionStatus } from '@/lib/pollSubscriptionStatus';

import { useTeamRole } from '@/hooks/useTeamRole';

import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';

import { isSellerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { DEMO_PERKS, findPlanPerk, formatFeeRate, type PerksResponse } from '@/lib/proPerks';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { Feather } from '@expo/vector-icons';

import { useRevenueCat } from '@/lib/revenueCat';
import { paymentAlertFor, type DunningSummary } from '@/lib/billingStatus';
import { Button } from '@/components/ui/Button';
import { SELLER_PACKAGE_IDS } from '@/lib/sellerBilling';

import { getSellerPlan, SELLER_PLANS } from '@/lib/sellerPlans';

import { formatPlanPrice, useSellerPlanConfig } from '@/lib/sellerPlanConfig';

import { PlanTierCard } from '@/components/plans/PlanTierCard';

import { CompareFeaturesSheet } from '@/components/plans/CompareFeaturesSheet';

import { isSubscriptionPaymentRecoveryRequired, platformSubscriptionSettingsUrl, type SubscriptionBillingProvider } from '@/lib/subscriptionRecovery';

import { manageOrCancelLine } from '@/lib/trialOffer';

import { accessEndLabel, cancelConfirmCopy, planCancelAction } from '@/lib/planCancel';
import { getBillingRecoveryTarget } from '@/lib/subscriptionRecovery';
import { friendlyError } from '@/lib/friendlyError';

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
  // Clears the floating seller tab bar so the legal footer stays tappable.
  const tabBarInset = useSellerTabBarInset();
  const router = useRouter();
  const api    = useApi();
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const isSellerPreview = isSellerDevPreview() && (!authLoaded || !isSignedIn || !userId);
  const { available: revenueCatAvailable, packages: revenueCatPackages, purchase, restore, managementURL } = useRevenueCat();
  const planConfig = useSellerPlanConfig();
  const [compareOpen, setCompareOpen] = useState(false);

  const [activeTab,   setActiveTab]   = useState<'plan' | 'billing'>('plan');
  const { currentRole, isLoadingRole, roleError, retryRole } = useTeamRole();
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
    dunning:            null as DunningSummary,
    status:             'none',
    effectiveProvider:  'none' as SubscriptionBillingProvider,
    amountCents:        0,
    paymentMethodLabel: null as string | null,
    cancelAtPeriodEnd:  false,
    accessEndsAt:       null as string | null,
    manageUrl:          null as string | null,
  });

  // Derive the active plan id from loaded data
  const selectedPlan = currentPlan.name.toLowerCase();
  // No subscription = no plan (there is no free tier): never "Starter · Free"
  // next to a "$29 CURRENT PLAN" card (QA-0166).
  const planSummary = currentPlanSummary({ plan: selectedPlan, status: currentPlan.status, amountCents: currentPlan.amountCents });
  const commissionPerk = findPlanPerk(perks, selectedPlan);
  const commissionRate = commissionPerk ? formatFeeRate(commissionPerk.platformFeeBps) : null;
  const statusUnavailable = statusError && !statusLoaded;

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
      period:             data.interval === 'year' ? 'year' : 'month',
      renewsOn:           data.renewsOn ?? '—',
      trialEnd:           data.trialEnd ?? null,
      dunning:            data.dunning ?? null,
      status:             data.status,
      effectiveProvider:  data.effectiveProvider,
      amountCents:        data.amountCents,
      paymentMethodLabel: data.paymentMethodLabel,
      cancelAtPeriodEnd:  data.cancelAtPeriodEnd === true,
      accessEndsAt:       data.accessEndsAt ?? null,
      manageUrl:          data.manageUrl ?? null,
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

  async function handleChangePlan(planId: string) {
    if (isSellerPreview) return;
    // Only treat the current plan as "already selected" when there's an active subscription.
    // status:'none' means no paid plan yet — Starter must remain selectable.
    if (planId === selectedPlan && currentPlan.status !== 'none') return;

    if (planId === 'starter' && currentPlan.status !== 'none') {
      // App Store / Google Play subscriptions are changed in the store, not in
      // the Stripe billing portal.
      const storeManaged = currentPlan.effectiveProvider === 'revenuecat'
        || (currentPlan.effectiveProvider !== 'stripe' && Platform.OS !== 'web');
      const storeName = Platform.OS === 'android' ? 'Google Play' : 'App Store';
      Alert.alert(
        'Downgrade plan',
        storeManaged
          ? `To change or cancel your plan, open your ${storeName} subscriptions.`
          : 'To change or cancel your subscription, use the billing portal.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: storeManaged ? 'Manage subscription' : 'Open portal', onPress: handleOpenPortal },
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
        haptic('purchaseSuccess');
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
      Alert.alert('Checkout error', friendlyError(e, "Couldn't open checkout. Try again."));
    }
  }

  async function handleOpenPortal() {
    if (isSellerPreview) return;
    try {
      // Native never opens the Stripe portal (App Store 3.1.1 / 3.1.3, QA-0167):
      // store plans open the store's subscription page, web-billed plans get a
      // plain-text notice with no link.
      const action = manageSubscriptionAction(Platform.OS, currentPlan.effectiveProvider, managementURL);
      if (action.kind === 'open_url') {
        await Linking.openURL(action.url);
        return;
      }
      if (action.kind === 'web_billed') {
        Alert.alert('Manage subscription', WEB_BILLED_NOTICE);
        return;
      }
      if (action.kind === 'store_billed') {
        Alert.alert('Manage subscription', STORE_BILLED_NOTICE);
        return;
      }
      if (action.kind === 'no_subscription') {
        Alert.alert('No subscription to manage', 'Choose a plan above to start one.');
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
      Alert.alert('Portal error', friendlyError(e, "Couldn't open billing portal. Try again."));
    }
  }

  const cancelAction = planCancelAction(currentPlan);

  /** Settings → Plan → "Cancel plan" / "Resubscribe" (lib/planCancel.ts). */
  function handleCancelButton() {
    if (isSellerPreview) return;
    if (cancelAction === 'manage') { handleOpenPortal(); return; }
    if (cancelAction === 'resubscribe') { void resubscribe(); return; }
    const copy = cancelConfirmCopy(currentPlan);
    const confirm = () => { void cancelPlan(); };
    if (Platform.OS === 'web') {
      // Alert buttons don't run on react-native-web.
      if (typeof window !== 'undefined' && window.confirm(`${copy.title}\n\n${copy.message}`)) confirm();
      return;
    }
    Alert.alert(copy.title, copy.message, [
      { text: 'Keep plan', style: 'cancel' },
      { text: 'Cancel plan', style: 'destructive', onPress: confirm },
    ]);
  }

  async function openStoreSubscriptions() {
    const url = currentPlan.manageUrl ?? managementURL;
    if (url) await Linking.openURL(url);
    else handleOpenPortal();
  }

  async function cancelPlan() {
    try {
      if (currentPlan.effectiveProvider === 'revenuecat') {
        // In-app purchases are cancelled in the App Store / Google Play.
        externalSessionOpenedRef.current = { kind: 'portal' };
        await openStoreSubscriptions();
        return;
      }
      const result = await api.seller.subscription.cancel();
      invalidatePlanCache();
      await fetchStatus();
      const until = accessEndLabel(result.accessEndsAt);
      const done = `${result.inTrial ? "You won't be charged." : "You won't be charged again."}${until ? ` You can keep selling until ${until}.` : ''}`;
      if (Platform.OS === 'web') window.alert(`Plan cancelled. ${done}`);
      else Alert.alert('Plan cancelled', done);
    } catch (e: any) {
      externalSessionOpenedRef.current = null;
      if (parseRoleError(e)) { Alert.alert('Only the store owner can do this'); return; }
      Alert.alert('Could not cancel', friendlyError(e, 'Please try again.'));
    }
  }

  async function resubscribe() {
    try {
      if (currentPlan.effectiveProvider === 'revenuecat') {
        externalSessionOpenedRef.current = { kind: 'portal' };
        await openStoreSubscriptions();
        return;
      }
      await api.seller.subscription.resume();
      invalidatePlanCache();
      await fetchStatus();
    } catch (e: any) {
      externalSessionOpenedRef.current = null;
      if (e?.code === 'RESUBSCRIBE_REQUIRED') { router.push('/plans' as never); return; }
      if (parseRoleError(e)) { Alert.alert('Only the store owner can do this'); return; }
      Alert.alert('Could not resubscribe', friendlyError(e, 'Please try again.'));
    }
  }

  async function handleRestore() {
    if (isSellerPreview) return;
    try {
      await restore();
      invalidatePlanCache();
      await fetchStatus();
      showToast('Purchases restored', 'Your subscription has been refreshed.');
    } catch (e: any) {
      Alert.alert("Couldn't restore purchases", 'Please check your connection and try again.');
    }
  }

  // Status pill
  const statusColor =
    currentPlan.status === 'active'    ? theme.success
    : currentPlan.status === 'trialing' ? theme.secondary
    : currentPlan.status === 'past_due' ? theme.warning
    : currentPlan.status === 'paused'   ? theme.error
    : currentPlan.status === 'canceled' ? theme.error
    : theme.onAccent;

  const statusLabel =
    currentPlan.status === 'active'    ? 'Active'
    : currentPlan.status === 'trialing' ? 'Trial'
    : currentPlan.status === 'past_due' ? 'Past Due'
    : currentPlan.status === 'paused'   ? 'Paused'
    : currentPlan.status === 'canceled' ? 'Cancelled'
    : planSummary.statusLabel;

  // Failed payments (item 115): "Retry N of 3 on <date>", then "Your plan is
  // paused" after the last retry, with one "Update card" button
  // (lib/billingStatus.ts; layout from Warby Parker's update-card card).
  const perPeriod = currentPlan.period === 'year' ? '/yr' : '/mo';
  const paymentAlert = paymentAlertFor({
    status: currentPlan.status,
    provider: currentPlan.effectiveProvider,
    dunning: currentPlan.dunning,
    planName: currentPlan.name,
    platformOS: Platform.OS,
  });
  const paymentAlertCard = paymentAlert && (
    <View style={styles.pastDueAlert} testID="seller-subscription-past-due-alert">
      <View style={styles.pastDueIcon}>
        <Icon name="alert-circle" size={18} color={theme.error} />
      </View>
      <View style={styles.pastDueCopy}>
        <Text style={styles.pastDueTitle}>{paymentAlert.title}</Text>
        <Text style={styles.pastDueBody}>{paymentAlert.body}</Text>
        {!isReadOnly && !isSellerPreview && (
          <Button
            label={paymentAlert.cta}
            onPress={handleOpenPortal}
            size="small"
            fullWidth
            style={styles.pastDueButton}
            testID="seller-subscription-update-card"
          />
        )}
      </View>
    </View>
  );

  if (isLoadingRole && !isSellerPreview) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Subscription" />
        <View style={styles.accessSkeleton}>
          <SkeletonBlock width="100%" height={44} radius={RADIUS.lg} />
          <SkeletonBlock width="100%" height={160} radius={RADIUS.xl} />
          <SkeletonBlock width="100%" height={232} radius={RADIUS.lg} />
        </View>
      </View>
    );
  }

  // A failed role lookup is not "no access": offer a retry instead of the
  // owner-only lock, so an owner on a flaky request isn't told they're locked out.
  if (!isSellerPreview && roleError) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Subscription" />
        <View style={{ padding: SP.md }}>
          <RetryRow label="Couldn't load your subscription" onRetry={retryRole} />
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
            onPress={() => { haptic('select'); setActiveTab(t); }}
          >
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: tabBarInset + SP.lg }]}>

        {/* ── Plan tab ── */}
        {activeTab === 'plan' && (
          <>
            {!statusLoading && paymentAlertCard}
            {/* Current plan summary card */}
            {!statusUnavailable && (
            <LinearGradient colors={theme.primaryGradient as any} style={styles.currentPlanCard}>
              {statusLoading ? (
                <View style={styles.currentPlanSkeleton} accessibilityLabel="Loading your plan">
                  <SkeletonBlock width={88} height={13} />
                  <SkeletonBlock width={140} height={24} />
                  <SkeletonBlock width="70%" height={13} />
                </View>
              ) : (
                <>
                  <View style={styles.currentPlanRow}>
                    <View>
                      <Text style={[styles.currentPlanLabel, { color: theme.onAccent }]}>Current plan</Text>
                      <Text style={[styles.currentPlanName, { color: theme.onAccent }]}>{planSummary.name}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: `${statusColor}30` }]}>
                      <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                    </View>
                  </View>

                  {/* Trial end or renewal line */}
                  {currentPlan.status === 'canceled' || currentPlan.cancelAtPeriodEnd ? (
                    <Text testID="seller-subscription-access-ends" style={[styles.currentPlanRenews, { color: theme.onAccent }]}>
                      {currentPlan.cancelAtPeriodEnd ? 'Cancelled · ' : ''}Access continues until {accessEndLabel(currentPlan.accessEndsAt) ?? currentPlan.renewsOn}
                    </Text>
                  ) : currentPlan.trialEnd ? (
                    <Text style={[styles.currentPlanRenews, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                      Free trial ends {currentPlan.trialEnd} · then {currentPlan.price}{perPeriod}
                    </Text>
                  ) : currentPlan.status === 'active' ? (
                    <Text style={[styles.currentPlanRenews, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                      Renews {currentPlan.renewsOn} · {currentPlan.price}{perPeriod}
                    </Text>
                  ) : (
                    <Text style={[styles.currentPlanRenews, { color: theme.onAccent }]}>
                      Upgrade to unlock more features
                    </Text>
                  )}

                  {/* Commission reminder */}
                  <Text style={[styles.currentPlanRenews, getOnAccentTextStyle(theme), { color: ON_LIGHT_MUTED, marginTop: 8 }]}>
                    + 5% platform commission on sales
                  </Text>
                </>
              )}
            </LinearGradient>
            )}

            {/* Plan options */}
            <Text style={styles.sectionTitle}>All plans</Text>
            {/* Plan cards from the shared plan config: the product count is the headline. */}
            <View style={{ gap: SP.sm }}>
              {planConfig.tiers.map((tier, i) => {
                const isCurrent = planSummary.hasPlan && tier.id === planSummary.planId;
                const plan = getSellerPlan(tier.id);
                const nativePrice = revenueCatPackages.find((pkg) => pkg.identifier === SELLER_PACKAGE_IDS[tier.id])?.product.priceString;
                return (
                  <PlanTierCard
                    key={tier.id}
                    testID={`seller-subscription-plan-${tier.id}`}
                    tier={tier}
                    below={planConfig.tiers[i - 1] ?? null}
                    selected={isCurrent}
                    priceLabel={Platform.OS === 'web' ? formatPlanPrice(tier.amountCents) : nativePrice ?? null}
                    badge={isCurrent ? 'Current plan' : null}
                    footer={!isReadOnly && !isSellerPreview && !isCurrent && plan ? (
                      <TouchableOpacity
                        testID={`seller-subscription-change-${tier.id}`}
                        style={[styles.changePlanBtn, tier.id === 'starter' && styles.changePlanBtnOutline]}
                        onPress={() => handleChangePlan(tier.id)}
                      >
                        <Text style={[styles.changePlanText, tier.id === 'starter' && { color: MUTED }]}>
                          {tier.id === 'starter' && planSummary.hasPlan ? 'Downgrade' : `Switch to ${tier.name}`}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  />
                );
              })}
              <TouchableOpacity onPress={() => setCompareOpen(true)} accessibilityRole="button" testID="seller-subscription-compare" style={{ alignSelf: 'flex-start', paddingVertical: SP.xs }}>
                <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, textDecorationLine: 'underline' }}>Compare all features</Text>
              </TouchableOpacity>
            </View>
            <CompareFeaturesSheet visible={compareOpen} onClose={() => setCompareOpen(false)} tiers={planConfig.tiers} commissionPercent={planConfig.commissionPercent} />

              {!isReadOnly && !isSellerPreview && (
                <TouchableOpacity testID="seller-subscription-cancel" style={styles.cancelBtn} onPress={handleCancelButton}>
                  <Text style={styles.cancelText}>
                    {cancelAction === 'cancel' ? 'Cancel plan'
                      : cancelAction === 'resubscribe' ? 'Resubscribe'
                      : Platform.OS === 'web' ? 'Manage or cancel subscription' : 'Manage subscription'}
                  </Text>
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
                  Subscriptions renew automatically at the price shown unless you cancel at least 24 hours before the period ends. {manageOrCancelLine(Platform.OS)}
                </Text>
                <View style={styles.legalLinksRow}>
                  <Text style={styles.legalLink} onPress={() => router.push('/terms' as never)}>
                    Terms of Use
                  </Text>
                  <Text style={styles.legalLinkDivider}>·</Text>
                  <Text style={styles.legalLink} onPress={() => router.push('/privacy' as never)}>
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
                  {paymentAlertCard}
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
                          ? `${currentPlan.price}${perPeriod}`
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
                    <TouchableOpacity testID="seller-subscription-manage-billing" style={styles.manageBillingBtn} onPress={handleOpenPortal}>
                     <Icon name="external-link" size={16} color={PURPLE} />
                      <Text style={styles.manageBillingText}>{Platform.OS === 'web' ? 'Manage billing & invoices' : 'Manage subscription'}</Text>
                     <Icon name="chevron-right" size={16} color={MUTED} />
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
  accessSkeleton:     { padding: SP.md, gap: SP.sm },
  currentPlanSkeleton:{ gap: SP.sm },
  tabRow:             { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, marginHorizontal: SP.md },
  tab:                { flex: 1, paddingVertical: SP.sm, alignItems: 'center' },
  tabActive:          { borderBottomWidth: 2, borderBottomColor: FG },
  tabText:            { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  tabTextActive:      { color: FG },
  scroll:             { padding: SP.md },
  currentPlanCard:    { borderRadius: RADIUS.xl, padding: SP.lg, marginBottom: SP.lg },
  currentPlanRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SP.sm },
  // Text colour here is always overridden inline with theme.onAccent (flat, no shadow)
  // since this card sits on primaryGradient; the base value just needs to be theme-safe.
  currentPlanLabel:   { color: ON_ACCENT, fontSize: FS.xs, fontFamily: FONT.medium },
  currentPlanName:    { color: ON_ACCENT, fontSize: FS.xxl, fontFamily: FONT.semibold },
  currentPlanRenews:  { color: ON_ACCENT, fontSize: FS.xs, fontFamily: FONT.regular },
  statusPill:         { borderRadius: 16, paddingHorizontal: 8, paddingVertical: 2 },
  statusText:         { fontSize: FS.xs, fontFamily: FONT.medium },
  sectionTitle:       { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm },
  planCard:           { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
  planCardHighlight:  { borderColor: MUTED, backgroundColor: CARD_ELEVATED },
  planCardFeatured:   {
    borderColor: PURPLE,
    backgroundColor: CARD_ELEVATED,
    borderWidth: 2,
    // The 2pt border carries the emphasis: no soft halo, and no resting
    // scale (a 1.015x card re-samples every line of text in it).
  },
   growthComparison:   { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
   growthComparisonHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.lg },
   growthComparisonIcon: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
   growthComparisonHeading: { flex: 1 },
   growthComparisonTitle: { color: FG, fontSize: FS.md, fontFamily: FONT.semibold },
   growthComparisonSubtitle: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
   growthFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.md },
   growthToolIcon: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER },
   growthFeatureLabels: { flex: 1, paddingTop: 1 },
   growthFeatureTitle: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold },
   growthFeatureDescription: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18, marginTop: 2 },
   growthFeatureStatus: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 4, marginTop: 1 },
   growthFeatureStatusText: { fontSize: FS.xs, fontFamily: FONT.medium },
   growthComparisonDivider: { height: 1, backgroundColor: BORDER, marginTop: SP.xs, marginBottom: SP.md },
   growthExtrasLabel: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm },
   growthPerkRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
   growthPerkIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
   growthPerkText: { color: FG, fontSize: FS.sm, fontFamily: FONT.regular, flex: 1 },
   growthPerkTextDim: { color: SUBTLE },
   growthPerkStatus: { color: SUBTLE, fontSize: FS.xs, fontFamily: FONT.medium },
  popularBadge:       { alignSelf: 'flex-start', backgroundColor: `${FG}1F`, borderRadius: 16, paddingHorizontal: 8, paddingVertical: 2, marginBottom: SP.sm },
  popularText:        { color: FG, fontSize: FS.xs, fontFamily: FONT.semibold },
  planHeader:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SP.md },
  planName:           { color: FG, fontSize: FS.lg, fontFamily: FONT.semibold },
  planTagline:        { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
  planPriceCol:       { alignItems: 'flex-end' },
  planPrice:          { color: FG, fontSize: FS.xl, fontFamily: FONT.semibold, fontVariant: ['tabular-nums'] },
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
  pastDueBody:        { color: FG, fontSize: FS.xs, fontFamily: FONT.regular, lineHeight: 14 },
  pastDueButton:      { marginTop: SP.sm },
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
