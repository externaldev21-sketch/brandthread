/**
 * Seller plan selection — shown during onboarding and accessible from seller settings.
 *
 * Tiers:
 *   Starter  $29/mo  — storefront, AI store builder, 25 products, basic analytics
 *   Growth   $79/mo  — unlimited products, AI Design Studio, manufacturer hub, live shopping
 *   Pro     $199/mo  — everything in Growth + unlimited team, advanced analytics, white-glove
 *
 * Platform commission on sales depends on the plan (GET /seller/subscription/perks).
 * Every new subscription starts with a 5-day free trial (card required upfront).
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
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_KEY } from './_layout';
import { useApi } from '@/lib/api';
import { parseRoleError } from '@/lib/roleError';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useRevenueCat } from '@/lib/revenueCat';
import { SELLER_PACKAGE_IDS } from '@/lib/sellerBilling';
import { useTeamRole } from '@/hooks/useTeamRole';
import { recommendSellerPlan, SELLER_PLANS, type SellerPlanDefinition } from '@/lib/sellerPlans';
import { displayPriceFor } from '@/lib/sellerPlansDisplay';
import { commissionSummary, wantsProHighlight, DEMO_PERKS, type PerksResponse } from '@/lib/proPerks';
import { isPreviewDemoMode, isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';
import {
  ONE_TIME_OFFER_DISCOUNT_PERCENT,
  isOneTimeOfferAvailable,
} from '@/lib/paywallRetentionConfig';
import { SellerPaywallHeadline } from '@/components/paywall/SellerPaywallHeadline';
import { SellerPaywallBullets } from '@/components/paywall/SellerPaywallBullets';
import { SellerPaywallSocialProof } from '@/components/paywall/SellerPaywallSocialProof';
import { SellerPlanSelector, type PlanPricing } from '@/components/paywall/SellerPlanSelector';
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
const TRIAL_STEPS: TrialTimelineStep[] = [
  { key: 'today', label: 'Today', detail: 'Full access unlocked', icon: 'unlock' },
  { key: 'day4',  label: 'Day 4', detail: "We remind you before your trial ends", icon: 'bell' },
  { key: 'day5',  label: 'Day 5', detail: 'Billing starts', icon: 'credit-card' },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PlansScreen() {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const insets    = useSafeAreaInsets();
  const router    = useRouter();
  const api       = useApi();
  const { fromOnboarding, highlight } = useLocalSearchParams<{ fromOnboarding?: string; highlight?: string; source?: string }>();
  const isOnboarding = fromOnboarding === 'true';
  const { currentRole } = useTeamRole();
  const { available: revenueCatAvailable, packages, purchase, restore } = useRevenueCat();

  const [loadingId,         setLoadingId]         = useState<string | null>(null);
  const [awaitingReturn,    setAwaitingReturn]    = useState(false);
  const [recommendedId,     setRecommendedId]     = useState<SellerPlanDefinition['id'] | null>(null);
  const [currentPlanId,     setCurrentPlanId]     = useState<string | null>(null);
  /** 'none' means no paid subscription yet — Starter must remain selectable. */
  const [currentPlanStatus, setCurrentPlanStatus] = useState<string | null>(null);
  const [pricesTimedOut,    setPricesTimedOut]    = useState(false);
  const [perks,             setPerks]             = useState<PerksResponse | null>(null);
  const [selectedId,        setSelectedId]        = useState<SellerPlanDefinition['id'] | null>(null);
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
  // Whether the store actually returned a free-trial intro offer for this user
  // on ANY plan — used to avoid promising a trial that isn't really there.
  const hasRealTrialOffer = Platform.OS === 'web'
    ? true
    : packages.some((pkg) => !!pkg.product.introPrice);

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
                setAwaitingReturn(false);
                Alert.alert('Plan updated', `You're now on the ${capitalize(status.plan)} plan — enjoy your 5-day free trial!`);
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

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleSelect(plan: SellerPlanDefinition) {
    haptic();
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
    if (!isOnboarding && plan.id === currentPlanId && currentPlanStatus !== 'none') return;

    setLoadingId(plan.id);

    try {
      if (Platform.OS !== 'web') {
        const packageToPurchase = packages.find((pkg) => pkg.identifier === SELLER_PACKAGE_IDS[plan.id]);
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
          Alert.alert('Plan updated', `You're now on the ${capitalize(status.plan ?? plan.id)} plan.`);
        }
        return;
      }
      const { url } = await api.seller.subscription.checkout(plan.id);
      checkoutOpenedRef.current = true;
      await Linking.openURL(url);
      // setLoadingId stays set until AppState fires on return
    } catch (e: any) {
      setLoadingId(null);
      if (parseRoleError(e)) {
        Alert.alert('Only the store owner can do this');
        return;
      }
      Alert.alert(
        'Could not start checkout',
        e?.message ?? 'Please check your connection and try again.',
        [{ text: 'OK' }],
      );
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
      Alert.alert('Purchases restored', 'Your subscription status has been refreshed.');
    } catch (e: any) {
      Alert.alert('Could not restore purchases', e?.message ?? 'Please try again.');
    } finally {
      setLoadingId(null);
    }
  }

  /** The real exit — leaves the paywall. Reached only after the exit drawer
   *  (and, if enabled, the one-time offer) has been shown and dismissed. */
  async function performExit() {
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
    haptic();
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
        <Text style={styles.awaitTitle}>Confirming your trial…</Text>
        <Text style={styles.awaitSub}>Confirming your plan — this takes a moment.</Text>
      </View>
    );
  }

  function getPricing(plan: SellerPlanDefinition): PlanPricing {
    const revenueCatPackage = packages.find((pkg) => pkg.identifier === SELLER_PACKAGE_IDS[plan.id]);
    const webPrice = displayPriceFor(plan);
    const priceLabel = Platform.OS === 'web'
      ? webPrice.price
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
  const selectedCtaDisabled = loadingId !== null
    || (!isOnboarding && selectedPlan.id === currentPlanId && currentPlanStatus !== 'none')
    || selectedPricing.failed;
  const isCurrentSelected = !isOnboarding && selectedPlan.id === currentPlanId && currentPlanStatus !== 'none';

  // ── Layout ────────────────────────────────────────────────────────────────
  const bottomPad = insets.bottom;

  return (
    <View style={styles.root}>

      <ScreenHeader
        title={isOnboarding ? 'Choose your plan' : 'Subscription plans'}
        variant="push"
        onBack={() => { haptic(); goBackOr(router, isOnboarding ? '/onboarding' : '/(tabs)'); }}
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
          eyebrow="BRANDTHREAD FOR SELLERS"
          title="Everything to build, run, and grow your brand"
          subtitle="One home for your storefront, production, and sales — start free."
        />

        <SellerPaywallBullets theme={theme} bullets={BENEFIT_BULLETS} />

        <SellerPaywallSocialProof theme={theme} text="Trusted by independent brands building on Brandthread" />

        <SellerPlanSelector
          theme={theme}
          plans={SELLER_PLANS}
          recommendedId={recommendedId}
          currentPlanId={currentPlanId}
          isOnboarding={isOnboarding}
          selectedId={selectedId}
          onSelect={setSelectedId}
          getPricing={getPricing}
        />

        <SellerPaywallCTA
          theme={theme}
          label={
            loadingId === selectedPlan.id
              ? 'Starting trial…'
              : isCurrentSelected
                ? 'Current plan'
                : hasRealTrialOffer
                  ? 'Start my 5-day free trial'
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
              ? `Free for 5 days, then ${selectedPricing.priceLabel ?? selectedPlan.priceLabel}/month`
              : null
          }
        />

        {hasRealTrialOffer && <SellerTrialTimeline theme={theme} steps={TRIAL_STEPS} />}

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
          >
            <Text style={styles.skipText}>Not now</Text>
            <Feather name="arrow-right" size={14} color={theme.muted} />
          </TouchableOpacity>
        )}
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            style={styles.restoreRow}
            onPress={handleRestore}
            disabled={loadingId !== null}
            testID="seller-revenuecat-restore"
          >
            {loadingId === 'restore' ? <ActivityIndicator color={theme.muted} size="small" /> : <Text style={styles.skipText}>Restore purchases</Text>}
          </TouchableOpacity>
        )}

        {/* Apple guideline 3.1.2 — auto-renew disclosure + Terms/Privacy links */}
        <View style={styles.legalFooter}>
          <Text style={styles.legalFooterText}>
            Subscriptions renew automatically at the price shown unless you cancel at least 24 hours before the period ends. Manage or cancel in your App Store account settings.
          </Text>
          <View style={styles.legalLinksRow}>
            <Text
              style={styles.legalLink}
              onPress={() => { haptic(); router.push('/terms' as never); }}
            >
              Terms of Use
            </Text>
            <Text style={styles.legalLinkDivider}>·</Text>
            <Text
              style={styles.legalLink}
              onPress={() => { haptic(); router.push('/privacy' as never); }}
            >
              Privacy Policy
            </Text>
          </View>
        </View>

      </ScrollView>

      <SellerPaywallExitDrawer
        visible={exitDrawerVisible}
        onClose={handleExitDrawerClose}
        theme={theme}
        plans={SELLER_PLANS}
        recommendedId={recommendedId}
        currentPlanId={currentPlanId}
        isOnboarding={isOnboarding}
        selectedId={selectedId}
        onSelect={setSelectedId}
        getPricing={getPricing}
        selectedPlan={selectedPlan}
        hasRealTrialOffer={hasRealTrialOffer}
        onStartTrial={handleExitDrawerStartTrial}
        loading={loadingId === selectedPlan.id}
        ctaDisabled={selectedCtaDisabled}
      />
    </View>
  );
}

