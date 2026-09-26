/**
 * Seller plan selection — shown during onboarding and accessible from seller settings.
 *
 * Tiers:
 *   Starter  $29/mo  — storefront, AI store builder, 25 products, basic analytics
 *   Growth   $79/mo  — unlimited products, AI Design Studio, manufacturer hub, live shopping
 *   Pro     $199/mo  — everything in Growth + unlimited team, advanced analytics, white-glove
 *
 * All tiers carry a 5% platform commission on sales.
 * Every new subscription starts with a 5-day free trial (card required upfront).
 *
 * The recommended tier is personalized based on the seller's brand-stage answer from onboarding.
 */
import React, { useState, useEffect, useRef } from 'react';
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
import {
  comparisonRows,
  displayPriceFor,
  planIncludesFeature,
  PLAN_FAQ,
} from '@/lib/sellerPlansDisplay';

// ─── Local palette constants ──────────────────────────────────────────────────
// (plans.tsx predates the theme migration; keep these local so the screen is
//  self-contained and doesn't depend on the retired useColors hook)

// ─── Plan catalogue ───────────────────────────────────────────────────────────

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PlansScreen() {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const insets    = useSafeAreaInsets();
  const router    = useRouter();
  const api       = useApi();
  const { fromOnboarding } = useLocalSearchParams<{ fromOnboarding?: string }>();
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
  const [openFaqIndex,      setOpenFaqIndex]      = useState<number | null>(null);

  // Native pricing comes from RevenueCat asynchronously. If packages never
  // arrive, treat it as a real failure rather than leaving the CTA active
  // against a null price forever.
  useEffect(() => {
    if (Platform.OS === 'web' || packages.length > 0) return;
    const timer = setTimeout(() => setPricesTimedOut(true), 6000);
    return () => clearTimeout(timer);
  }, [packages.length]);

  const pricesLoading = Platform.OS !== 'web' && packages.length === 0 && revenueCatAvailable && !pricesTimedOut;
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
      setRecommendedId((selected[1] as SellerPlanDefinition['id'] | null) ?? recommendSellerPlan(stage[1] ?? '', goals).planId);
      // If not onboarding, load live plan so we can show CURRENT badge
      if (!isOnboarding) {
        try {
          const status = await api.seller.subscription.status();
          setCurrentPlanId(status.plan ?? null);
          setCurrentPlanStatus(status.status ?? null);
        } catch { /* non-fatal */ }
      }
    })();
  }, [isOnboarding, api]);

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

  async function handleSkip() {
    haptic();
    if (isOnboarding) {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      router.replace('/(tabs)/' as never);
    } else {
      router.back();
    }
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

  // ── Layout ────────────────────────────────────────────────────────────────
  const topPad    = insets.top;
  const bottomPad = insets.bottom;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>

      {/* Header */}
      <View style={styles.header}>
        {isOnboarding ? (
          <View style={{ width: 40 }} />
        ) : (
          <TouchableOpacity
            style={styles.closeBtn}
            activeOpacity={0.7}
            onPress={() => { haptic(); router.back(); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="x" size={18} color={theme.text} />
          </TouchableOpacity>
        )}
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {isOnboarding ? 'Choose your plan' : 'Subscription plans'}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 48, gap: 14 }}
      >

        {/* Hero */}
        <View style={styles.hero}>
          <LinearGradient
            colors={theme.heroGradient as any}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.heroInner}
          >
            <Text style={styles.heroEyebrow} allowFontScaling={false}>BRANDTHREAD FOR SELLERS</Text>
            <Text style={styles.heroTitle} allowFontScaling={false}>
              Everything to build, run, and grow your brand
            </Text>
            <Text style={styles.heroSub}>
              {hasRealTrialOffer ? '5-day free trial on every plan · cancel anytime' : 'Pick the plan that fits your brand'}
            </Text>
          </LinearGradient>
        </View>

        {/* Recommendation banner */}
        {recommendedId && (
          <View style={styles.recBanner}>
            <Feather name="star" size={13} color={theme.secondary} />
            <Text style={styles.recBannerText}>
              Based on your brand stage, we recommend{' '}
              <Text style={{ color: theme.secondary, fontFamily: FONT.semibold }}>
                 {SELLER_PLANS.find(p => p.id === recommendedId)?.name}
              </Text>
            </Text>
          </View>
        )}

        {/* Commission note */}
        <View style={styles.commissionNote}>
            <Feather name="info" size={13} color={theme.muted} />
          <Text style={styles.commissionText}>
            All plans are subject to a{' '}
             <Text style={{ color: theme.text, fontFamily: FONT.medium }}>5% platform commission</Text>
            {' '}on each sale.
          </Text>
        </View>

        {/* Trial callout — only claim a trial when the store actually has one to offer */}
        {hasRealTrialOffer && (
          <View style={styles.trialCallout}>
            <LinearGradient
              colors={theme.glowGradient as any}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.trialCalloutInner}
            >
                   <Feather name="shield" size={16} color={theme.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.trialCalloutTitle}>5-day free trial on every plan</Text>
                <Text style={styles.trialCalloutSub}>
                  {Platform.OS === 'web'
                    ? "Enter your card now — you won't be charged until day 6. Cancel before then for free."
                    : "You won't be charged until your trial ends. Cancel anytime in your App Store settings."}
                </Text>
              </View>
            </LinearGradient>
          </View>
        )}

        {/* Plan cards */}
        {SELLER_PLANS.map((plan) => {
          const isRecommended = plan.id === recommendedId;
          const isCurrent     = !isOnboarding && plan.id === currentPlanId;
          const isLoading     = loadingId === plan.id;
          const revenueCatPackage = packages.find((pkg) => pkg.identifier === SELLER_PACKAGE_IDS[plan.id]);
          // Web shows our own literal monthly price string; native purchases
          // always use RevenueCat's real priceString for the same monthly
          // product. No yearly option exists, so there's nothing to toggle.
          const webPrice = displayPriceFor(plan);
          const priceLabel = Platform.OS === 'web'
            ? webPrice.price
            : revenueCatPackage?.product.priceString ?? null;
          const trial = revenueCatPackage?.product.introPrice;
          const cardPriceLoading = Platform.OS !== 'web' && !priceLabel && !pricesFailed;
          const cardPriceFailed  = Platform.OS !== 'web' && !priceLabel && pricesFailed;

          return (
            <View
              key={plan.id}
              style={[
                styles.card,
                 plan.id === 'growth' && styles.cardHighlight,
                isCurrent      && styles.cardCurrent,
              ]}
            >
              {/* Badges row */}
              <View style={styles.badgeRow}>
                {isRecommended && (
                  <View style={styles.recBadge}>
                    <Feather name="star" size={10} color={theme.secondary} />
                    <Text style={styles.recBadgeText}>RECOMMENDED FOR YOU</Text>
                  </View>
                )}
                {plan.id === 'growth' && !isRecommended && (
                  <View style={styles.popularBadge}>
                    <Text style={styles.popularBadgeText}>MOST POPULAR</Text>
                  </View>
                )}
                {isCurrent && (
                  <View style={styles.currentBadge}>
                    <Text style={styles.currentBadgeText}>CURRENT PLAN</Text>
                  </View>
                )}
              </View>

              {/* Name + price */}
              <View style={styles.cardTopRow}>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.planName, plan.id === 'growth' && { color: theme.accent }]}>
                    {plan.name}
                  </Text>
                  <Text style={styles.planTagline}>{plan.tagline}</Text>
                </View>
                <View style={styles.priceCol}>
                  {cardPriceLoading ? (
                    <View style={styles.priceSkeleton} />
                  ) : (
                    <Text style={[styles.priceLabel, plan.id === 'growth' && { color: theme.accent }]}>
                       {cardPriceFailed ? '—' : priceLabel}
                    </Text>
                  )}
                   <Text style={styles.pricePeriod}>
                     {Platform.OS === 'web' ? webPrice.period : 'per month'}
                   </Text>
                </View>
              </View>
               {Platform.OS !== 'web' && trial && priceLabel && (() => {
                 const isFree = /^\$?0(\.00?)?$/.test(trial.priceString.trim());
                 const unitLabel = `${trial.periodNumberOfUnits} ${trial.periodUnit.toLowerCase()}${trial.periodNumberOfUnits === 1 ? '' : 's'}`;
                 return (
                   <Text style={styles.nativeTrial}>
                     {isFree
                       ? `Free for ${unitLabel}, then ${priceLabel}/month`
                       : `${trial.priceString} for ${unitLabel}, then ${priceLabel}/month`}
                   </Text>
                 );
               })()}
               {cardPriceFailed && (
                 <Text style={styles.nativeTrial}>Prices unavailable. Pull to retry.</Text>
               )}

              {/* Included features */}
              <View style={styles.featureList}>
                {plan.features.map((f) => (
                  <View key={f} style={styles.featureRow}>
                     <Feather name="check" size={13} color={plan.id === 'growth' ? theme.accent : theme.success} style={{ marginTop: 2 }} />
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}
                {plan.notIncluded.map((f) => (
                  <View key={f} style={styles.featureRow}>
                     <Feather name="minus" size={13} color={theme.muted} style={{ marginTop: 2 }} />
                     <Text style={[styles.featureText, { color: theme.muted }]}>{f}</Text>
                  </View>
                ))}
              </View>

              {/* CTA */}
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={isCurrent || loadingId !== null || cardPriceFailed || cardPriceLoading}
                onPress={() => handleSelect(plan)}
                style={[
                  styles.ctaBtn,
                   plan.id === 'growth' ? styles.ctaBtnHighlight : styles.ctaBtnDefault,
                  isCurrent         && styles.ctaBtnCurrent,
                  (isCurrent || loadingId !== null || cardPriceFailed || cardPriceLoading) && { opacity: 0.5 },
                ]}
              >
                {isLoading ? (
                   <ActivityIndicator color={theme.onAccent} size="small" />
                ) : (
                  <Text style={[styles.ctaText, isCurrent && { color: theme.accent }]}>
                    {isCurrent
                      ? 'Current plan'
                      : cardPriceFailed
                        ? 'Prices unavailable'
                        : isOnboarding
                          ? (hasRealTrialOffer ? 'Start free trial' : `Choose ${plan.name}`)
                          : `Switch to ${plan.name}`}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Full comparison table */}
        <View style={styles.compareSection} testID="seller-plans-comparison-table">
          <Text style={styles.compareTitle}>Compare every plan</Text>
          <View style={styles.compareHeaderRow}>
            <View style={{ flex: 1.4 }} />
            {SELLER_PLANS.map((plan) => (
              <Text key={plan.id} style={styles.compareHeaderCell} numberOfLines={1}>{plan.name}</Text>
            ))}
          </View>
          {comparisonRows().map((feature, index) => (
            <View
              key={feature}
              style={[styles.compareRow, index % 2 === 1 && styles.compareRowAlt]}
            >
              <Text style={styles.compareFeatureCell} numberOfLines={2}>{feature}</Text>
              {SELLER_PLANS.map((plan) => (
                <View key={plan.id} style={styles.compareValueCell}>
                  {planIncludesFeature(plan, feature) ? (
                    <Feather name="check" size={15} color={theme.success} />
                  ) : (
                    <Feather name="minus" size={15} color={theme.muted} />
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>

        {/* FAQ */}
        <View style={styles.faqSection} testID="seller-plans-faq">
          <Text style={styles.compareTitle}>Frequently asked questions</Text>
          {PLAN_FAQ.map((item, index) => {
            const isOpen = openFaqIndex === index;
            return (
              <View key={item.question} style={styles.faqItem}>
                <TouchableOpacity
                  style={styles.faqQuestionRow}
                  onPress={() => { haptic(); setOpenFaqIndex(isOpen ? null : index); }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  testID={`seller-plans-faq-${index}`}
                >
                  <Text style={styles.faqQuestion}>{item.question}</Text>
                  <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={theme.muted} />
                </TouchableOpacity>
                {isOpen && <Text style={styles.faqAnswer}>{item.answer}</Text>}
              </View>
            );
          })}
        </View>

        {/* Skip during onboarding — Starter is a paid plan, so this must not read as "free" */}
        {isOnboarding && (
          <TouchableOpacity
            style={styles.skipRow}
            onPress={handleSkip}
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
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function capitalize(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  closeBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  headerCenter:{ flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: FS.lg, fontFamily: FONT.semibold, color: theme.text },
  headerSub:   { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },

  // Hero
  hero: { borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: theme.border },
  heroInner: { padding: SP.lg, gap: 6 },
  heroEyebrow: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.accent, letterSpacing: 1.5 },
  heroTitle: { fontSize: 24, fontFamily: FONT.semibold, color: theme.text, letterSpacing: -0.3, lineHeight: 30 },
  heroSub: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },

  // Recommendation banner
  recBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${theme.secondary}14`, borderRadius: RADIUS.md,
    paddingHorizontal: SP.md, paddingVertical: 10,
    borderWidth: 1, borderColor: `${theme.secondary}30`,
  },
  recBannerText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, lineHeight: 18 },

  // Commission + trial callouts
  commissionNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: SP.md, paddingVertical: 10,
    backgroundColor: theme.card, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: theme.border,
  },
  commissionText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, lineHeight: 18 },
  trialCallout:   { borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: `${theme.accent}44` },
  trialCalloutInner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: SP.md },
  trialCalloutTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, marginBottom: 4 },
  trialCalloutSub:   { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, lineHeight: 18 },

  // Cards
  card: {
    backgroundColor: theme.card,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: theme.border,
    padding: SP.lg,
    gap: SP.md,
  },
  cardHighlight: {
    backgroundColor: theme.cardElevated,
    borderColor: theme.accent,
    borderWidth: 2,
    shadowColor: theme.shadowColor,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 7,
    transform: [{ scale: 1.015 }],
  },
  cardCurrent:   { borderColor: theme.success },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  recBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: `${theme.secondary}22`, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
   recBadgeText:     { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.secondary, letterSpacing: 0.5 },
  popularBadge:     { backgroundColor: `${theme.accent}33`, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
   popularBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.accent, letterSpacing: 0.5 },
  currentBadge:     { backgroundColor: `${theme.success}22`, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
   currentBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.success, letterSpacing: 0.5 },

  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  planName:    { fontSize: FS.xl, fontFamily: FONT.semibold, color: theme.text },
  planTagline: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  priceCol:    { alignItems: 'flex-end' },
  priceLabel:  { fontSize: 28, fontFamily: FONT.semibold, color: theme.text, letterSpacing: -0.5 },
  pricePeriod: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },

  featureList: { gap: 8 },
  featureRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text, lineHeight: 18 },

  // CTAs
  ctaBtn: {
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnDefault:   { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
  ctaBtnHighlight: { backgroundColor: theme.accent },
  ctaBtnCurrent:   { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.success },
  ctaText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.onAccent },

  // Skip
  skipRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: SP.lg, marginTop: 4,
  },
  skipText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
   restoreRow: { alignItems: 'center', paddingVertical: SP.sm },
   nativeTrial: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.secondary, marginTop: -SP.xs },
   priceSkeleton: { width: 64, height: 28, borderRadius: RADIUS.xs, backgroundColor: theme.border },

  // Legal footer (Apple 3.1.2 — auto-renew disclosure + Terms/Privacy)
  // Comparison table
  compareSection: {
    backgroundColor: theme.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.border,
    padding: SP.md, gap: 4,
  },
  compareTitle: { fontSize: FS.lg, fontFamily: FONT.semibold, color: theme.text, marginBottom: SP.sm },
  compareHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: SP.sm, borderBottomWidth: 1, borderBottomColor: theme.border },
  compareHeaderCell: { flex: 1, fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text, textAlign: 'center' },
  compareRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.sm },
  compareRowAlt: { backgroundColor: `${theme.border}30` },
  compareFeatureCell: { flex: 1.4, fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, paddingRight: 6 },
  compareValueCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // FAQ
  faqSection: {
    backgroundColor: theme.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.border,
    padding: SP.md, gap: 4,
  },
  faqItem: { borderTopWidth: 1, borderTopColor: theme.border, paddingVertical: SP.sm },
  faqQuestionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  faqQuestion: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  faqAnswer: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, lineHeight: 18, marginTop: SP.xs },

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
