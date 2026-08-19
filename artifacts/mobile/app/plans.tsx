/**
 * Seller plan selection — shown during onboarding and accessible from seller settings.
 *
 * Tiers:
 *   Starter  $29/mo  — storefront, AI store builder, 25 products, basic analytics
 *   Growth   $79/mo  — unlimited products, AI Design Studio, manufacturer hub, live shopping
 *   Scale   $199/mo  — everything in Growth + unlimited team, advanced analytics, white-glove
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
import {
  BG, CARD, BORDER, FG, MUTED, MUTED2, PURPLE, CYAN, SUCCESS, ORANGE,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';

// ─── Local palette constants ──────────────────────────────────────────────────
// (plans.tsx predates the theme migration; keep these local so the screen is
//  self-contained and doesn't depend on the retired useColors hook)
const CARD_ELEVATED = '#12121F';
const BORDER_ACTIVE = PURPLE;

// ─── Plan catalogue ───────────────────────────────────────────────────────────

interface PlanDef {
  id:         'starter' | 'growth' | 'scale';
  name:       string;
  tagline:    string;
  priceCents: number;
  priceLabel: string;
  highlight?: boolean;  // visually featured card
  features:   string[];
  notIncluded: string[];
}

const PLANS: PlanDef[] = [
  {
    id:          'starter',
    name:        'Starter',
    tagline:     'Launch your brand',
    priceCents:  2900,
    priceLabel:  '$29',
    features: [
      'Storefront + AI Store Builder',
      'Up to 25 products',
      'Standard checkout',
      'Basic analytics',
      'Community & freelancer marketplace',
      'In-app AI chatbot support',
    ],
    notIncluded: [
      'AI Design Studio',
      'Manufacturer Hub & drops',
      'Live shopping',
      'Team seats',
    ],
  },
  {
    id:          'growth',
    name:        'Growth',
    tagline:     'Scale your catalog',
    priceCents:  7900,
    priceLabel:  '$79',
    highlight:   true,
    features: [
      'Everything in Starter',
      'Unlimited products',
      'Full AI Design Studio (mockups, tech packs, photography)',
      'Manufacturer Hub + drop escrow system',
      'Live shopping',
      'Up to 3 team seats',
      'Boost & promotion credits',
      'Priority order support',
    ],
    notIncluded: [
      'Advanced analytics (top customers, conversions)',
      'Priority manufacturer intros',
      'White-glove support',
    ],
  },
  {
    id:          'scale',
    name:        'Scale',
    tagline:     'Enterprise-grade operations',
    priceCents:  19900,
    priceLabel:  '$199',
    features: [
      'Everything in Growth',
      'Unlimited team seats',
      'Advanced analytics (top customers, conversion breakdowns)',
      'Priority manufacturer intros',
      'White-glove support',
      'Early access to new features',
    ],
    notIncluded: [],
  },
];

// Map brand stage answers from onboarding to a recommended plan
const STAGE_TO_PLAN: Record<string, PlanDef['id']> = {
  'Just starting out':        'starter',
  'Building my product line': 'growth',
  'Scaling an existing brand':'scale',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PlansScreen() {
  const insets    = useSafeAreaInsets();
  const router    = useRouter();
  const api       = useApi();
  const { fromOnboarding } = useLocalSearchParams<{ fromOnboarding?: string }>();
  const isOnboarding = fromOnboarding === 'true';

  const [loadingId,       setLoadingId]       = useState<string | null>(null);
  const [awaitingReturn,  setAwaitingReturn]  = useState(false);
  const [recommendedId,   setRecommendedId]   = useState<PlanDef['id'] | null>(null);
  const [currentPlanId,   setCurrentPlanId]   = useState<string | null>(null);

  // AppState ref to detect return from Stripe Checkout browser tab
  const checkoutOpenedRef = useRef(false);

  // ── On mount: load brand stage recommendation + current plan ──────────────
  useEffect(() => {
    (async () => {
      const stage = await AsyncStorage.getItem('onboarding_brand_stage');
      if (stage && STAGE_TO_PLAN[stage]) {
        setRecommendedId(STAGE_TO_PLAN[stage]);
      }
      // If not onboarding, load live plan so we can show CURRENT badge
      if (!isOnboarding) {
        try {
          const status = await api.seller.subscription.status();
          setCurrentPlanId(status.plan ?? null);
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

  async function handleSelect(plan: PlanDef) {
    haptic();

    // "Skip" path — onboarding only, no Stripe, just go straight to dashboard
    if (plan.id === 'skip' as any) {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      router.replace('/(tabs)/' as never);
      return;
    }

    if (!isOnboarding && plan.id === currentPlanId) return;

    setLoadingId(plan.id);

    try {
      const { url } = await api.seller.subscription.checkout(plan.id);
      checkoutOpenedRef.current = true;
      await Linking.openURL(url);
      // setLoadingId stays set until AppState fires on return
    } catch (e: any) {
      setLoadingId(null);
      Alert.alert(
        'Could not start checkout',
        e?.message ?? 'Please check your connection and try again.',
        [{ text: 'OK' }],
      );
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
        <LinearGradient colors={['#1a0a2e', '#07070F']} style={StyleSheet.absoluteFill} />
        <ActivityIndicator color={PURPLE} size="large" />
        <Text style={styles.awaitTitle}>Confirming your trial…</Text>
        <Text style={styles.awaitSub}>Syncing with Stripe — this takes a moment.</Text>
      </View>
    );
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  const topPad    = Platform.OS === 'web' ? 24 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom;

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
            <Feather name="x" size={18} color={FG} />
          </TouchableOpacity>
        )}
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {isOnboarding ? 'Choose your plan' : 'Subscription plans'}
          </Text>
          <Text style={styles.headerSub}>
            5-day free trial · cancel anytime
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 48, gap: 14 }}
      >

        {/* Recommendation banner */}
        {recommendedId && (
          <View style={styles.recBanner}>
            <Feather name="star" size={13} color={CYAN} />
            <Text style={styles.recBannerText}>
              Based on your brand stage, we recommend{' '}
              <Text style={{ color: CYAN, fontFamily: FONT.semibold }}>
                {PLANS.find(p => p.id === recommendedId)?.name}
              </Text>
            </Text>
          </View>
        )}

        {/* Commission note */}
        <View style={styles.commissionNote}>
          <Feather name="info" size={13} color={MUTED} />
          <Text style={styles.commissionText}>
            All plans are subject to a{' '}
            <Text style={{ color: FG, fontFamily: FONT.medium }}>5% platform commission</Text>
            {' '}on each sale.
          </Text>
        </View>

        {/* Trial callout */}
        <View style={styles.trialCallout}>
          <LinearGradient
            colors={[`${PURPLE}33`, `${CYAN}22`]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.trialCalloutInner}
          >
            <Feather name="shield" size={16} color={PURPLE} />
            <View style={{ flex: 1 }}>
              <Text style={styles.trialCalloutTitle}>5-day free trial on every plan</Text>
              <Text style={styles.trialCalloutSub}>
                Enter your card now — you won't be charged until day 6. Cancel before then for free.
              </Text>
            </View>
          </LinearGradient>
        </View>

        {/* Plan cards */}
        {PLANS.map((plan) => {
          const isRecommended = plan.id === recommendedId;
          const isCurrent     = !isOnboarding && plan.id === currentPlanId;
          const isLoading     = loadingId === plan.id;

          return (
            <View
              key={plan.id}
              style={[
                styles.card,
                plan.highlight && styles.cardHighlight,
                isCurrent      && styles.cardCurrent,
              ]}
            >
              {/* Badges row */}
              <View style={styles.badgeRow}>
                {isRecommended && (
                  <View style={styles.recBadge}>
                    <Feather name="star" size={10} color={CYAN} />
                    <Text style={styles.recBadgeText}>RECOMMENDED FOR YOU</Text>
                  </View>
                )}
                {plan.highlight && !isRecommended && (
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
                  <Text style={[styles.planName, plan.highlight && { color: PURPLE }]}>
                    {plan.name}
                  </Text>
                  <Text style={styles.planTagline}>{plan.tagline}</Text>
                </View>
                <View style={styles.priceCol}>
                  <Text style={[styles.priceLabel, plan.highlight && { color: PURPLE }]}>
                    {plan.priceLabel}
                  </Text>
                  <Text style={styles.pricePeriod}>/mo</Text>
                </View>
              </View>

              {/* Included features */}
              <View style={styles.featureList}>
                {plan.features.map((f) => (
                  <View key={f} style={styles.featureRow}>
                    <Feather name="check" size={13} color={plan.highlight ? PURPLE : SUCCESS} style={{ marginTop: 2 }} />
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}
                {plan.notIncluded.map((f) => (
                  <View key={f} style={styles.featureRow}>
                    <Feather name="minus" size={13} color={MUTED2} style={{ marginTop: 2 }} />
                    <Text style={[styles.featureText, { color: MUTED2 }]}>{f}</Text>
                  </View>
                ))}
              </View>

              {/* CTA */}
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={isCurrent || loadingId !== null}
                onPress={() => handleSelect(plan)}
                style={[
                  styles.ctaBtn,
                  plan.highlight    ? styles.ctaBtnHighlight : styles.ctaBtnDefault,
                  isCurrent         && styles.ctaBtnCurrent,
                  (isCurrent || loadingId !== null) && { opacity: 0.5 },
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={[styles.ctaText, isCurrent && { color: PURPLE }]}>
                    {isCurrent
                      ? 'Current plan'
                      : isOnboarding
                        ? 'Start free trial'
                        : `Switch to ${plan.name}`}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Skip during onboarding */}
        {isOnboarding && (
          <TouchableOpacity
            style={styles.skipRow}
            onPress={handleSkip}
            disabled={loadingId !== null}
            activeOpacity={0.7}
          >
            <Text style={styles.skipText}>Skip for now — start with Starter</Text>
            <Feather name="arrow-right" size={14} color={MUTED2} />
          </TouchableOpacity>
        )}

      </ScrollView>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function capitalize(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  closeBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  headerCenter:{ flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: FS.lg, fontFamily: FONT.semibold, color: FG },
  headerSub:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  // Recommendation banner
  recBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${CYAN}14`, borderRadius: RADIUS.md,
    paddingHorizontal: SP.md, paddingVertical: 10,
    borderWidth: 1, borderColor: `${CYAN}30`,
  },
  recBannerText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },

  // Commission + trial callouts
  commissionNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: SP.md, paddingVertical: 10,
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER,
  },
  commissionText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },
  trialCallout:   { borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: `${PURPLE}44` },
  trialCalloutInner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: SP.md },
  trialCalloutTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 4 },
  trialCalloutSub:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },

  // Cards
  card: {
    backgroundColor: CARD,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.lg,
    gap: SP.md,
  },
  cardHighlight: { backgroundColor: CARD_ELEVATED, borderColor: BORDER_ACTIVE },
  cardCurrent:   { borderColor: SUCCESS },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  recBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: `${CYAN}22`, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  recBadgeText:     { fontSize: 9, fontFamily: FONT.semibold, color: CYAN, letterSpacing: 0.5 },
  popularBadge:     { backgroundColor: `${PURPLE}33`, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  popularBadgeText: { fontSize: 9, fontFamily: FONT.semibold, color: PURPLE, letterSpacing: 0.5 },
  currentBadge:     { backgroundColor: `${SUCCESS}22`, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  currentBadgeText: { fontSize: 9, fontFamily: FONT.semibold, color: SUCCESS, letterSpacing: 0.5 },

  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  planName:    { fontSize: FS.xl, fontFamily: FONT.semibold, color: FG },
  planTagline: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  priceCol:    { alignItems: 'flex-end' },
  priceLabel:  { fontSize: 28, fontFamily: FONT.semibold, color: FG, letterSpacing: -0.5 },
  pricePeriod: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  featureList: { gap: 8 },
  featureRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 18 },

  // CTAs
  ctaBtn: {
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnDefault:   { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  ctaBtnHighlight: { backgroundColor: PURPLE },
  ctaBtnCurrent:   { backgroundColor: 'transparent', borderWidth: 1, borderColor: SUCCESS },
  ctaText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },

  // Skip
  skipRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: SP.lg, marginTop: 4,
  },
  skipText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED2 },

  // Awaiting Stripe overlay
  awaitRoot: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 40 },
  awaitTitle: { fontSize: FS.xl, fontFamily: FONT.semibold, color: FG, textAlign: 'center' },
  awaitSub:   { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center' },
});