// ─── Phone-framed dashboard preview ────────────────────────────────────────
// A static, lightweight illustration of the seller dashboard "in action" —
// no image asset required, matches the monochrome design system.
function DashboardPreview({ theme, styles }: { theme: ReturnType<typeof useAppTheme>['theme']; styles: ReturnType<typeof createStyles> }) {
  const bars = [0.4, 0.65, 0.5, 0.85, 0.7, 1, 0.55];
  return (
    <View style={styles.phoneFrame} testID="seller-plans-dashboard-preview">
      <View style={styles.phoneNotch} />
      <View style={styles.phoneScreen}>
        <View style={styles.phoneStatRow}>
          <View style={styles.phoneStatCard}>
            <Text style={styles.phoneStatLabel}>Revenue</Text>
            <Text style={styles.phoneStatValue}>$4,210</Text>
          </View>
          <View style={styles.phoneStatCard}>
            <Text style={styles.phoneStatLabel}>Orders</Text>
            <Text style={styles.phoneStatValue}>86</Text>
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
  root: { flex: 1, backgroundColor: theme.background ?? '#0A0A0B' },

  // Phone-framed dashboard preview
  phoneFrame: {
    alignSelf: 'center',
    width: 220,
    borderRadius: 28,
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
    borderRadius: 20,
    backgroundColor: theme.cardElevated,
    padding: 12,
    gap: 8,
  },
  phoneStatRow: { flexDirection: 'row', gap: 8 },
  phoneStatCard: { flex: 1, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, padding: 8, gap: 2 },
  phoneStatLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
  phoneStatValue: { fontSize: 13, fontFamily: FONT.semibold, color: theme.text },
  phoneChart: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 4,
    height: 44, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, padding: 6,
  },
  phoneChartBar: { flex: 1, backgroundColor: theme.accent, borderRadius: 2, opacity: 0.85 },
  phoneRow: { height: 8, borderRadius: 4, backgroundColor: theme.border, width: '100%' },

  commissionNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center' },

  // Skip
  skipRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: SP.lg, marginTop: 4,
  },
  skipText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  restoreRow: { alignItems: 'center', paddingVertical: SP.sm },

  // Legal footer (Apple 3.1.2 — auto-renew disclosure + Terms/Privacy)
  legalFooter: { paddingTop: SP.sm, paddingHorizontal: SP.xs, gap: 10 },
  legalFooterText: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, lineHeight: 16, textAlign: 'center' },
  legalLinksRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  legalLink: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.text, textDecorationLine: 'underline' },
  legalLinkDivider: { fontSize: FS.xs, color: theme.muted },

  // Awaiting Stripe overlay
  awaitRoot: { flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 40 },
  awaitTitle: { fontSize: FS.xl, fontFamily: FONT.semibold, color: theme.text, textAlign: 'center' },
  awaitSub:   { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center' },
  });
};
