/**
 * Seller plan selection — shown during onboarding and accessible from seller settings.
 *
 * Tiers:
 *   Starter  $29/mo  — storefront, AI store builder, 25 products, basic analytics
 *   Growth   $79/mo  — unlimited products, AI Design Studio, manufacturer hub, live shopping
 *   Pro     $199/mo  — everything in Growth + unlimited team, advanced analytics, white-glove
 *
 * Platform commission on sales depends on the plan (GET /seller/subscription/perks).
 * Every new subscription starts with a free trial (card required upfront); its
 * length comes from the shared plan config (lib/sellerPlanConfig.ts, 7 days).
 *
 * Monthly / Yearly (item 116): a year is 10 × monthly ("2 months free",
 * lib/billingInterval.ts). The toggle copies Paramount+'s plan picker; on iOS /
 * Android it only appears when the RevenueCat offering has the yearly packages.
 *
 * The recommended tier is personalized based on the seller's brand-stage answer from onboarding.
 *
 * Redesign notes (single-page paywall, applying Superwall "4,000 paywalls" lessons):
 * headline → bullets → social proof → plan selector (recommended + 1, "View all plans"
 * for the rest) → trial CTA → trial timeline → restore/legal. No comparison table.
 * Every section below the header is a small reusable component
 * (components/paywall/*) so variants can be A/B tested without touching this
 * screen's purchase logic.
 *
 * Retention surfaces (exit drawer + one-time offer): tapping the close
 * control opens SellerPaywallExitDrawer instead of leaving immediately. The
 * drawer keeps the recommended plan selected and reframes its real price
 * per week/day — no discount there. Dismissing the drawer shows
 * SellerPaywallOneTimeOffer ONLY when `isOneTimeOfferAvailable` is true
 * (lib/paywallRetentionConfig.ts) — off by default until a real discounted
 * product is configured; until then dismissing the drawer just exits.
 */
import React, { useState, useEffect, useRef } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';

import { ActivityIndicator, Alert, AppState, AppStateStatus, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';

import { ScreenHeader } from '@/components/ScreenHeader';

import { useRouter, useLocalSearchParams } from 'expo-router';

import { LinearGradient } from 'expo-linear-gradient';

import { haptic } from '@/lib/haptics';
import { showToast } from '@/lib/toast';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_KEY } from './_layout';

import { useApi } from '@/lib/api';

import { parseRoleError } from '@/lib/roleError';

import { FONT, FS, SP, RADIUS } from '@/lib/theme';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { useRevenueCat } from '@/lib/revenueCat';

import { SELLER_PACKAGE_IDS } from '@/lib/sellerBilling';
import { isSubscriptionPaymentRecoveryRequired } from '@/lib/subscriptionRecovery';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import {
  ANNUAL_SAVINGS_LABEL, annualPackageFor, canOfferYearly, yearlyDisplayFor, type BillingInterval,
} from '@/lib/billingInterval';
import { useTeamRole } from '@/hooks/useTeamRole';

import { track } from '@/lib/analytics';

import { recommendSellerPlan, SELLER_PLANS, type SellerPlanDefinition } from '@/lib/sellerPlans';

import { displayPriceFor } from '@/lib/sellerPlansDisplay';

import { formatPlanPrice, useSellerPlanConfig } from '@/lib/sellerPlanConfig';

import { PlanTierCard } from '@/components/plans/PlanTierCard';

import { CompareFeaturesSheet } from '@/components/plans/CompareFeaturesSheet';

import { commissionSummary, wantsProHighlight, DEMO_PERKS, type PerksResponse } from '@/lib/proPerks';

