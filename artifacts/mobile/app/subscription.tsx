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
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Linking, AppState, AppStateStatus, Platform,
} from 'react-native';
import { useAuth } from '@clerk/expo';
import { Icon } from '@/components/ui/Icon';
import { useRouter, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { haptics } from '@/lib/haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { FONT, FS, SP, RADIUS, ON_LIGHT_MUTED } from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { invalidatePlanCache } from '@/hooks/useSubscriptionPlan';
import { isManagerRole, parseRoleError } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import { formatCents } from '@/lib/money';
import {
  STORE_BILLED_NOTICE, WEB_BILLED_NOTICE, currentPlanSummary, manageSubscriptionAction,
} from '@/lib/currentPlan';
import { pollSubscriptionStatus } from '@/lib/pollSubscriptionStatus';
import { useTeamRole } from '@/hooks/useTeamRole';
import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';
import { isSellerDevPreview } from '@/lib/devPreview';
import { useRevenueCat } from '@/lib/revenueCat';
import { SELLER_PACKAGE_IDS } from '@/lib/sellerBilling';
import { getSellerPlan, SELLER_PLANS } from '@/lib/sellerPlans';
import { formatPlanPrice, useSellerPlanConfig } from '@/lib/sellerPlanConfig';
import { PlanTierCard } from '@/components/plans/PlanTierCard';
import { CompareFeaturesSheet } from '@/components/plans/CompareFeaturesSheet';
import {
  isSubscriptionPaymentRecoveryRequired,
  platformSubscriptionSettingsUrl,
  type SubscriptionBillingProvider,
} from '@/lib/subscriptionRecovery';
import { manageOrCancelLine } from '@/lib/trialOffer';
import { accessEndLabel, cancelConfirmCopy, planCancelAction } from '@/lib/planCancel';

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
  const { currentRole, isLoadingRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);
  const [statusLoading, setStatusLoading] = useState(!isSellerPreview);
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
    cancelAtPeriodEnd:  false,
    accessEndsAt:       null as string | null,
    manageUrl:          null as string | null,
  });

  // Derive the active plan id from loaded data
  const selectedPlan = currentPlan.name.toLowerCase();
  // No subscription = no plan (there is no free tier): never "Starter · Free"
  // next to a "$29 CURRENT PLAN" card (QA-0166).
  const planSummary = currentPlanSummary({ plan: selectedPlan, status: currentPlan.status, amountCents: currentPlan.amountCents });

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
    try {
      const data = await api.seller.subscription.status();
      applyStatus(data);
    } catch {
      // Keep the last known subscription state on transient failures.
    } finally {
      setStatusLoading(false);
    }
  }, [api, applyStatus, isSellerPreview]);

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
      Alert.alert('Portal error', e?.message ?? 'Could not open billing portal. Please try again.');
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
      Alert.alert('Could not cancel', e?.message ?? 'Please try again.');
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
      Alert.alert('Could not resubscribe', e?.message ?? 'Please try again.');
    }
  }

  async function handleRestore() {
    if (isSellerPreview) return;
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
    : theme.onAccent;

  const statusLabel =
    currentPlan.status === 'active'    ? 'Active'
    : currentPlan.status === 'trialing' ? 'Trial'
    : currentPlan.status === 'past_due' ? 'Past Due'
    : currentPlan.status === 'canceled' ? 'Cancelled'
    : planSummary.statusLabel;

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
            onPress={() => { haptics.selection(); setActiveTab(t); }}
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
            {/* Current plan summary card */}
            <LinearGradient colors={theme.primaryGradient as any} style={styles.currentPlanCard}>
              {statusLoading ? (
                <ActivityIndicator color={theme.onAccent} />
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
                    <Text style={[styles.currentPlanRenews, { color: theme.onAccent }]}>
                      Free trial ends {currentPlan.trialEnd} · then {currentPlan.price}/mo
                    </Text>
                  ) : currentPlan.status === 'active' ? (
                    <Text style={[styles.currentPlanRenews, { color: theme.onAccent }]}>
                      Renews {currentPlan.renewsOn} · {currentPlan.price}/mo
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
                <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} testID="seller-revenuecat-restore">
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
              <ActivityIndicator color={PURPLE} style={{ marginTop: SP.lg }} />
            ) : (
              <>
                  {isSubscriptionPaymentRecoveryRequired(currentPlan.status) && (
                    <View style={styles.pastDueAlert} testID="seller-subscription-past-due-alert">
                      <View style={styles.pastDueIcon}>
                        <Icon name="alert-circle" size={18} color={RED} />
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
  accessLoading:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabRow:             { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, marginHorizontal: SP.md },
  tab:                { flex: 1, paddingVertical: SP.sm, alignItems: 'center' },
  tabActive:          { borderBottomWidth: 2, borderBottomColor: PURPLE },
  tabText:            { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  tabTextActive:      { color: PURPLE },
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
   growthComparisonSubtitle: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
   growthFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.md },
   growthToolIcon: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER },
   growthFeatureLabels: { flex: 1, paddingTop: 1 },
   growthFeatureTitle: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold },
   growthFeatureDescription: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, lineHeight: 16, marginTop: 2 },
   growthFeatureStatus: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.pill, paddingHorizontal: 7, paddingVertical: 4, marginTop: 1 },
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
  planTagline:        { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
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