import { isPreviewDemoMode, isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';

import { ONE_TIME_OFFER_DISCOUNT_PERCENT, isOneTimeOfferAvailable } from '@/lib/paywallRetentionConfig';

import { SellerPaywallHeadline } from '@/components/paywall/SellerPaywallHeadline';

import { SellerPaywallBullets } from '@/components/paywall/SellerPaywallBullets';

import { freeTrialDays, manageOrCancelLine } from '@/lib/trialOffer';

import type { PlanPricing } from '@/components/paywall/SellerPlanSelector';
import { SellerTrialTimeline, type TrialTimelineStep } from '@/components/paywall/SellerTrialTimeline';

import { SellerPaywallCTA } from '@/components/paywall/SellerPaywallCTA';

import { SellerPaywallExitDrawer } from '@/components/paywall/SellerPaywallExitDrawer';

import { SellerPaywallOneTimeOffer } from '@/components/paywall/SellerPaywallOneTimeOffer';

// ─── Benefit bullets shown above the plan selector — apply to every tier, so
//     they're framed as "what Brandthread does for sellers", not per-plan. ──
const BENEFIT_BULLETS = [
  'Launch a storefront with AI-built product pages',
  'Source and manage production through the Manufacturer Hub',
  'Track sales, customers, and inventory in one dashboard',
  'Grow with live shopping and promotion tools',
];

// ─── Trial timeline steps (Blinkist-style compact vertical timeline). Day 4's
//     reminder is label-only: no local/scheduled-notification system exists
//     in this app today (only the server-driven "Trial reminders" toggle in
//     Notification Settings) — see the PR description. ────────────────────
// Web checkout (Stripe) uses the server's trial (routes/subscription.ts
// trial_period_days = planCatalogue TRIAL_DAYS), which the shared plan config
// (`trialDays`) carries. Native reads each store product's own intro offer.

function trialSteps(days: number): TrialTimelineStep[] {
  return [
    { key: 'today', label: 'Today', detail: 'Full access unlocked', icon: 'unlock' },
    { key: 'remind', label: `Day ${Math.max(1, days - 1)}`, detail: "We remind you before your trial ends", icon: 'bell' },
    { key: 'bill',  label: `Day ${days}`, detail: 'Billing starts', icon: 'credit-card' },
  ];
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PlansScreen() {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const insets    = useSafeAreaInsets();
  const router    = useRouter();
  const api       = useApi();
  const { fromOnboarding, highlight, source } = useLocalSearchParams<{ fromOnboarding?: string; highlight?: string; source?: string }>();
  const isOnboarding = fromOnboarding === 'true';

  useEffect(() => {
    track('paywall_viewed', { source: source ?? (isOnboarding ? 'onboarding' : 'settings'), from_onboarding: isOnboarding });
  // Once per visit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { currentRole } = useTeamRole();
  const { available: revenueCatAvailable, packages, purchase, restore } = useRevenueCat();
  const { trialDays, tiers, commissionPercent } = useSellerPlanConfig();
  const [compareOpen, setCompareOpen] = useState(false);

  const [loadingId,         setLoadingId]         = useState<string | null>(null);
  const [awaitingReturn,    setAwaitingReturn]    = useState(false);
  const [recommendedId,     setRecommendedId]     = useState<SellerPlanDefinition['id'] | null>(null);
  const [currentPlanId,     setCurrentPlanId]     = useState<string | null>(null);
  /** 'none' means no paid subscription yet — Starter must remain selectable. */
  const [currentPlanStatus, setCurrentPlanStatus] = useState<string | null>(null);
  const [pricesTimedOut,    setPricesTimedOut]    = useState(false);
  const [perks,             setPerks]             = useState<PerksResponse | null>(null);
  const [selectedId,        setSelectedId]        = useState<SellerPlanDefinition['id'] | null>(null);
  const [billingInterval,   setBillingInterval]   = useState<BillingInterval>('month');
  const [currentInterval,   setCurrentInterval]   = useState<BillingInterval>('month');
  const [exitDrawerVisible, setExitDrawerVisible] = useState(false);
  const [offerVisible,      setOfferVisible]      = useState(false);
  // Guards each open/close cycle of the drawer/offer sheets against the
  // BottomSheet close callback firing twice (once on backdrop tap, once when
  // the close animation finishes) and against the CTA path (which closes the
  // sheet itself) re-triggering the "user dismissed" branch.
  const exitHandledRef  = useRef(false);
  const offerHandledRef = useRef(false);
  const suppressExitFlowRef = useRef(false);

  // Native pricing comes from RevenueCat asynchronously. If packages never
  // arrive, treat it as a real failure rather than leaving the CTA active
  // against a null price forever.
  useEffect(() => {
    if (Platform.OS === 'web' || packages.length > 0) return;
    const timer = setTimeout(() => setPricesTimedOut(true), 6000);
    return () => clearTimeout(timer);
  }, [packages.length]);

  const pricesFailed   = Platform.OS !== 'web' && packages.length === 0 && (!revenueCatAvailable || pricesTimedOut);
  // Native shows Yearly only when the offering has every annual package.
  const yearlyAvailable = canOfferYearly(Platform.OS, packages);
  const interval: BillingInterval = yearlyAvailable ? billingInterval : 'month';
  /** The seller's plan, on the interval they're billed — switching interval is a change. */
  const isCurrentPlan = (planId: string) => planId === currentPlanId && currentPlanStatus !== 'none' && currentInterval === interval;
  // Whether the store actually returned a free-trial intro offer for this user
  // on ANY plan — used to avoid promising a trial that isn't really there.
  // (The trial shown is the selected plan's own offer — see selectedTrialDays.)

  // AppState ref to detect return from Stripe Checkout browser tab
  const checkoutOpenedRef = useRef(false);

  // ── On mount: load brand stage recommendation + current plan ──────────────
  useEffect(() => {
    (async () => {
      const [stage, goalsJson, selected] = await AsyncStorage.multiGet([
        'onboarding_brand_stage', 'onboarding_goals', 'onboarding_selected_plan',
      ]);
      let goals: string[] = [];
      try {
        goals = goalsJson[1] ? JSON.parse(goalsJson[1]) : [];
      } catch {
        goals = [];
      }
      // Locked Pro surfaces (e.g. advanced analytics) open this screen with Pro preselected.
      const resolvedId = wantsProHighlight(highlight)
        ? 'pro'
        : (selected[1] as SellerPlanDefinition['id'] | null) ?? recommendSellerPlan(stage[1] ?? '', goals).planId;
      setRecommendedId(resolvedId);
      setSelectedId(resolvedId);
      // If not onboarding, load live plan so we can show CURRENT badge
      if (!isOnboarding) {
        try {
          const status = await api.seller.subscription.status();
          setCurrentPlanId(status.plan ?? null);
          setCurrentPlanStatus(status.status ?? null);
          setCurrentInterval(status.interval ?? 'month');
        } catch { /* non-fatal */ }
      }
    })();
  }, [isOnboarding, api, highlight]);

  // Plan perks (commission, credits) come from the server so the note below is never hardcoded.
  // Dev previews never call the API; `&demo=1` shows sample values.
  useEffect(() => {
    if (isSellerDevPreview() || isBuyerDevPreview()) {
      setPerks(isPreviewDemoMode() ? DEMO_PERKS : null);
      return;
    }
    let cancelled = false;
    api.seller.subscription.perks()
      .then((result) => { if (!cancelled) setPerks(result); })
      .catch(() => { /* non-fatal: the note falls back to generic copy */ });
    return () => { cancelled = true; };
  }, [api]);

  // ── AppState listener: when seller returns from Stripe Checkout ────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state: AppStateStatus) => {
      if (state === 'active' && checkoutOpenedRef.current) {
        checkoutOpenedRef.current = false;
        setAwaitingReturn(true);
        // Poll until the subscription is live (Stripe webhook may lag ~1-2s)
        let attempts = 0;
        while (attempts < 8) {
          await sleep(1500);
          try {
            const status = await api.seller.subscription.status();
            if (status.status === 'trialing' || status.status === 'active') {
              if (isOnboarding) {
                await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
                router.replace('/(tabs)/' as never);
              } else {
                setCurrentPlanId(status.plan ?? null);
                setCurrentPlanStatus(status.status ?? null);
                setCurrentInterval(status.interval ?? 'month');
                setLoadingId(null);
                setAwaitingReturn(false);
                showToast(
                  'Plan updated',
                  `You're now on the ${capitalize(status.plan)} plan.${status.status === 'trialing' ? ` Your ${trialDays}-day free trial has started.` : ''}`,
                );
              }
              return;
            }
          } catch { /* retry */ }
          attempts++;
        }
        // Timed out — likely checkout was cancelled
        setAwaitingReturn(false);
        setLoadingId(null);
      }
    });
    return () => sub.remove();
  }, [isOnboarding, api, router]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSelect(plan: SellerPlanDefinition) {
    if (currentRole && currentRole !== 'owner') {
      Alert.alert('Only the store owner can do this');
      return;
    }

    // "Skip" path — onboarding only, no Stripe, just go straight to dashboard
    if (plan.id === 'skip' as any) {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      router.replace('/(tabs)/' as never);
      return;
    }

    // Only treat the plan as already active when there's a real paid subscription.
    // status:'none' means no paid plan yet — Starter must remain selectable.
    if (!isOnboarding && isCurrentPlan(plan.id)) return;
    // Past due / paused: pay the open invoice (Update card), never a second plan.
    if (!isOnboarding && isSubscriptionPaymentRecoveryRequired(currentPlanStatus)) {
      await openPaymentUpdate();
      return;
    }

    track('plan_selected', { plan: plan.id });
    setLoadingId(plan.id);

    try {
      if (Platform.OS !== 'web') {
        const packageToPurchase = interval === 'year'
          ? annualPackageFor(packages, plan.id)
          : packages.find((pkg) => pkg.identifier === SELLER_PACKAGE_IDS[plan.id]);
        if (!revenueCatAvailable || !packageToPurchase) {
          throw new Error('Subscriptions are temporarily unavailable. Please try again shortly.');
        }
        await purchase(packageToPurchase);
        const status = await api.seller.subscription.status();
        setCurrentPlanId(status.plan ?? plan.id);
        setCurrentPlanStatus(status.status ?? 'active');
        setLoadingId(null);
        if (isOnboarding) {
          await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
          router.replace('/(tabs)/' as never);
        } else {
          showToast('Plan updated', `You're now on the ${capitalize(status.plan ?? plan.id)} plan.`);
        }
        return;
      }
      const { url } = await api.seller.subscription.checkout(plan.id, interval);
      checkoutOpenedRef.current = true;
      await Linking.openURL(url);
      // setLoadingId stays set until AppState fires on return
    } catch (e: any) {
      setLoadingId(null);
      if (e?.code === 'SUBSCRIPTION_NEEDS_PAYMENT_UPDATE') {
        await openPaymentUpdate();
        return;
      }
      if (parseRoleError(e)) {
        Alert.alert('Only the store owner can do this');
        return;
      }
      // Closing the App Store / Play sheet isn't an error.
      if (e?.userCancelled === true) {
        track('paywall_purchase_cancelled', { plan: plan.id });
        return;
      }
      Alert.alert(
        "Couldn't start checkout",
        'Please check your connection and try again.',
        [{ text: 'OK' }],
      );
    }
  }

  /** Same "Update card" flow as Settings → Subscription: the Stripe billing portal. */
  async function openPaymentUpdate() {
    try {
      const { url } = await api.seller.subscription.portal();
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert('Could not open billing', e?.message ?? 'Please try again.');
    }
  }

  async function handleRestore() {
    if (currentRole && currentRole !== 'owner') {
      Alert.alert('Only the store owner can do this');
      return;
    }
    setLoadingId('restore');
    try {
      await restore();
      const status = await api.seller.subscription.status();
      setCurrentPlanId(status.plan ?? null);
      setCurrentPlanStatus(status.status ?? null);
      showToast('Purchases restored', 'Your subscription status has been refreshed.');
    } catch (e: any) {
      Alert.alert("Couldn't restore purchases", 'Please check your connection and try again.');
    } finally {
      setLoadingId(null);
    }
  }

  /** The real exit — leaves the paywall. Reached only after the exit drawer
   *  (and, if enabled, the one-time offer) has been shown and dismissed. */
  async function performExit() {
    track('paywall_dismissed', { from_onboarding: isOnboarding });
    if (isOnboarding) {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      router.replace('/(tabs)/' as never);
    } else {
      goBackOr(router);
    }
  }

  /** X (settings) / "Not now" (onboarding) — opens the exit drawer instead
   *  of leaving immediately. */
  function requestExit() {
    haptic('sheet');
    exitHandledRef.current = false;
    setExitDrawerVisible(true);
  }

  function handleExitDrawerClose() {
    setExitDrawerVisible(false);
    if (exitHandledRef.current) return;
    exitHandledRef.current = true;
    if (suppressExitFlowRef.current) {
      suppressExitFlowRef.current = false;
      return;
    }
    if (isOneTimeOfferAvailable) {
      offerHandledRef.current = false;
      setOfferVisible(true);
    } else {
      performExit();
    }
  }

  function handleExitDrawerStartTrial() {
    suppressExitFlowRef.current = true;
    exitHandledRef.current = true;
    setExitDrawerVisible(false);
    handleSelect(selectedPlan);
  }

  function handleOfferClose() {
    setOfferVisible(false);
    if (offerHandledRef.current) return;
    offerHandledRef.current = true;
    if (suppressExitFlowRef.current) {
      suppressExitFlowRef.current = false;
      return;
    }
    performExit();
  }

  function handleOfferAccept() {
    suppressExitFlowRef.current = true;
    offerHandledRef.current = true;
    setOfferVisible(false);
    handleSelect(offerPlan);
  }

  // ── Full-screen "waiting for Stripe" overlay ──────────────────────────────
  if (awaitingReturn) {
    return (
      <View style={styles.awaitRoot}>
        <LinearGradient colors={theme.heroGradient as any} style={StyleSheet.absoluteFill} />
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.awaitTitle}>Confirming your plan…</Text>
        <Text style={styles.awaitSub}>This takes a moment.</Text>
      </View>
    );
  }

  function getPricing(plan: SellerPlanDefinition): PlanPricing {
    if (interval === 'year') {
      const annualPackage = annualPackageFor(packages, plan.id);
      const web = yearlyDisplayFor(plan);
      return Platform.OS === 'web'
        ? { priceLabel: web.price, period: web.period, note: web.note, loading: false, failed: false }
        : {
            priceLabel: annualPackage?.product.priceString ?? null,
            period: 'per year',
            note: annualPackage?.product.pricePerMonthString ? `${annualPackage.product.pricePerMonthString}/mo billed yearly` : null,
            loading: false,
            failed: !annualPackage,
          };
    }
    const revenueCatPackage = packages.find((pkg) => pkg.identifier === SELLER_PACKAGE_IDS[plan.id]);
    const webPrice = displayPriceFor(plan);
    // Web prices come from the shared plan config; native from the store.
    const configCents = tiers.find((t) => t.id === plan.id)?.amountCents;
    const priceLabel = Platform.OS === 'web'
      ? (configCents ? formatPlanPrice(configCents) : webPrice.price)
      : revenueCatPackage?.product.priceString ?? null;
    return {
      priceLabel,
      period: Platform.OS === 'web' ? webPrice.period : 'per month',
      loading: Platform.OS !== 'web' && !priceLabel && !pricesFailed,
      failed:  Platform.OS !== 'web' && !priceLabel && pricesFailed,
    };
  }

  const selectedPlan = SELLER_PLANS.find((p) => p.id === selectedId) ?? SELLER_PLANS.find((p) => p.id === recommendedId) ?? SELLER_PLANS[0];
  const offerPlan = SELLER_PLANS.find((p) => p.id === recommendedId) ?? selectedPlan;
  const selectedPricing = getPricing(selectedPlan);
  // Free-trial length for the SELECTED plan only: another plan having an
  // intro offer must not make this one promise a trial, and the length comes
  // from the store product rather than a hard-coded "5-day".
  const selectedTrialDays = Platform.OS === 'web'
    ? trialDays
    : freeTrialDays(packages.find((pkg) => pkg.identifier === SELLER_PACKAGE_IDS[selectedPlan.id])?.product.introPrice as any);
  const hasRealTrialOffer = selectedTrialDays != null;
  const selectedCtaDisabled = loadingId !== null
    || (!isOnboarding && isCurrentPlan(selectedPlan.id))
    || selectedPricing.failed;
  const isCurrentSelected = !isOnboarding && isCurrentPlan(selectedPlan.id);

  // ── Layout ────────────────────────────────────────────────────────────────
  const bottomPad = insets.bottom;

  return (
    <View style={styles.root}>

      <ScreenHeader
        title={isOnboarding ? 'Choose your plan' : 'Subscription plans'}
        variant="push"
        onBack={() => { goBackOr(router, isOnboarding ? '/onboarding' : '/(tabs)'); }}
        backAccessibilityLabel="Back to previous page"
        backTestID="seller-plans-back"
        actions={[{ icon: 'x', onPress: requestExit, accessibilityLabel: 'Close subscription plans' }]}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 48, gap: SP.lg }}
      >

        {/* Product in action — phone-framed dashboard preview */}
        <DashboardPreview theme={theme} styles={styles} />

        <SellerPaywallHeadline
          theme={theme}
          eyebrow="FOR SELLERS"
          title="Everything to build, run, and grow your brand"
          subtitle="One home for your storefront, production, and sales."
        />

        <SellerPaywallBullets theme={theme} bullets={BENEFIT_BULLETS} />

        {/* Monthly / Yearly (item 116) — sits right above the plan cards. */}
        {yearlyAvailable && (
          <SegmentedControl
            testID="seller-plans-interval"
            options={[
              { id: 'month', label: 'Monthly' },
              { id: 'year', label: `Yearly · ${ANNUAL_SAVINGS_LABEL}` },
            ]}
            selectedId={billingInterval}
            onChange={(id) => setBillingInterval(id as BillingInterval)}
          />
        )}

        {/* Plan cards: the active-product count is the headline (shared plan config). */}
        <View style={{ gap: SP.sm }}>
          {tiers.map((tier, i) => {
            const plan = SELLER_PLANS.find((p) => p.id === tier.id);
            const isCurrent = !isOnboarding && tier.id === currentPlanId && currentPlanStatus !== 'none';
            return (
              <PlanTierCard
                key={tier.id}
                testID={`seller-plan-card-${tier.id}`}
                tier={tier}
                below={tiers[i - 1] ?? null}
                selected={tier.id === selectedPlan.id}
                onSelect={() => setSelectedId(tier.id)}
                priceLabel={plan ? getPricing(plan).priceLabel : null}
                badge={isCurrent ? 'Current plan' : tier.id === recommendedId ? 'Recommended' : null}
              />
            );
          })}
          <TouchableOpacity onPress={() => setCompareOpen(true)} accessibilityRole="button" testID="seller-plans-compare" style={styles.compareRow}>
            <Text style={styles.compareText}>Compare all features</Text>
          </TouchableOpacity>
        </View>

        <SellerPaywallCTA
          theme={theme}
          label={
            loadingId === selectedPlan.id
              ? (hasRealTrialOffer ? 'Starting trial…' : 'Starting checkout…')
              : isCurrentSelected
                ? 'Current plan'
                : hasRealTrialOffer
                  ? `Start my ${selectedTrialDays}-day free trial`
                  : `Choose ${selectedPlan.name}`
          }
          onPress={() => handleSelect(selectedPlan)}
          icon={hasRealTrialOffer ? 'chevron-right' : undefined}
          loading={loadingId === selectedPlan.id}
          disabled={selectedCtaDisabled}
          testID="seller-plans-start-trial"
          subtext="No commitment. Cancel anytime."
          billingLine={
            hasRealTrialOffer && !selectedPricing.failed
              ? `Free for ${selectedTrialDays} days, then ${selectedPricing.priceLabel ?? selectedPlan.priceLabel}/${interval === 'year' ? 'year' : 'month'}`
              : null
          }
        />

        {selectedTrialDays != null && <SellerTrialTimeline theme={theme} steps={trialSteps(selectedTrialDays)} />}

        {/* Commission disclosure — small print, not part of the primary pitch */}
        <Text style={styles.commissionNote}>
          {commissionSummary(perks)
            ? `Platform commission on each sale: ${commissionSummary(perks)}.`
            : 'A platform commission applies to each sale.'}
        </Text>

        {/* Skip during onboarding — Starter is a paid plan, so this must not read as "free" */}
        {isOnboarding && (
          <TouchableOpacity
            style={styles.skipRow}
            onPress={requestExit}
            disabled={loadingId !== null}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={styles.skipText}>Not now</Text>
            <Icon name="arrow-right" size={14} color={theme.muted} />
          </TouchableOpacity>
        )}
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            style={styles.restoreRow}
            onPress={handleRestore}
            disabled={loadingId !== null}
            testID="seller-revenuecat-restore"
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
          >
            {loadingId === 'restore' ? <ActivityIndicator color={theme.muted} size="small" /> : <Text style={styles.skipText}>Restore purchases</Text>}
          </TouchableOpacity>
        )}

        {/* Apple guideline 3.1.2 — auto-renew disclosure + Terms/Privacy links */}
        <View style={styles.legalFooter}>
          <Text style={styles.legalFooterText}>
            Subscriptions renew automatically at the price shown unless you cancel at least 24 hours before the period ends. {manageOrCancelLine(Platform.OS)}
          </Text>
          <View style={styles.legalLinksRow}>
            <Text
              style={styles.legalLink}
              onPress={() => { router.push('/terms' as never); }}
            >
              Terms of Use
            </Text>
            <Text style={styles.legalLinkDivider}>·</Text>
            <Text
              style={styles.legalLink}
              onPress={() => { router.push('/privacy' as never); }}
            >
              Privacy Policy
            </Text>
          </View>
        </View>

      </ScrollView>

      <CompareFeaturesSheet visible={compareOpen} onClose={() => setCompareOpen(false)} tiers={tiers} commissionPercent={commissionPercent} />

      <SellerPaywallExitDrawer
        visible={exitDrawerVisible}
        onClose={handleExitDrawerClose}
        theme={theme}
        plans={SELLER_PLANS}
        recommendedId={recommendedId}
        currentPlanId={currentInterval === interval ? currentPlanId : null}
        isOnboarding={isOnboarding}
        selectedId={selectedId}
        onSelect={setSelectedId}
        getPricing={getPricing}
        selectedPlan={selectedPlan}
        hasRealTrialOffer={hasRealTrialOffer}
        trialDays={trialDays}
        onStartTrial={handleExitDrawerStartTrial}
        loading={loadingId === selectedPlan.id}
        ctaDisabled={selectedCtaDisabled}
      />
    </View>
  );
}

// ─── Phone-framed dashboard preview ────────────────────────────────────────
// A static, lightweight illustration of the seller dashboard "in action" —
// no image asset required, matches the monochrome design system. Stat values
// are abstract placeholder bars, never concrete figures, so a fresh account
// isn't shown revenue/orders it doesn't have.
function DashboardPreview({ theme, styles }: { theme: ReturnType<typeof useAppTheme>['theme']; styles: ReturnType<typeof createStyles> }) {
  const bars = [0.4, 0.65, 0.5, 0.85, 0.7, 1, 0.55];
  return (
    <View style={styles.phoneFrame} testID="seller-plans-dashboard-preview">
      <View style={styles.phoneNotch} />
      <View style={styles.phoneScreen}>
        <View style={styles.phoneStatRow}>
          <View style={styles.phoneStatCard}>
            <Text style={styles.phoneStatLabel}>Revenue</Text>
            <View style={styles.phoneStatValueBar} />
          </View>
          <View style={styles.phoneStatCard}>
            <Text style={styles.phoneStatLabel}>Orders</Text>
            <View style={[styles.phoneStatValueBar, { width: '45%' }]} />
          </View>
        </View>
        <View style={styles.phoneChart}>
          {bars.map((h, i) => (
            <View key={i} style={[styles.phoneChartBar, { height: `${h * 100}%` }]} />
          ))}
        </View>
        <View style={styles.phoneRow} />
        <View style={[styles.phoneRow, { width: '70%' }]} />
      </View>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function capitalize(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },

  // Phone-framed dashboard preview
  phoneFrame: {
    alignSelf: 'center',
    width: 220,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: theme.border,
    backgroundColor: theme.card,
    padding: 8,
    gap: 6,
  },
  phoneNotch: {
    alignSelf: 'center',
    width: 64,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.border,
    marginBottom: 2,
  },
  phoneScreen: {
    borderRadius: 16,
    backgroundColor: theme.cardElevated,
    padding: 12,
    gap: 8,
  },
  phoneStatRow: { flexDirection: 'row', gap: 8 },
  phoneStatCard: { flex: 1, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, padding: 8, gap: 2 },
  phoneStatLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
  phoneStatValueBar: { height: 10, width: '70%', borderRadius: 3, backgroundColor: theme.text, opacity: 0.85, marginTop: 4 },
  phoneChart: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 4,
    height: 44, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, padding: 6,
  },
  phoneChartBar: { flex: 1, backgroundColor: theme.accent, borderRadius: 2, opacity: 0.85 },
  phoneRow: { height: 8, borderRadius: 4, backgroundColor: theme.border, width: '100%' },

  commissionNote: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center' },

  // Skip
  skipRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: SP.sm, paddingVertical: SP.lg, marginTop: SP.xs,
  },
  skipText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  restoreRow: { alignItems: 'center', paddingVertical: SP.sm },
  compareRow: { alignSelf: 'flex-start', paddingVertical: SP.xs },
  compareText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, textDecorationLine: 'underline' },

  // Legal footer (Apple 3.1.2 — auto-renew disclosure + Terms/Privacy)
  legalFooter: { paddingTop: SP.sm, paddingHorizontal: SP.xs, gap: 12 },
  legalFooterText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, lineHeight: 18, textAlign: 'center' },
  legalLinksRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  legalLink: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text, textDecorationLine: 'underline' },
  legalLinkDivider: { fontSize: FS.sm, color: theme.muted },

  // Awaiting Stripe overlay
  awaitRoot: { flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 40 },
  awaitTitle: { fontSize: FS.xl, fontFamily: FONT.semibold, color: theme.text, textAlign: 'center' },
  awaitSub:   { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center' },
  });
};
