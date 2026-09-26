/**
 * Brandthread Onboarding — complete buyer + seller flows
 *
 * STEP ORDER (v7) — see lib/onboardingFlow.ts for the single source of truth:
 * BOTH:   0=Welcome (cinematic opener)  1=AccountType  2=Auth  3=Name
 * BUYER:  4=Style  5=Brands (follow)  6=Loading  7=Notifications  8=Success
 * SELLER: 4=BrandName  5=BrandStage  6=Goals  7=Plan  8=Loading  9=Notifications  10=Success
 *
 * Step ordering, skip rules and draft-version migration now live in
 * lib/onboardingFlow.ts (a plain, RN-free module) so they're independently
 * unit-testable and are not duplicated as hand-maintained index objects here.
 */
import { LegalConsent } from '@/components/legal/LegalConsent';
import { rememberPendingConsent } from '@/lib/legalConsent';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { useAuth, useSSO, useSignUp, useUser } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { ONBOARDING_KEY, ONBOARDING_OWNER_KEY } from './_layout';
import { AccountTypeStep, type AccountType } from './account-type';

// Required on Android so the in-app browser tab closes after OAuth redirect
WebBrowser.maybeCompleteAuthSession();
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import {
  APP_THEME_PRESETS,
  DEFAULT_THEME,
  getOnAccentTextStyle,
  useAppTheme,
  type AppThemeId,
} from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { hydrateMyProfileFromAccount, socialKeysForUser } from '@/services/socialService';
import { DEFAULT_BUYER_PROFILE, saveBuyerProfileForUser } from '@/lib/buyerProfile';
import { SellerPlanRecommendationStep } from '@/components/onboarding/SellerPlanRecommendationStep';
import { recommendSellerPlan } from '@/lib/sellerPlans';
import type { SellerPlanId } from '@/lib/sellerBilling';
import { registerGrantedPushToken } from '@/lib/contextualPushPermission';
import {
  queueBuyerOnboardingSync,
  isRecoverableBuyerOnboardingSyncError,
  syncBuyerOnboarding,
} from '@/lib/buyerOnboardingSync';
import { ApiError } from '@/lib/networkNotice';
import {
  APPLE_OAUTH_STRATEGY,
  isOAuthCancellationError,
  isOAuthFlowComplete,
  makeBrandthreadRedirectUri,
  mapOAuthError,
} from '@/lib/oauthFlow';
import {
  BUYER_STEP_INDEX,
  SELLER_STEP_INDEX,
  DRAFT_VERSION,
  restoreDraftStep,
  isStepSkippable,
  canGoBack,
  totalStepsFor,
  type Flow,
} from '@/lib/onboardingFlow';
import { BrandsToFollowStep } from '@/components/onboarding/BrandsToFollowStep';
import { WelcomeStep } from '@/components/onboarding/WelcomeStep';
import { Glow, ThreadDraw, ThreadLogoStitch, ThreadProgress, ThreadWeave } from '@/components/onboarding/ThreadLine';
import {
  CodeCells,
  FloatingInput,
  PillButton,
  PressableScale,
  Reveal,
  RevealToggle,
  StepHeadline,
  StepSub,
  StitchAccent,
} from '@/components/onboarding/OnboardingUI';
import { MOTION, RADIUS, SPACE, TYPE } from '@/components/onboarding/onboardingTokens';

// ─── Palette ────────────────────────────────────────────────────────────────
const { width: SW } = Dimensions.get('window');
let sm: any = {};
// Runtime aliases are used only by legacy inline controls; all StyleSheets below
// are factories and receive theme values directly.
let CARD = DEFAULT_THEME.card;
let FG = DEFAULT_THEME.text;
let MUTED = DEFAULT_THEME.muted;
let MUTED2 = DEFAULT_THEME.subtle;
let INPUT_BG = DEFAULT_THEME.surface;
let INPUT_BD = DEFAULT_THEME.border;
let ERR = DEFAULT_THEME.error;
let GREEN = DEFAULT_THEME.success;

// ─── Data ───────────────────────────────────────────────────────────────────
const STYLE_INTERESTS_WITH_EMOJI: { label: string; emoji: string }[] = [
  { label: 'Streetwear',        emoji: '🏙️' },
  { label: 'Luxury',            emoji: '💎' },
  { label: 'Vintage',           emoji: '🕰️' },
  { label: 'Athleisure',        emoji: '🏃' },
  { label: 'Basics',            emoji: '👕' },
  { label: 'Accessories',       emoji: '👜' },
  { label: 'Sneakers',          emoji: '👟' },
  { label: 'Denim',             emoji: '🧥' },
  { label: 'Graphic tees',      emoji: '🎨' },
  { label: 'Minimal',           emoji: '◻️' },
  { label: 'Avant-garde',       emoji: '🌀' },
  { label: 'Sustainable fashion', emoji: '🌿' },
];

// Keep the plain string list for compatibility with existing code that checks
// membership / draft serialization / API calls.
const STYLE_INTERESTS = STYLE_INTERESTS_WITH_EMOJI.map((i) => i.label);

const BRAND_STAGES = [
  { value: 'idea',    label: 'Just an idea',    sub: "I'm starting from zero." },
  { value: 'build',   label: 'Building now',     sub: "I'm designing or sourcing products." },
  { value: 'selling', label: 'Already selling',  sub: 'I have customers and active orders.' },
  { value: 'scale',   label: 'Ready to scale',   sub: 'I need stronger systems and growth.' },
];

const SELLER_GOALS = [
  'Create designs', 'Find manufacturers', 'Launch my store', 'Manage production',
  'Grow sales', 'Build content', 'Manage inventory', 'Ship orders',
  'Understand analytics', 'Manage customers',
];
const DEFAULT_BUYER_INTERESTS = ['Basics', 'Minimal', 'Sustainable fashion'];
const DEFAULT_SELLER_GOALS = ['Create designs', 'Launch my store', 'Build content'];
const LOGO_SAMPLE_STYLES = ['Minimalist', 'Bold', 'Vintage', 'Luxury', 'Streetwear', 'Playful'];

const BUYER_LOADING_STEPS  = ['Learning your style', 'Curating your Thread', 'Finding brands you\'ll love', 'Finishing your profile'];
const SELLER_LOADING_STEPS = ['Mapping your brand workspace', 'Preparing your product pipeline', 'Connecting your growth tools', 'Finishing your dashboard'];

const LEGACY_DRAFT_KEY = 'onboarding_draft';
const DRAFT_KEY_PREFIX = 'onboarding_draft:';
const PENDING_FLOW_KEY = 'onboarding_pending_flow';
const PENDING_USERNAME_KEY = 'onboarding_pending_username';
// Draft version, step index objects and cross-version migration now live in
// lib/onboardingFlow.ts (imported above) — this file only renders steps.

function draftKeyForUser(userId?: string | null): string | null {
  return userId ? `${DRAFT_KEY_PREFIX}${userId}` : null;
}

function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && APP_THEME_PRESETS.some((preset) => preset.id === value);
}

// ─── Clerk error mapper ──────────────────────────────────────────────────────
function mapClerkError(err: any): string {
  if (!err) return 'Something went wrong. Please try again.';

  const inner = err?.errors?.[0] ?? err;
  const code  = (inner?.code ?? '').toLowerCase();
  const msg   = (inner?.message ?? inner?.longMessage ?? err?.message ?? '').toLowerCase();

  if (code === 'form_identifier_exists')
    return 'An account already exists with this email. Sign in instead.';
  if (code === 'session_exists' || code === 'identifier_already_signed_in')
    return 'You are already signed in. Sign out to create another account.';
  if (code === 'form_password_pwned' || code === 'form_password_strength_insufficient')
    return 'This password is too common or weak. Choose a stronger one.';
  if (code === 'form_password_length_too_short')
    return 'Use at least 8 characters.';
  if (code === 'form_param_format_invalid' || code === 'form_param_nil')
    return msg.includes('email') ? 'Enter a valid email address.' : 'One of your entries is not in the right format.';
  if (code === 'form_code_incorrect')
    return 'Invalid code. Please check and try again.';
  if (code === 'verification_expired')
    return 'Code expired. Request a new one.';
  if (code === 'request_rate_limited')
    return 'Too many attempts. Please wait a moment and try again.';
  if (code === 'network_failure' || code === 'request_timeout')
    return "Couldn't connect. Check your internet and try again.";
  if (code === 'missing_publishable_key' || code === 'publishable_key_invalid')
    return 'Authentication configuration error. Please contact support.';
  if (code === 'form_identifier_not_found' || code === 'form_password_incorrect')
    return 'Incorrect email or password.';

  if (msg.includes('that email address is taken') || (msg.includes('email') && msg.includes('already exists') && !msg.includes('session')))
    return 'An account already exists with this email. Sign in instead.';
  if (msg.includes('already signed in') || (msg.includes('session') && msg.includes('exists')))
    return 'You are already signed in. Sign out to create another account.';
  if (msg.includes('password') && (msg.includes('weak') || msg.includes('pwned')))
    return 'Use a stronger password (8+ characters).';
  if ((msg.includes('invalid') || msg.includes('format')) && msg.includes('email'))
    return 'Enter a valid email address.';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout'))
    return "Couldn't connect. Check your internet and try again.";
  if (msg.includes('incorrect') || msg.includes('wrong password') || msg.includes('invalid password'))
    return 'Incorrect email or password.';
  if (msg.includes('rate limit') || msg.includes('too many'))
    return 'Too many attempts. Please wait and try again.';

  return inner?.message || err?.message || 'Something went wrong. Please try again.';
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

/**
 * Progress indicator: the signature thread, sewn node-to-node as the user
 * advances (one stitch node per step). Replaces the old dot row.
 */
function StepDots({ current, total }: { current: number; total: number }) {
  const { theme } = useAppTheme();
  return (
    <ThreadProgress
      current={current}
      total={total}
      color={theme.text}
      trackColor={theme.border}
      accessibilityLabel={`Step ${current + 1} of ${total}`}
      style={{ flex: 1 }}
    />
  );
}

/**
 * Style-interest chip with solid-fill selected state and checkmark.
 * Selected: solid accent-dim background, bright border, checkmark + label.
 */
function StyleChip({ label, emoji, selected, onPress }: { label: string; emoji: string; selected: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  const ssc = createSsc(theme);
  return (
    <PressableScale
      style={[
        ssc.chip,
        selected && { backgroundColor: theme.accentDim, borderColor: theme.text, borderWidth: 1 },
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
    >
      <Text style={ssc.emoji}>{emoji}</Text>
      <Text style={[ssc.chipText, selected && { color: theme.text }]}>{label}</Text>
      {selected && <Feather name="check" size={13} color={theme.text} />}
    </PressableScale>
  );
}
const createSsc = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  chip:     { backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, borderRadius: RADIUS.pill, minHeight: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  emoji:    { fontSize: 16 },
  chipText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: theme.muted },
});

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  const sc = createSc(theme);
  return (
    <PressableScale
      style={[sc.chip, selected && { backgroundColor: theme.accentDim, borderColor: theme.text, borderWidth: 1 }]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
    >
      <Text style={[sc.chipText, selected && { color: theme.text }]}>{label}</Text>
      {selected && <Feather name="check" size={13} color={theme.text} />}
    </PressableScale>
  );
}
const createSc = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  chip:       { backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, borderRadius: RADIUS.pill, minHeight: 44, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipText:   { fontSize: 15, fontFamily: 'Inter_500Medium', color: theme.muted },
});

/** Big tappable option row — one of a few answers to the screen's question. */
function RadioRow({ label, sub, selected, onPress }: { label: string; sub: string; selected: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  const sr = createSr(theme);
  return (
    <PressableScale
      style={[sr.row, selected && { borderColor: theme.text, borderWidth: 1 }]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
    >
      <StitchAccent active={selected} color={theme.text} style={sr.stitch} />
      <View style={{ flex: 1 }}>
        <Text style={[sr.label, selected && sr.labelOn]}>{label}</Text>
        <Text style={sr.sub}>{sub}</Text>
      </View>
      <View style={[sr.circle, selected && { borderColor: theme.text }]}>
        {selected && <View style={[sr.dot, { backgroundColor: theme.text }]} />}
      </View>
    </PressableScale>
  );
}
const createSr = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row:     { backgroundColor: theme.card, borderRadius: RADIUS.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, paddingHorizontal: 18, paddingVertical: 20, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, overflow: 'hidden' },
  stitch:  { position: 'absolute', top: 10, left: 18 },
  label:   { fontSize: 17, lineHeight: 22, fontFamily: 'Inter_600SemiBold', color: theme.text, marginBottom: 2 },
  labelOn: { color: theme.text },
  sub:     { ...TYPE.body, color: theme.muted },
  circle:  { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dot:     { width: 10, height: 10, borderRadius: 5 },
});

/** Full-width primary pill (press scale + optional light haptic). */
function PrimaryButton({ label, onPress, disabled, loading, haptic = true }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; haptic?: boolean }) {
  return <PillButton label={label} onPress={onPress} disabled={disabled} loading={loading} haptic={haptic} />;
}

/** Inline form error with icon. */
function InlineError({ message }: { message: string }) {
  const { theme } = useAppTheme();
  return (
    <Reveal style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACE.sm }}>
      <Feather name="alert-circle" size={14} color={theme.error} />
      <Text style={[TYPE.label, { color: theme.error, flex: 1 }]}>{message}</Text>
    </Reveal>
  );
}

// ─── Loading animation ────────────────────────────────────────────────────────
// Timing is unchanged: each task completes on the same schedule and onDone
// fires at the same moment. Visually, the thread sews one stitch per task.
function LoadingAnimation({ steps, onDone }: { steps: string[]; onDone: () => void }) {
  const { theme } = useAppTheme();
  const sl = createSl(theme);
  const insets  = useSafeAreaInsets();
  const [done, setDone]   = useState<boolean[]>(steps.map(() => false));
  const [active, setActive] = useState(0);
  const logoScale = useRef(new Animated.Value(0.7)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const total = steps.length * 700 + 400;

    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, damping: 14, stiffness: 100, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();

    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => {
      timers.push(
        setTimeout(() => {
          setActive(i);
          setTimeout(() => {
            setDone((prev) => { const n = [...prev]; n[i] = true; return n; });
          }, 500);
        }, i * 700),
      );
    });

    const endTimer = setTimeout(onDone, total);
    timers.push(endTimer);
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = done.filter(Boolean).length;

  return (
    <View style={[sl.root, { paddingTop: insets.top + SPACE.xxl, paddingBottom: insets.bottom + SPACE.xxl }]}>

      {/* Logo */}
      <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }], marginBottom: SPACE.xl, alignItems: 'center' }}>
        <Glow size={200} color={theme.text} intensity={0.12} style={sl.logoHalo} />
        <BrandthreadLogo size={72} />
      </Animated.View>

      {/* Steps, joined by a running stitch */}
      <View style={sl.stepsList}>
        {steps.map((label, i) => {
          const isDone = done[i];
          const isActive = active === i && !isDone;
          return (
            <Reveal key={label} index={i + 1}>
              <View style={sl.stepRow}>
                <View style={sl.stepRail}>
                  <View style={[sl.stepIcon, isDone && sl.stepIconDone, isActive && { borderColor: theme.text }]}>
                    {isDone ? (
                      <Feather name="check" size={13} color={theme.background} />
                    ) : isActive ? (
                      <ActivityIndicator size="small" color={theme.text} />
                    ) : (
                      <View style={sl.stepDot} />
                    )}
                  </View>
                  {i < steps.length - 1 ? (
                    <View style={[sl.stepJoin, { backgroundColor: isDone ? theme.text : theme.border }]} />
                  ) : null}
                </View>
                <Text style={[sl.stepLabel, (isDone || isActive) && sl.stepLabelActive]}>
                  {label}
                </Text>
              </View>
            </Reveal>
          );
        })}
      </View>

      {/* The thread sews one stitch per finished task */}
      <ThreadProgress
        fraction={doneCount / Math.max(1, steps.length)}
        color={theme.text}
        trackColor={theme.border}
        accessibilityLabel={`${doneCount} of ${steps.length} setup steps done`}
        style={{ width: '100%' }}
      />
    </View>
  );
}
const createSl = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const BORDER = theme.border, FG = theme.text, MUTED = theme.muted;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.xl },
  logoHalo: { position: 'absolute', top: -64 },
  stepsList: { width: '100%', marginBottom: SPACE.xl },
  stepRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md },
  stepRail:  { alignItems: 'center' },
  stepIcon:  {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepJoin:       { width: 1, height: 20, marginVertical: 2 },
  stepIconDone:   { backgroundColor: FG, borderColor: FG },
  stepDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)' },
  stepLabel:      { ...TYPE.body, lineHeight: 28, color: MUTED },
  stepLabelActive:{ color: FG, fontFamily: 'Inter_600SemiBold' },
  });
};


// ─── Notifications step ────────────────────────────────────────────────────────
function NotificationsStep({ flow, onEnable, onSkip }: { flow: Flow; onEnable: () => void; onSkip: () => void }) {
  const { theme } = useAppTheme();
  const sn = createSn(theme);
  const insets  = useSafeAreaInsets();

  const desc = flow === 'buyer'
    ? Platform.OS === 'web'
      ? 'Browser notifications are not enabled here. You can turn on mobile alerts later from the Brandthread app.'
      : 'Get drop alerts, friend requests, messages and order updates.'
    : Platform.OS === 'web'
      ? 'Browser notifications are not enabled here. You can turn on mobile alerts later from the Brandthread app.'
      : 'Get order, production, payout and customer alerts instantly.';

  const items = flow === 'buyer'
    ? ['New brand drops', 'Messages from brands', 'Order updates', 'Friend requests']
    : ['New orders', 'Production milestones', 'Payout confirmations', 'Customer messages'];

  return (
    <View style={[sn.root, { paddingTop: insets.top + SPACE.xxl, paddingBottom: insets.bottom + SPACE.lg }]}>

      <View style={sn.body}>
        {/* Hero: the thread passes through the bell */}
        <View style={sn.hero}>
          <ThreadDraw height={120} color={theme.text} delay={120} duration={1100} style={sn.heroThread} />
          <Reveal>
            <View style={[sn.bellBg, { backgroundColor: theme.background, borderColor: theme.border, shadowColor: theme.text }]}>
              <Feather name="bell" size={30} color={theme.text} />
            </View>
          </Reveal>
        </View>

        <StepHeadline size="display" delay={180}>Never miss{'\n'}what matters.</StepHeadline>
        <StepSub index={3}>{desc}</StepSub>

        {/* Notification examples */}
        <View style={sn.examples}>
          {items.map((item, i) => (
            <Reveal key={item} index={i + 4}>
              <View style={sn.exampleRow}>
                <View style={[sn.exampleDot, { backgroundColor: theme.text }]} />
                <Text style={sn.exampleText}>{item}</Text>
              </View>
            </Reveal>
          ))}
        </View>
      </View>

      <Reveal index={8} style={sn.btns}>
        <PillButton label="Continue" onPress={onEnable} />
        <PillButton
          testID="onboarding-notifications-skip"
          accessibilityLabel="Not now"
          label="Not now"
          variant="ghost"
          onPress={onSkip}
        />
      </Reveal>
    </View>
  );
}
const createSn = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const FG = theme.text;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, paddingHorizontal: SPACE.lg },
  body: { flex: 1, justifyContent: 'center', paddingBottom: SPACE.lg },
  hero: { height: 120, justifyContent: 'center', marginBottom: SPACE.lg },
  heroThread: { position: 'absolute', left: -SPACE.lg, right: -SPACE.lg, top: 0 },
  bellBg:   { width: 72, height: 72, borderRadius: 36, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 8, marginLeft: SPACE.xl },
  examples: { gap: SPACE.sm, width: '100%', marginTop: SPACE.lg },
  exampleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  exampleDot: { width: 5, height: 5, borderRadius: 3 },
  exampleText:{ ...TYPE.bodyStrong, color: FG },
  btns: { gap: SPACE.xs },
  });
};

// ─── Success screen ────────────────────────────────────────────────────────────
// Finale: the thread that ran through every step sews the Brandthread mark,
// then the real logo resolves over the stitching.
function SuccessScreen({ flow, firstName, brandName, onFinish, finishing }: { flow: Flow; firstName: string; brandName: string; onFinish: () => void; finishing?: boolean }) {
  const { theme } = useAppTheme();
  const ss = createSs(theme);
  const insets  = useSafeAreaInsets();
  const copyDelay = Math.round(MOTION.finaleDrawMs * 0.7);

  const ctaLabel = flow === 'buyer' ? 'Start exploring' : 'Go to Dashboard';
  const desc = flow === 'buyer'
    ? 'Your next favorite brand is one swipe away.'
    : 'Your brand now has one home for design, production, selling and growth.';

  return (
    <View style={[ss.root, { paddingTop: insets.top + SPACE.xxl, paddingBottom: insets.bottom + SPACE.lg }]}>
      <LinearGradient
        pointerEvents="none"
        colors={theme.heroGradient}
        // heroGradient[0] is the theme background, so running it bottom-up
        // lights the top and dissolves seamlessly into the canvas.
        start={{ x: 0.5, y: 1 }}
        end={{ x: 0.5, y: 0 }}
        style={ss.wash}
      />

      <View style={ss.body}>
        <View style={ss.hero}>
          <ThreadLogoStitch
            size={124}
            color={theme.text}
            onStitched={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
          />
        </View>

        <StepHeadline size="display" delay={copyDelay}>Welcome to{'\n'}Brandthread.</StepHeadline>

        {flow === 'seller' && brandName ? (
          <Reveal delay={copyDelay} index={2}>
            <View style={[ss.brandBadge, { borderColor: theme.border }]}>
              <Text style={[ss.brandBadgeText, { color: theme.text }]}>{brandName}</Text>
            </View>
          </Reveal>
        ) : null}

        <Reveal delay={copyDelay} index={2}>
          <Text style={ss.desc}>{desc}</Text>
        </Reveal>

        {/* Feature rows */}
        <View style={ss.features}>
          {(flow === 'buyer'
            ? ['Thread — your personal brand feed', 'Discover drops before they sell out', 'Chat directly with brands', 'Track every order in one place']
            : ['Design Studio & AI tools ready', 'Manufacturer network unlocked', 'Your store is ready to launch', 'Analytics dashboard activated']
          ).map((f, i) => (
            <Reveal key={f} delay={copyDelay} index={i + 3}>
              <View style={ss.featureRow}>
                <Feather name="check" size={15} color={theme.text} />
                <Text style={ss.featureText}>{f}</Text>
              </View>
            </Reveal>
          ))}
        </View>
      </View>

      <Reveal delay={copyDelay} index={7}>
        <PrimaryButton label={finishing ? 'Saving…' : ctaLabel} onPress={onFinish} loading={finishing} />
      </Reveal>
    </View>
  );
}
const createSs = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const FG = theme.text, MUTED = theme.muted;
  return StyleSheet.create({
  root:       { flex: 1, backgroundColor: theme.background, paddingHorizontal: SPACE.lg },
  wash:       { position: 'absolute', top: 0, left: 0, right: 0, height: '55%', opacity: 0.8 },
  body:       { flex: 1, justifyContent: 'center' },
  hero:       { alignItems: 'center', marginBottom: SPACE.xl },
  brandBadge: { alignSelf: 'flex-start', borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: 6, marginTop: SPACE.sm, borderWidth: 1 },
  brandBadgeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  desc:       { ...TYPE.body, color: MUTED, marginTop: SPACE.sm, marginBottom: SPACE.lg },
  features:   { gap: SPACE.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  featureText:{ ...TYPE.bodyStrong, color: FG },
  });
};

// ─── Buyer Auth Step — bold "Sign up" screen with stacked OAuth rows ──────────
type BuyerAuthPhase = 'choose' | 'email-form' | 'verify' | 'existing-account';

interface BuyerAuthStepProps {
  signUp: ReturnType<typeof useSignUp>['signUp'];
  startGoogleOAuth: () => Promise<any>;
  startAppleOAuth: () => Promise<any>;
  onAuthComplete: () => void;
  onDevClear: () => Promise<void>;
  username: string;
  onUsernameChange: (v: string) => void;
  referralCode: string;
  onReferralCodeChange: (v: string) => void;
}

function BuyerAuthStep({
  signUp, startGoogleOAuth, startAppleOAuth, onAuthComplete, onDevClear,
  username, onUsernameChange, referralCode, onReferralCodeChange,
}: BuyerAuthStepProps) {
  const { theme } = useAppTheme();
  const sba = createSba(theme);
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const appleOAuthFlagEnabled = useFeatureFlag('oauthAppleEnabled');
  const appleOAuthEnabled = Platform.OS === 'ios' && appleOAuthFlagEnabled;
  const googleOAuthEnabled = useFeatureFlag('oauthGoogleEnabled');

  const [phase, setPhase]               = useState<BuyerAuthPhase>('choose');
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [code, setCode]                 = useState('');
  const [showPw, setShowPw]             = useState(false);
  const [loading, setLoading]           = useState(false);
  const [oauthLoading, setOAuth]        = useState('');
  const [error, setError]               = useState('');
  const [clearingSession, setClearSession] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  // Explicit agreement to the Terms, Community Guidelines and Privacy Policy
  // is required before any account is created (email, Google or Apple).
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [consentError, setConsentError] = useState(false);
  function requireConsent(): boolean {
    if (!agreedToTerms) {
      setConsentError(true);
      setError('Please agree to the Terms of Service and Community Guidelines to continue.');
      return false;
    }
    void rememberPendingConsent();
    return true;
  }
  function updateConsent(value: boolean) {
    setAgreedToTerms(value);
    setConsentError(false);
    setError((current) => current.startsWith('Please agree') ? '' : current);
  }

  const USERNAME_REGEX_AUTH = /^[a-zA-Z0-9_]{3,30}$/;
  const isUsernameValid = USERNAME_REGEX_AUTH.test(username.trim());
  const canSubmit = email.includes('@') && password.length >= 8 && isUsernameValid;
  const canVerify = code.length === 6;
  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? '';

  async function handleClearSession() {
    setClearSession(true);
    setError('');
    try {
      if (isSignedIn) await signOut();
      await onDevClear();
    } catch {
      // session may already be cleared
    } finally {
      setClearSession(false);
    }
  }

  async function handleSignUp() {
    if (!canSubmit || loading) return;
    if (!requireConsent()) return;
    if (isSignedIn) {
      const who = currentEmail ? `as ${currentEmail}` : 'with another account';
      setError(`You are currently signed in ${who}. Tap "Sign out and create another account" below.`);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error: err } = await signUp.password({
        emailAddress: email.trim().toLowerCase(),
        password,
      });
      if (err) {
        const inner = (err as any)?.errors?.[0] ?? err;
        const errCode = ((inner as any)?.code ?? '').toLowerCase();
        if (errCode === 'form_identifier_exists') {
          setPhase('existing-account');
        } else {
          setError(mapClerkError(err));
        }
        return;
      }
      await signUp.verifications.sendEmailCode();
      setPhase('verify');
    } catch (e: any) {
      const excInner = e?.errors?.[0] ?? e;
      const excCode  = (excInner?.code ?? '').toLowerCase();
      if (excCode === 'form_identifier_exists') {
        setPhase('existing-account');
      } else {
        setError(mapClerkError(e));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!canVerify || loading) return;
    setLoading(true);
    setError('');
    try {
      await signUp.verifications.verifyEmailCode({ code });
      if (signUp.status === 'complete') {
        await signUp.finalize({
          navigate: ({ decorateUrl }: { decorateUrl: (url: string) => string }) => {
            const referralQuery = referralCode
              ? `&referralCode=${encodeURIComponent(referralCode)}`
              : '';
            const destination = `/onboarding?postAuth=1${referralQuery}`;
            const url = decorateUrl(destination);
            if (url.startsWith('http') && typeof window !== 'undefined') {
              window.location.href = url;
            } else {
              router.replace(destination as never);
            }
          },
        });
        onAuthComplete();
      }
    } catch (e: any) {
      setError(mapClerkError(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(startFlow: () => Promise<any>, provider: string) {
    if (!requireConsent()) return;
    setOAuth(provider);
    setError('');
    try {
      const result = await startFlow();
      if (result?.createdSessionId && result?.setActive) {
        await result.setActive({ session: result.createdSessionId });
      }
      if (isOAuthFlowComplete(result)) {
        onAuthComplete();
      } else if (result?.signUp) {
        setError(`${provider} sign-in needs one more step. Please try again.`);
      }
    } catch (e: any) {
      if (isOAuthCancellationError(e)) { setOAuth(''); return; }
      setError(mapOAuthError(provider, e));
    } finally {
      setOAuth('');
    }
  }

  // Already signed-in guard
  if (isSignedIn && phase === 'choose') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={sba.scroll} keyboardShouldPersistTaps="handled">
          <Text style={sba.headline}>Already signed in</Text>
          <Text style={sba.sub}>
            {currentEmail ? `You are currently signed in as ${currentEmail}.` : 'You are currently signed in.'}
            {'\n\n'}Sign out first to create a new account, or continue with your current account.
          </Text>
          <TouchableOpacity style={sba.sessionBtn} onPress={handleClearSession} disabled={clearingSession} activeOpacity={0.85}>
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sba.sessionBtnGrad}>
              {clearingSession
                ? <ActivityIndicator color={theme.onAccent} size="small" />
                : <Text style={[sba.sessionBtnText, getOnAccentTextStyle(theme)]}>Sign out and create another account</Text>}
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={sba.continueBtn} onPress={onAuthComplete} activeOpacity={0.8}>
            <Text style={sba.continueBtnText}>Continue with current account →</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Existing account
  if (phase === 'existing-account') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={sba.scroll} keyboardShouldPersistTaps="handled">
          <Text style={sba.headline}>Account exists.</Text>
          <Text style={sba.sub}>An account already exists with this email.</Text>
          <View style={[sba.existingEmailChip, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
            <Text style={[sba.existingEmailText, { color: theme.accentLight }]}>{email}</Text>
          </View>
          <View style={[sba.existingCard, { backgroundColor: theme.secondaryDim, borderColor: theme.accentDim }]}>
            <Text style={sba.existingCardTitle}>Sign in to continue your Brandthread journey.</Text>
            <Text style={sba.existingCardSub}>Use your existing account to complete setup. Your onboarding answers are saved.</Text>
          </View>
          <TouchableOpacity style={sba.existingSignInBtn} onPress={() => router.replace('/sign-in' as never)} activeOpacity={0.88}>
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sba.existingSignInGrad}>
              <Text style={[sba.existingSignInText, getOnAccentTextStyle(theme)]}>Sign in</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={sba.existingDiffBtn} onPress={() => { setPhase('choose'); setEmail(''); setPassword(''); setError(''); }} activeOpacity={0.85}>
            <Text style={sba.existingDiffText}>Use a different email</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Verification
  if (phase === 'verify') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={sba.scroll} keyboardShouldPersistTaps="handled">
          <Text style={sba.headline}>Check your email</Text>
          <Text style={sba.sub}>We sent a 6-digit code to {email}</Text>
          <View style={sba.inputWrap}>
            <Text style={sba.label}>Verification code</Text>
            <TextInput
              style={[sba.input, sba.codeInput]}
              placeholder="000000"
              placeholderTextColor={MUTED2}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
          </View>
          {error ? <Text style={sba.error}>{error}</Text> : null}
          <PrimaryButton label={loading ? 'Verifying…' : 'Verify email'} onPress={handleVerify} disabled={!canVerify} loading={loading} />
          <TouchableOpacity style={sba.resendBtn} onPress={() => signUp.verifications.sendEmailCode()}>
            <Text style={sba.resendText}>{"Didn't get it? "}<Text style={{ color: theme.accentLight }}>Resend</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Email form (revealed via "Use email" in choose phase)
  if (phase === 'email-form') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={sba.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => { setPhase('choose'); setError(''); }} style={sba.backToChoose} activeOpacity={0.7}>
            <Feather name="arrow-left" size={16} color={MUTED} />
            <Text style={sba.backToChooseText}>Back</Text>
          </TouchableOpacity>
          <Text style={sba.headline}>Create your account</Text>
          <Text style={sba.sub}>One account for everything on Brandthread.</Text>

          <View style={sba.inputWrap}>
            <Text style={sba.label}>Choose your @username</Text>
            <TextInput
              testID="onboarding-username-input"
              style={[sba.input, usernameError ? { borderColor: 'rgba(248,113,113,0.5)' } : undefined]}
              placeholder="e.g. alex_style"
              placeholderTextColor={MUTED2}
              value={username}
              editable
              onChangeText={v => {
                const cleaned = v.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
                onUsernameChange(cleaned);
                if (cleaned.length > 0 && cleaned.length < 3) {
                  setUsernameError('At least 3 characters');
                } else {
                  setUsernameError('');
                }
              }}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
            />
            {usernameError
              ? <Text style={sba.hint}>{usernameError}</Text>
              : username.length > 0
                ? <Text style={sba.hint}>@{username} · letters, numbers, underscores only</Text>
                : <Text style={sba.hint}>Letters, numbers, and underscores only</Text>}
          </View>

          <View style={sba.inputWrap}>
            <Text style={sba.label}>Referral code (optional)</Text>
            <TextInput
              testID="onboarding-referral-input"
              style={sba.input}
              placeholder="e.g. FASHION"
              placeholderTextColor={MUTED2}
              value={referralCode}
              editable
              onChangeText={v => onReferralCodeChange(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
            />
            <Text style={sba.hint}>Enter the code from the friend who invited you.</Text>
          </View>

          <View style={sba.inputWrap}>
            <Text style={sba.label}>Email address</Text>
            <TextInput
              style={sba.input}
              placeholder="mila@nightshiftstudio.co"
              placeholderTextColor={MUTED2}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          <View style={sba.inputWrap}>
            <Text style={sba.label}>Password</Text>
            <View style={sba.pwRow}>
              <TextInput
                style={[sba.input, sba.pwInput]}
                placeholder="Minimum 8 characters"
                placeholderTextColor={MUTED2}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                autoComplete="new-password"
              />
              <TouchableOpacity style={sba.eyeBtn} onPress={() => setShowPw(v => !v)}>
                <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={MUTED} />
              </TouchableOpacity>
            </View>
            {password.length > 0 && password.length < 8 && (
              <Text style={sba.hint}>Use at least 8 characters</Text>
            )}
          </View>

          {error ? <Text style={sba.error}>{error}</Text> : null}

          <LegalConsent checked={agreedToTerms} onChange={updateConsent} showError={consentError} style={{ marginBottom: 16 }} />

          <PrimaryButton label={loading ? 'Creating account…' : 'Create account'} onPress={handleSignUp} disabled={!canSubmit} loading={loading} />

        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Default: bold "Sign up" chooser — OAuth rows first, then "Use email"
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={sba.chooseScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={sba.chooseHeadline}>Sign up</Text>
        <Text style={sba.chooseSub}>Discover brands, buy products, and follow the drops that move you.</Text>

        <LegalConsent checked={agreedToTerms} onChange={updateConsent} showError={consentError} style={{ marginBottom: 20 }} />

        {/* Apple row — iOS only. Shown first: App Store guideline 4.8 requires Sign in
            with Apple to be at least as prominent as other third-party social logins
            whenever any are offered. */}
        {appleOAuthEnabled && (
          <TouchableOpacity
            style={[sba.bigRow, sba.appleRow]}
            onPress={() => handleOAuth(startAppleOAuth, 'Apple')}
            activeOpacity={0.85}
            disabled={!!oauthLoading || loading}
          >
            {oauthLoading === 'Apple' ? (
              <ActivityIndicator color={FG} size="small" />
            ) : (
              <>
                <View style={sba.bigRowIcon}>
                  <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
                </View>
                <Text style={sba.bigRowText}>Continue with Apple</Text>
                <Feather name="chevron-right" size={16} color={MUTED2} />
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Google row */}
        {googleOAuthEnabled && (
          <TouchableOpacity
            style={sba.bigRow}
            onPress={() => handleOAuth(startGoogleOAuth, 'Google')}
            activeOpacity={0.85}
            disabled={!!oauthLoading || loading}
          >
            {oauthLoading === 'Google' ? (
              <ActivityIndicator color={theme.accentLight} size="small" />
            ) : (
              <>
                <View style={sba.bigRowIcon}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#4285F4', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 12, color: '#FFFFFF', lineHeight: 14 }}>G</Text>
                  </View>
                </View>
                <Text style={sba.bigRowText}>Continue with Google</Text>
                <Feather name="chevron-right" size={16} color={MUTED2} />
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Use email row */}
        <TouchableOpacity
          style={sba.bigRow}
          onPress={() => setPhase('email-form')}
          activeOpacity={0.85}
          disabled={!!oauthLoading || loading}
        >
          <View style={sba.bigRowIcon}>
            <Feather name="mail" size={20} color={MUTED} />
          </View>
          <Text style={sba.bigRowText}>Use email</Text>
          <Feather name="chevron-right" size={16} color={MUTED2} />
        </TouchableOpacity>

        {error ? <Text style={[sba.error, { textAlign: 'center', marginTop: 8 }]}>{error}</Text> : null}

        <TouchableOpacity style={sba.signInLink} onPress={() => router.replace('/sign-in' as never)} activeOpacity={0.8}>
          <Text style={sba.signInLinkText}>Already have an account? <Text style={{ color: theme.accentLight }}>Sign in</Text></Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

// ─── Shared Auth Step — single-column labeled form for buyer and seller ───────
type SharedAuthPhase = 'form' | 'verify' | 'existing-account';

interface SharedAuthStepProps {
  signUp: ReturnType<typeof useSignUp>['signUp'];
  startGoogleOAuth: () => Promise<any>;
  startAppleOAuth: () => Promise<any>;
  onAuthComplete: () => void;
  onDevClear: () => Promise<void>;
  username: string;
  onUsernameChange: (v: string) => void;
  referralCode: string;
  onReferralCodeChange: (v: string) => void;
  /** Prefill first name captured on the auth form into the later name step */
  onFirstNamePrefill: (firstName: string) => void;
  /** Prefill last name (stored for profile write) */
  onLastNamePrefill: (lastName: string) => void;
  allowSignedInAccountCreation?: boolean;
}

function SharedAuthStep({
  signUp, startGoogleOAuth, startAppleOAuth, onAuthComplete, onDevClear,
  username, onUsernameChange, referralCode, onReferralCodeChange,
  onFirstNamePrefill, onLastNamePrefill,
  allowSignedInAccountCreation = false,
}: SharedAuthStepProps) {
  const { theme } = useAppTheme();
  const ssa = createSsa(theme);
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const appleOAuthFlagEnabled = useFeatureFlag('oauthAppleEnabled');
  const appleOAuthEnabled = Platform.OS === 'ios' && appleOAuthFlagEnabled;
  const googleOAuthEnabled = useFeatureFlag('oauthGoogleEnabled');
  const showAnyOAuth = appleOAuthEnabled || googleOAuthEnabled;

  const [phase, setPhase]             = useState<SharedAuthPhase>('form');
  const [email, setEmail]             = useState('');
  const [formFirstName, setFormFirstName] = useState('');
  const [formLastName, setFormLastName]   = useState('');
  const [password, setPassword]       = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [code, setCode]               = useState('');
  const [showPw, setShowPw]           = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [oauthLoading, setOAuth]      = useState('');
  const [error, setError]             = useState('');
  const [clearingSession, setClearSession] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  // Explicit agreement to the Terms, Community Guidelines and Privacy Policy
  // is required before any account is created (email, Google or Apple).
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [consentError, setConsentError] = useState(false);
  function requireConsent(): boolean {
    if (!agreedToTerms) {
      setConsentError(true);
      setError('Please agree to the Terms of Service and Community Guidelines to continue.');
      return false;
    }
    void rememberPendingConsent();
    return true;
  }
  function updateConsent(value: boolean) {
    setAgreedToTerms(value);
    setConsentError(false);
    setError((current) => current.startsWith('Please agree') ? '' : current);
  }

  const USERNAME_REGEX_AUTH = /^[a-zA-Z0-9_]{3,30}$/;
  const isUsernameValid = USERNAME_REGEX_AUTH.test(username.trim());
  const passwordsMatch = password === confirmPassword;
  const canSubmit = email.includes('@') && password.length >= 8 && passwordsMatch && isUsernameValid && formFirstName.trim().length >= 1;
  const missingFields: string[] = [];
  if (!email.includes('@')) missingFields.push('a valid email');
  if (formFirstName.trim().length < 1) missingFields.push('your first name');
  if (password.length < 8) missingFields.push('a password (8+ characters)');
  else if (!passwordsMatch) missingFields.push('matching passwords');
  if (!isUsernameValid) missingFields.push('a username');
  const missingFieldsHint = missingFields.length === 0
    ? ''
    : missingFields.length === 1
      ? `Add ${missingFields[0]} to continue.`
      : `Add ${missingFields.slice(0, -1).join(', ')} and ${missingFields[missingFields.length - 1]} to continue.`;
  const canVerify = code.length === 6;
  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? '';

  async function handleClearSession() {
    setClearSession(true);
    setError('');
    try {
      if (isSignedIn) await signOut();
      await onDevClear();
    } catch {
      // session may already be cleared
    } finally {
      setClearSession(false);
    }
  }

  async function handleSignUp() {
    if (!canSubmit || loading) return;
    if (!requireConsent()) return;
    if (!passwordsMatch) { setError('Passwords do not match.'); return; }
    if (isSignedIn && !allowSignedInAccountCreation) {
      const who = currentEmail ? `as ${currentEmail}` : 'with another account';
      setError(`You are currently signed in ${who}. Tap "Sign out and create another account" below.`);
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Prefill name fields before account creation so draft restore gets them
      const fn = formFirstName.trim();
      const ln = formLastName.trim();
      onFirstNamePrefill(fn);
      onLastNamePrefill(ln);

      const { error: err } = await signUp.password({
        emailAddress: email.trim().toLowerCase(),
        password,
      });
      if (err) {
        const inner = (err as any)?.errors?.[0] ?? err;
        const errCode = ((inner as any)?.code ?? '').toLowerCase();
        if (errCode === 'form_identifier_exists') {
          setPhase('existing-account');
        } else {
          setError(mapClerkError(err));
        }
        return;
      }
      await signUp.verifications.sendEmailCode();
      setPhase('verify');
    } catch (e: any) {
      const excInner = e?.errors?.[0] ?? e;
      const excCode  = (excInner?.code ?? '').toLowerCase();
      if (excCode === 'form_identifier_exists') {
        setPhase('existing-account');
      } else {
        setError(mapClerkError(e));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!canVerify || loading) return;
    setLoading(true);
    setError('');
    try {
      const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code });
      if (verifyError) {
        setError("That code isn't right. Check your email and try again.");
        return;
      }
      if (signUp.status === 'complete') {
        await signUp.finalize({
          navigate: ({ decorateUrl }: { decorateUrl: (url: string) => string }) => {
            const referralQuery = referralCode
              ? `&referralCode=${encodeURIComponent(referralCode)}`
              : '';
            const addAccountQuery = allowSignedInAccountCreation ? '&addAccount=1' : '';
            const destination = `/onboarding?postAuth=1${addAccountQuery}${referralQuery}`;
            const url = decorateUrl(destination);
            if (url.startsWith('http') && typeof window !== 'undefined') {
              window.location.href = url;
            } else {
              router.replace(destination as never);
            }
          },
        });
        onAuthComplete();
      }
    } catch (e: any) {
      setError(mapClerkError(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(startFlow: () => Promise<any>, provider: string) {
    if (!requireConsent()) return;
    setOAuth(provider);
    setError('');
    try {
      const result = await startFlow();
      if (result?.createdSessionId && result?.setActive) {
        await result.setActive({ session: result.createdSessionId });
      }
      if (isOAuthFlowComplete(result)) {
        onAuthComplete();
      } else if (result?.signUp) {
        setError(`${provider} sign-in needs one more step. Please try again.`);
      }
    } catch (e: any) {
      if (isOAuthCancellationError(e)) { setOAuth(''); return; }
      setError(mapOAuthError(provider, e));
    } finally {
      setOAuth('');
    }
  }

  // Already signed in
  if (isSignedIn && phase === 'form' && !allowSignedInAccountCreation) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={ssa.scroll} keyboardShouldPersistTaps="handled">
          <StepHeadline>Already signed in</StepHeadline>
          <StepSub>
            {currentEmail ? `You are currently signed in as ${currentEmail}.` : 'You are currently signed in.'}
            {'\n\n'}Sign out first to create a new account, or continue with your current account.
          </StepSub>
          <Reveal index={2} style={ssa.stack}>
            <PillButton
              label="Sign out and create another account"
              onPress={handleClearSession}
              loading={clearingSession}
              disabled={clearingSession}
            />
            <PillButton label="Continue with current account →" variant="ghost" onPress={onAuthComplete} />
          </Reveal>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Existing account
  if (phase === 'existing-account') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={ssa.scroll} keyboardShouldPersistTaps="handled">
          <StepHeadline>Account exists.</StepHeadline>
          <StepSub>An account already exists with this email.</StepSub>
          <Reveal index={2}>
            <View style={[ssa.existingEmailChip, { borderColor: theme.border }]}>
              <Feather name="mail" size={13} color={theme.muted} />
              <Text style={[ssa.existingEmailText, { color: theme.text }]}>{email}</Text>
            </View>
          </Reveal>
          <Reveal index={3}>
            <View style={[ssa.existingCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={ssa.existingCardTitle}>Sign in to continue your Brandthread journey.</Text>
              <Text style={ssa.existingCardSub}>Use your existing account to complete setup. Your onboarding answers are saved.</Text>
            </View>
          </Reveal>
          <Reveal index={4} style={ssa.stack}>
            <PillButton label="Sign in" onPress={() => router.replace('/sign-in' as never)} />
            <PillButton
              label="Use a different email"
              variant="secondary"
              onPress={() => { setPhase('form'); setEmail(''); setPassword(''); setConfirm(''); setError(''); }}
            />
          </Reveal>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Verification
  if (phase === 'verify') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={ssa.scroll} keyboardShouldPersistTaps="handled">
          <StepHeadline>Check your email</StepHeadline>
          <StepSub>We sent a 6-digit code to {email}</StepSub>
          <Reveal index={2} style={ssa.codeWrap}>
            <CodeCells value={code} onChangeText={setCode} autoFocus />
          </Reveal>
          {error ? <InlineError message={error} /> : null}
          <Reveal index={3}>
            <PrimaryButton label={loading ? 'Verifying…' : 'Verify email'} onPress={handleVerify} disabled={!canVerify} loading={loading} />
          </Reveal>
          <TouchableOpacity style={ssa.resendBtn} onPress={() => signUp.verifications.sendEmailCode()}>
            <Text style={ssa.resendText}>{"Didn't get it? "}<Text style={{ color: theme.text, fontFamily: 'Inter_600SemiBold' }}>Resend</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Main sign-up form: single column, floating labels, one field per row
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={ssa.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <StepHeadline>Create your{'\n'}account</StepHeadline>
        <StepSub>Build your brand on Brandthread.</StepSub>
        <View style={ssa.formTop} />

        {/* Email */}
        <Reveal index={2}>
          <FloatingInput
            label="Email address"
            placeholder="brand@yourstudio.co"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            valid={email.includes('@')}
          />
        </Reveal>

        {/* First name */}
        <Reveal index={3}>
          <FloatingInput
            label="First name"
            placeholder="Alex"
            value={formFirstName}
            onChangeText={setFormFirstName}
            autoCapitalize="words"
            maxLength={40}
            valid={formFirstName.trim().length >= 1}
          />
        </Reveal>

        {/* Last name */}
        <Reveal index={4}>
          <FloatingInput
            label="Last name"
            placeholder="Rivera"
            value={formLastName}
            onChangeText={setFormLastName}
            autoCapitalize="words"
            maxLength={40}
          />
        </Reveal>

        {/* Password */}
        <Reveal index={5}>
          <FloatingInput
            label="Password"
            placeholder="Minimum 8 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            autoComplete="new-password"
            hint={password.length > 0 && password.length < 8 ? 'Use at least 8 characters' : null}
            right={<RevealToggle shown={showPw} onToggle={() => setShowPw(v => !v)} />}
          />
        </Reveal>

        {/* Confirm password */}
        <Reveal index={6}>
          <FloatingInput
            label="Confirm password"
            placeholder="Re-enter password"
            value={confirmPassword}
            onChangeText={setConfirm}
            secureTextEntry={!showConfirm}
            autoComplete="new-password"
            error={!passwordsMatch && confirmPassword.length > 0 ? 'Passwords do not match' : null}
            right={<RevealToggle shown={showConfirm} onToggle={() => setShowConfirm(v => !v)} />}
          />
        </Reveal>

        {/* Divider */}
        <View style={ssa.divider}>
          <View style={ssa.divLine} />
          <View style={ssa.divLine} />
        </View>

        {/* Username */}
        <Reveal index={7}>
          <FloatingInput
            testID="onboarding-username-input"
            value={username}
            editable
            onChangeText={v => {
              const cleaned = v.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
              onUsernameChange(cleaned);
              if (cleaned.length > 0 && cleaned.length < 3) {
                setUsernameError('At least 3 characters');
              } else {
                setUsernameError('');
              }
            }}
            label="Username"
            placeholder="e.g. noire_collective"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
            error={usernameError || null}
            valid={isUsernameValid}
            hint={username.length > 0
              ? `@${username} · letters, numbers, underscores only`
              : 'Letters, numbers, and underscores only'}
          />
        </Reveal>

        {/* Referral code */}
        <Reveal index={8}>
          <FloatingInput
            testID="onboarding-referral-input"
            value={referralCode}
            editable
            onChangeText={v => onReferralCodeChange(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
            label="Referral code (optional)"
            placeholder="e.g. FASHION"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            hint="Enter the code from the friend who invited you."
          />
        </Reveal>

        <Reveal index={9}>
          <LegalConsent checked={agreedToTerms} onChange={updateConsent} showError={consentError} style={{ marginTop: SPACE.xs, marginBottom: SPACE.md }} />
        </Reveal>

        {error ? <InlineError message={error} /> : null}

        <Reveal index={10}>
          <PrimaryButton label={loading ? 'Creating account…' : 'Create account'} onPress={handleSignUp} disabled={!canSubmit} loading={loading} />
          {!canSubmit && missingFieldsHint ? <Text style={[ssa.hint, ssa.hintCentered]}>{missingFieldsHint}</Text> : null}
        </Reveal>

        {/* OAuth options below the main CTA */}
        {showAnyOAuth && (
          <View style={ssa.divider}>
            <View style={ssa.divLine} />
            <Text style={ssa.divText}>or</Text>
            <View style={ssa.divLine} />
          </View>
        )}

        {/* Apple first — App Store guideline 4.8 prominence requirement. */}
        {appleOAuthEnabled && (
          <PressableScale
            style={[ssa.oauthBtn, ssa.appleBtn]}
            onPress={() => handleOAuth(startAppleOAuth, 'Apple')}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
            disabled={!!oauthLoading || loading}
          >
            {oauthLoading === 'Apple' ? <ActivityIndicator color={theme.text} size="small" /> : <>
              <Ionicons name="logo-apple" size={20} color={FG} />
              <Text style={ssa.oauthText}>Continue with Apple</Text>
            </>}
          </PressableScale>
        )}

        {googleOAuthEnabled && (
          <PressableScale
            style={ssa.oauthBtn}
            onPress={() => handleOAuth(startGoogleOAuth, 'Google')}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            disabled={!!oauthLoading || loading}
          >
            {oauthLoading === 'Google' ? <ActivityIndicator color={theme.text} size="small" /> : <>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: FG, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: 'Inter_700Bold', fontSize: 12, color: CARD, lineHeight: 14 }}>G</Text></View>
              <Text style={ssa.oauthText}>Continue with Google</Text>
            </>}
          </PressableScale>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Shared styles for buyer auth step
const createSba = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const CARD = theme.card, BORDER = theme.border, FG = theme.text, MUTED = theme.muted;
  return StyleSheet.create({
  scroll:    { flexGrow: 1, paddingVertical: 8, gap: 0 },
  chooseScroll: { flexGrow: 1, paddingVertical: 24, gap: 0 },
  chooseHeadline: { fontSize: 36, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -1.2, marginBottom: 8 },
  chooseSub: { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 22, marginBottom: 32 },
  bigRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
    paddingVertical: 16, paddingHorizontal: 16, backgroundColor: CARD, marginBottom: 10,
  },
  appleRow: { backgroundColor: '#000000', borderColor: 'rgba(255,255,255,0.15)' },
  bigRowIcon: { width: 28, alignItems: 'center' },
  bigRowText: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  signInLink: { paddingVertical: 16, alignItems: 'center' },
  signInLinkText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED },
  backToChoose: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  backToChooseText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
  headline:  { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.5, marginBottom: 4 },
  sub:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 20 },
  inputWrap: { marginBottom: 12 },
  label:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 5 },
  input:     { backgroundColor: INPUT_BG, borderWidth: StyleSheet.hairlineWidth, borderColor: INPUT_BD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: 'Inter_400Regular', color: FG },
  codeInput: { letterSpacing: 8, fontSize: 22, textAlign: 'center', fontFamily: 'Inter_700Bold' },
  pwRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD, borderRadius: 12 },
  pwInput:   { flex: 1, borderWidth: 0, backgroundColor: 'transparent' },
  eyeBtn:    { paddingHorizontal: 14 },
  hint:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 4 },
  error:     { color: ERR, fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 10 },
  resendBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  resendText:{ fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED },
  legal:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED2, textAlign: 'center', lineHeight: 18, marginTop: 12 },
  existingEmailChip: {
    alignSelf: 'flex-start',
    borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 6, marginBottom: 16,
  },
  existingEmailText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  existingCard: {
    borderRadius: 12, borderWidth: 1,
    padding: 16, marginBottom: 20,
  },
  existingCardTitle: {
    fontSize: 17, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 6, lineHeight: 23,
  },
  existingCardSub: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 20,
  },
  existingSignInBtn:  { marginBottom: 9, borderRadius: 12, overflow: 'hidden' },
  existingSignInGrad: { paddingVertical: 16, alignItems: 'center', borderRadius: 12 },
  existingSignInText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  existingDiffBtn: {
    borderRadius: 12, paddingVertical: 15, alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  existingDiffText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  sessionBtn:     { marginTop: 8, marginBottom: 10, borderRadius: 14, overflow: 'hidden' },
  sessionBtnGrad: { paddingVertical: 16, alignItems: 'center', paddingHorizontal: 20 },
  sessionBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  continueBtn:    { paddingVertical: 14, alignItems: 'center' },
  continueBtnText:{ fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
  });
};

// Shared styles for the buyer/seller auth step
const createSsa = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const BORDER = theme.border, FG = theme.text, MUTED = theme.muted;
  return StyleSheet.create({
  scroll:    { flexGrow: 1, paddingTop: SPACE.xs, paddingBottom: SPACE.xxl, gap: 0 },
  stack:     { gap: SPACE.sm, marginTop: SPACE.xl },
  formTop:   { height: SPACE.lg },
  codeWrap:  { marginTop: SPACE.xl },
  hint:      { ...TYPE.caption, color: MUTED, marginTop: SPACE.xs },
  hintCentered: { textAlign: 'center' },
  resendBtn: { paddingVertical: SPACE.md, alignItems: 'center', marginTop: SPACE.xxs },
  resendText:{ ...TYPE.body, color: MUTED },
  divider:   { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginVertical: SPACE.md },
  divLine:   { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: BORDER },
  divText:   { ...TYPE.label, color: MUTED },
  oauthBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER, minHeight: 56, backgroundColor: 'transparent', marginBottom: SPACE.sm },
  appleBtn:  { borderColor: BORDER },
  oauthText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: FG },
  existingEmailChip: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: RADIUS.pill, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14, paddingVertical: 8, marginTop: SPACE.lg, marginBottom: SPACE.md,
  },
  existingEmailText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  existingCard: {
    borderRadius: RADIUS.card, borderWidth: StyleSheet.hairlineWidth,
    padding: SPACE.md + 2,
  },
  existingCardTitle: {
    fontSize: 17, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 6, lineHeight: 23,
  },
  existingCardSub: {
    ...TYPE.body, color: MUTED,
  },
  });
};

// ─── Seller preview / theme selection step ────────────────────────────────────
function SellerPreviewStep({
  brandName,
  selectedThemeId,
  onSelectTheme,
  onContinue,
  generateSample,
}: {
  brandName: string;
  selectedThemeId: AppThemeId;
  onSelectTheme: (id: AppThemeId) => void;
  onContinue: () => void;
  generateSample: (style: string) => Promise<{ b64_json: string }>;
}) {
  const { theme } = useAppTheme();
  const spreview = createSpreview(theme);
  const [sampleStyle, setSampleStyle] = useState('Minimalist');
  const [sampleUri, setSampleUri] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (generating || sampleUri) return;
    setGenerating(true);
    setSampleError('');
    try {
      const result = await generateSample(sampleStyle);
      if (!result?.b64_json) throw new Error('The AI service returned no image.');
      setSampleUri(`data:image/png;base64,${result.b64_json}`);
    } catch (error: any) {
      setSampleError(error?.message || 'The sample could not be generated. Try again.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={spreview.scroll} showsVerticalScrollIndicator={false}>
      <StepHeadline>Make it feel{'\n'}like yours.</StepHeadline>
      <StepSub>
        Pick a storefront accent, then try one free AI logo sample before choosing a plan.
        Your choices stay editable later.
      </StepSub>

      <Reveal index={2}>
        <Text style={spreview.sectionLabel}>Storefront accent</Text>
      </Reveal>
      <Reveal index={3}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={spreview.themeRow}>
          {APP_THEME_PRESETS.map((preset) => {
            const selected = preset.id === selectedThemeId;
            return (
              <PressableScale
                key={preset.id}
                testID={`onboarding-theme-${preset.id}`}
                style={[spreview.themeCard, selected && { borderColor: theme.text, borderWidth: 1 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${preset.name} storefront theme`}
                onPress={() => { Haptics.selectionAsync(); onSelectTheme(preset.id); }}
              >
                <LinearGradient colors={preset.heroGradient} style={spreview.themeSwatch}>
                  <View style={[spreview.themeDot, { backgroundColor: preset.accent }]} />
                  <View style={[spreview.themeLine, { backgroundColor: preset.secondary }]} />
                </LinearGradient>
                <View style={spreview.themeNameRow}>
                  <Text numberOfLines={1} style={spreview.themeName}>{preset.name}</Text>
                  {selected ? <Feather name="check" size={13} color={theme.text} /> : null}
                </View>
              </PressableScale>
            );
          })}
        </ScrollView>
      </Reveal>
      <Text style={spreview.hint}>Saved when your seller workspace is created.</Text>

      <Reveal index={4}>
        <View style={spreview.sampleHeader}>
          <View style={{ flex: 1 }}>
            <Text style={spreview.sectionLabel}>One free AI sample</Text>
            <Text style={spreview.sampleSub}>See your brand name as a logo. This calls the real generator.</Text>
          </View>
          <Feather name="zap" size={18} color={theme.text} />
        </View>
        <View style={spreview.styleRow}>
          {LOGO_SAMPLE_STYLES.map((style) => (
            <Chip key={style} label={style} selected={sampleStyle === style} onPress={() => setSampleStyle(style)} />
          ))}
        </View>
      </Reveal>

      {sampleUri ? (
        <Reveal>
          <View style={[spreview.resultCard, { borderColor: theme.border }]}>
            <Image source={{ uri: sampleUri }} style={spreview.resultImage} resizeMode="contain" accessibilityLabel={`${brandName} AI logo sample`} />
            <View style={spreview.resultCaption}>
              <Feather name="check" size={15} color={theme.text} />
              <Text style={spreview.resultText}>Your real AI sample is ready.</Text>
            </View>
          </View>
        </Reveal>
      ) : (
        <Reveal index={5}>
          <PillButton
            testID="onboarding-generate-sample"
            label="Generate free sample"
            icon={<Feather name="image" size={18} color={theme.onAccent} />}
            onPress={() => { void handleGenerate(); }}
            loading={generating}
          />
        </Reveal>
      )}
      {sampleError ? (
        <View style={spreview.errorBox}>
          <Feather name="alert-circle" size={14} color={theme.error} />
          <Text style={spreview.errorText}>{sampleError}</Text>
          <TouchableOpacity onPress={() => { void handleGenerate(); }} disabled={generating || !!sampleUri}>
            <Text style={[spreview.retryText, { color: theme.text }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Reveal index={6} style={spreview.continueWrap}>
        <PillButton
          testID="onboarding-preview-continue"
          accessibilityLabel={sampleUri ? 'Continue to plans' : 'Skip sample and continue to plans'}
          label={sampleUri ? 'Continue to plans' : 'Skip sample · Continue to plans'}
          variant={sampleUri ? 'primary' : 'secondary'}
          onPress={onContinue}
        />
      </Reveal>
    </ScrollView>
  );
}
const createSpreview = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const CARD = theme.card, BORDER = theme.border, FG = theme.text, MUTED = theme.muted, MUTED2 = theme.subtle, ERR = theme.error;
  return StyleSheet.create({
  scroll: { flexGrow: 1, paddingTop: SPACE.xs, paddingBottom: SPACE.xl },
  sectionLabel: { ...TYPE.eyebrow, color: FG, textTransform: 'uppercase', marginTop: SPACE.xl, marginBottom: SPACE.sm },
  themeRow: { gap: SPACE.xs, paddingRight: SPACE.xs },
  themeCard: { width: 104, padding: 6, borderRadius: 18, backgroundColor: CARD, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER },
  themeSwatch: { height: 56, borderRadius: 13, padding: 10, justifyContent: 'space-between' },
  themeDot: { width: 16, height: 16, borderRadius: 8 },
  themeLine: { width: 36, height: 3, borderRadius: 2 },
  themeNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 8 },
  themeName: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: FG },
  hint: { ...TYPE.caption, color: MUTED2, marginTop: SPACE.xs },
  sampleHeader: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: SPACE.sm },
  sampleSub: { ...TYPE.caption, color: MUTED, paddingRight: 18, marginTop: -4 },
  styleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginBottom: SPACE.md },
  resultCard: { borderRadius: RADIUS.card, borderWidth: StyleSheet.hairlineWidth, backgroundColor: '#F7F7F7', overflow: 'hidden', marginBottom: SPACE.sm },
  resultImage: { width: '100%', height: 180 },
  resultCaption: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, backgroundColor: 'rgba(0,0,0,0.86)' },
  resultText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.xs, padding: SPACE.sm, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: ERR },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, color: ERR },
  retryText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  continueWrap: { marginTop: SPACE.md },
  });
};

// ─── Main onboarding component ────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { theme, selectTheme } = useAppTheme();
  CARD = theme.card;
  FG = theme.text;
  MUTED = theme.muted;
  MUTED2 = theme.subtle;
  INPUT_BG = theme.surface;
  INPUT_BD = theme.border;
  ERR = theme.error;
  GREEN = theme.success;
  Object.assign(sm, createSm(theme));
  const { isSignedIn, signOut, isLoaded: authLoaded } = useAuth();
  const { user, isLoaded: userLoaded }                = useUser();
  const { signUp }              = useSignUp();
  const { startSSOFlow } = useSSO();
  const startGoogleOAuth = useCallback(() => startSSOFlow({ strategy: 'oauth_google', redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri) }), [startSSOFlow]);
  const startAppleOAuth  = useCallback(() => startSSOFlow({ strategy: APPLE_OAUTH_STRATEGY, redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri) }), [startSSOFlow]);
  const api = useApi();

  const router  = useRouter();
  const {
    postAuth,
    addAccount,
    referralCode: referralCodeParam,
    deviceFlow,
    deviceStep,
    deviceProbe,
  } = useLocalSearchParams<{
    postAuth?: string;
    addAccount?: string;
    referralCode?: string;
    deviceFlow?: string;
    deviceStep?: string;
    deviceProbe?: string;
  }>();
  const insets  = useSafeAreaInsets();
  const isAddAccount = addAccount === '1';
  const deviceProbeEnabled = __DEV__ && deviceProbe === '1';
  const deviceProbeFlow: Flow | null = __DEV__ && (deviceFlow === 'buyer' || deviceFlow === 'seller')
    ? deviceFlow
    : null;
  const parsedDeviceStep = Number(deviceStep);
  const deviceProbeStep = deviceProbeFlow && Number.isInteger(parsedDeviceStep)
    ? Math.max(0, parsedDeviceStep)
    : 0;

  const [flow, setFlow]           = useState<Flow | null>(deviceProbeFlow);
  const [selectedFlow, setSelectedFlow] = useState<AccountType | null>(deviceProbeFlow);
  // Step 0 = AccountType for both paths (v6 ordering)
  const [step, setStep]           = useState(deviceProbeStep);
  const [ready, setReady]         = useState(deviceProbeEnabled);
  const [addAccountSourceUserId, setAddAccountSourceUserId] = useState<string | null | undefined>(
    isAddAccount ? undefined : null,
  );

  // Buyer data
  const [firstName, setFirstName]         = useState('');
  const [lastName, setLastName]           = useState('');
  const [username, setUsername]           = useState('');
  // The username is chosen on the Auth step, before the Clerk account exists,
  // so the user-scoped draft (which needs user.id) can't persist it yet. Mirror
  // it into a device-scoped key immediately so a remount during/after email
  // verification (e.g. the postAuth web redirect) can't silently drop it.
  const updateUsername = useCallback((value: string) => {
    setUsername(value);
    void AsyncStorage.setItem(PENDING_USERNAME_KEY, value).catch(() => {});
  }, []);
  const [referralCode, setReferralCode]   = useState(
    typeof referralCodeParam === 'string'
      ? referralCodeParam.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
      : '',
  );
  const [styleInterests, setStyleArr]     = useState<string[]>(DEFAULT_BUYER_INTERESTS);

  // Seller data
  const [brandName, setBrandName]         = useState('');
  const [brandStage, setBrandStage]       = useState('idea');
  const [goals, setGoals]                 = useState<string[]>(DEFAULT_SELLER_GOALS);
  const [selectedPlanId, setSelectedPlanId] = useState<SellerPlanId>('starter');
  const [selectedThemeId, setSelectedThemeId] = useState<AppThemeId>('monochrome');
  const [planPrepDone, setPlanPrepDone] = useState(false);

  const [finishing, setFinishing]         = useState(false);

  const transitionProgress = useRef(new Animated.Value(1)).current;
  const transitionDirection = useRef<1 | -1>(1);
  const firstNameInputRef = useRef<TextInput>(null);
  const brandNameInputRef = useRef<TextInput>(null);
  const restoredDraft = useRef(false);
  const transitionSequence = useRef(0);
  const transitionInitiatedAt = useRef(0);
  const [deviceTransitionMetric, setDeviceTransitionMetric] = useState('idle');
  const [deviceFocusMetric, setDeviceFocusMetric] = useState('idle');
  const recordDeviceFocus = useCallback(() => {
    if (!deviceProbeEnabled) return;
    const focusDelayMs = Math.round(performance.now() - transitionInitiatedAt.current);
    setDeviceFocusMetric(`${flow}-${step};delay=${focusDelayMs};focused=1`);
  }, [deviceProbeEnabled, flow, step]);

  // Appium reuses the mounted route while changing probe query parameters.
  // Reset synchronously to the requested real onboarding screen between cases.
  useEffect(() => {
    if (!deviceProbeEnabled) return;
    setFlow(deviceProbeFlow);
    setSelectedFlow(deviceProbeFlow);
    setStep(deviceProbeStep);
    setReady(true);
    setDeviceTransitionMetric('idle');
    setDeviceFocusMetric('idle');
  }, [deviceProbeEnabled, deviceProbeFlow, deviceProbeStep]);

  // Clerk may take longer than local storage to initialize in a web preview.
  useEffect(() => {
    const fallback = setTimeout(() => {
      setReady(true);
    }, 1200);
    return () => clearTimeout(fallback);
  }, []);

  // In add-account mode, the already-active account is only the source of the
  // flow. Never restore or overwrite its onboarding draft while creating the
  // second Clerk identity.
  useEffect(() => {
    if (!isAddAccount || !userLoaded || addAccountSourceUserId !== undefined) return;
    setAddAccountSourceUserId(user?.id ?? null);
  }, [addAccountSourceUserId, isAddAccount, user?.id, userLoaded]);

  // ── Restore draft for the active account ─────────────────────────────────────
  useEffect(() => {
    if (deviceProbeEnabled) return;
    if (!authLoaded || (isSignedIn && !userLoaded)) return;
    if (isSignedIn && !user?.id) return;
    if (isAddAccount && addAccountSourceUserId === undefined) return;
    if (isAddAccount && user?.id === addAccountSourceUserId) {
      setReady(true);
      return;
    }
    if (restoredDraft.current) return;
    restoredDraft.current = true;

    async function init() {
      try {
        const signedInUserId = user?.id;
        const draftKey = draftKeyForUser(signedInUserId);
        await AsyncStorage.removeItem(LEGACY_DRAFT_KEY);
        const values = await AsyncStorage.multiGet([
          ...(draftKey ? [draftKey] : []),
          PENDING_FLOW_KEY,
          PENDING_USERNAME_KEY,
        ]);
        const draftVal = draftKey ? values.find(([key]) => key === draftKey)?.[1] : null;
        const pendingFlow = values.find(([key]) => key === PENDING_FLOW_KEY)?.[1];
        const pendingUsername = values.find(([key]) => key === PENDING_USERNAME_KEY)?.[1];

        if (draftVal) {
          try {
            const draft = JSON.parse(draftVal);
            if (draft.flow && draft.ownerId === signedInUserId) {
              setFlow(draft.flow);
              setSelectedFlow(draft.flow);
              setStep(restoreDraftStep(draft.flow, draft.step ?? 0, draft.version));
              setFirstName(draft.firstName ?? '');
              setLastName(draft.lastName ?? '');
              setUsername(draft.username ?? '');
              setStyleArr(draft.styleInterests ?? DEFAULT_BUYER_INTERESTS);
              setBrandName(draft.brandName ?? '');
              setBrandStage(draft.brandStage ?? 'idea');
              setGoals(draft.goals ?? DEFAULT_SELLER_GOALS);
              setSelectedPlanId(draft.selectedPlanId ?? recommendSellerPlan(draft.brandStage ?? '', draft.goals ?? []).planId);
              setSelectedThemeId(isAppThemeId(draft.selectedThemeId) ? draft.selectedThemeId : 'monochrome');
            }
          } catch { /* bad json, ignore */ }
        } else if (pendingFlow === 'buyer' || pendingFlow === 'seller') {
          setFlow(pendingFlow);
          setSelectedFlow(pendingFlow);
          setStep(
            isSignedIn && postAuth === '1'
              ? pendingFlow === 'buyer' ? BUYER_STEP_INDEX.NAME : SELLER_STEP_INDEX.NAME
              : pendingFlow === 'buyer' ? BUYER_STEP_INDEX.AUTH : SELLER_STEP_INDEX.AUTH,
          );
        }
        // The Auth step's typed username lives only in this component's state
        // until a Clerk user exists to key the per-user draft. A remount before
        // then (e.g. the web postAuth redirect) would otherwise lose it silently.
        if (pendingUsername) {
          setUsername((current) => current || pendingUsername);
        }
      } catch {
        // Local persistence is optional; a storage issue must not block signup.
      } finally {
        setReady(true);
      }
    }
    init();
  }, [addAccountSourceUserId, authLoaded, userLoaded, isSignedIn, isAddAccount, postAuth, user?.id, deviceProbeEnabled]);

  // ── Persist draft ───────────────────────────────────────────────────────────
  const saveDraft = useCallback(async (overrides?: Record<string, unknown>) => {
    const userId = user?.id;
    const draftKey = draftKeyForUser(userId);
    if (!draftKey || !userId) return;
    const data = {
      version: DRAFT_VERSION,
      ownerId: userId,
      flow, step, firstName, lastName, username, styleInterests, brandName, brandStage, goals, selectedPlanId, selectedThemeId,
      ...overrides,
    };
    await AsyncStorage.setItem(draftKey, JSON.stringify(data));
  }, [flow, step, firstName, lastName, username, styleInterests, brandName, brandStage, goals, selectedPlanId, selectedThemeId, user?.id]);

  // Persist onboarding answers under the authenticated user's immutable ID.
  useEffect(() => {
    if (!user?.id || !ready || !flow) return;
    if (isAddAccount && user.id === addAccountSourceUserId) return;
    const timer = setTimeout(() => {
      saveDraft().catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [addAccountSourceUserId, isAddAccount, user?.id, ready, flow, saveDraft]);

  // Let the lightweight screen transition finish before opening the keyboard.
  // Focusing during the transition forces iOS to relayout the moving container.
  useEffect(() => {
    const isNameStep = (flow === 'buyer' && step === BUYER_STEP_INDEX.NAME)
      || (flow === 'seller' && step === SELLER_STEP_INDEX.NAME);
    const isBrandNameStep = flow === 'seller' && step === SELLER_STEP_INDEX.BRAND_NAME;
    if (!isNameStep && !isBrandNameStep) return;

    const timer = setTimeout(() => {
      if (isBrandNameStep) {
        brandNameInputRef.current?.focus();
      } else {
        firstNameInputRef.current?.focus();
      }
    }, 260);
    return () => clearTimeout(timer);
  }, [flow, step]);

  // ── Auth completion handler (OAuth/native without remount) ──────────────────
  const handleAuthComplete = useCallback(() => {
    // After auth, move to the first post-auth step (Name) for the chosen flow
    if (flow === 'buyer') {
      transitionTo(BUYER_STEP_INDEX.NAME, 1);
    } else if (flow === 'seller') {
      transitionTo(SELLER_STEP_INDEX.NAME, 1);
    } else {
      // No flow set yet — go to auth but shouldn't happen in v6 order
      transitionTo(BUYER_STEP_INDEX.AUTH, 1);
    }
  }, [flow]);

  // Email verification can reload the web route while Clerk finalizes.
  useEffect(() => {
    if (ready && isSignedIn && postAuth === '1' && !flow) {
      // postAuth=1 means we just verified email; step 0 = AccountType was already passed
      // If flow is still null, go to AccountType so user can choose
      transitionTo(BUYER_STEP_INDEX.ACCOUNT_TYPE, -1);
    }
  }, [flow, isSignedIn, postAuth, ready]);

  // ── Watch for OAuth isSignedIn change ────────────────────────────────────────
  const prevSignedIn = useRef<boolean | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (prevSignedIn.current === null) { prevSignedIn.current = isSignedIn ?? false; return; }
    if (!prevSignedIn.current && isSignedIn) {
      // Just signed in via OAuth — move to Name step (flow is already set from AccountType choice)
      if (flow === 'buyer') {
        transitionTo(BUYER_STEP_INDEX.NAME, 1);
      } else if (flow === 'seller') {
        transitionTo(SELLER_STEP_INDEX.NAME, 1);
      }
    }
    prevSignedIn.current = isSignedIn ?? false;
  }, [isSignedIn, ready, flow]);

  // ── Navigation helpers ──────────────────────────────────────────────────────
  function transitionTo(next: number, dir: 1 | -1, initiatedAt = performance.now()) {
    const sequence = ++transitionSequence.current;
    transitionInitiatedAt.current = initiatedAt;
    transitionProgress.stopAnimation();
    transitionDirection.current = dir;
    transitionProgress.setValue(0);
    setStep(next);
    requestAnimationFrame(() => {
      const firstFrameMs = Math.round(performance.now() - initiatedAt);
      const animationStartedAt = performance.now();
      Animated.timing(transitionProgress, {
        toValue: 1,
        duration: 230,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (deviceProbeEnabled && sequence === transitionSequence.current) {
          const animationMs = Math.round(performance.now() - animationStartedAt);
          setDeviceTransitionMetric(
            `${flow ?? selectedFlow ?? 'choose'}-${next};firstFrame=${firstFrameMs};animation=${animationMs};phases=${finished ? 1 : 0}`,
          );
        }
      });
    });
  }

  function goNext(overrideStep?: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = overrideStep ?? step + 1;
    transitionTo(next, 1);
  }

  function goBack() {
    if (!canGoBack(step)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    transitionTo(step - 1, -1);
  }

  function continueFromAccountType() {
    if (!selectedFlow) return;
    const initiatedAt = performance.now();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // A session is already active here in two cases: this flow's own sign-up
    // just verified (isSignedIn flipped true, but a remount lost `flow` and
    // routed back through AccountType to re-pick it), or a signed-in user is
    // resuming onboarding they never finished. Neither should ever be sent
    // back into the Auth/sign-up screen — only a deliberate "add another
    // account" flow (isAddAccount) still needs it, to create a second,
    // separate Clerk identity while the first stays signed in.
    const skipAuth = isSignedIn && !isAddAccount;
    // After AccountType (step 0), go to path-specific Auth (step 1), unless
    // already signed in, in which case go straight to the next step (Name).
    const next = skipAuth
      ? (selectedFlow === 'buyer' ? BUYER_STEP_INDEX.NAME : SELLER_STEP_INDEX.NAME)
      : (selectedFlow === 'buyer' ? BUYER_STEP_INDEX.AUTH : SELLER_STEP_INDEX.AUTH);
    void AsyncStorage.multiSet([
      [PENDING_FLOW_KEY, selectedFlow],
      [ONBOARDING_KEY, 'false'],
    ]).catch(() => {});
    setFlow(selectedFlow);
    transitionTo(next, 1, initiatedAt);
  }

  // ── Finish handlers ─────────────────────────────────────────────────────────
  // A username can be taken between the Auth step and final submit (another
  // signup wins the race, or the same handle is reused after a partial retry).
  // Blindly retrying the save would fail identically forever, so this case is
  // routed back to the Auth step instead of the generic "try again" alert.
  function isUsernameTakenError(error: unknown): boolean {
    return error instanceof ApiError && error.status === 409 && /username/i.test(error.message);
  }

  function returnToAuthForUsernameConflict(targetStep: number) {
    setFinishing(false);
    Alert.alert(
      'Username taken',
      'That username was just taken by someone else. Please choose another.',
      [{ text: 'Choose another', onPress: () => transitionTo(targetStep, -1) }],
    );
  }

  function logBuyerOnboardingFailure(stage: string, error: unknown, retryAttempt: boolean) {
    const apiError = error instanceof ApiError ? error : null;
    console.error('[buyer-onboarding] save failed', {
      stage,
      retryAttempt,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      status: apiError?.status,
      code: apiError?.code,
      requestId: apiError?.requestId,
    });
  }

  async function finishBuyer(retryAttempt = false) {
    if (finishing) return;
    setFinishing(true);
    let profileId: string | null = null;
    let failureStage = 'required-profile';
    let pendingSyncQueued = false;
    try {
      // Compose full name from firstName (and optionally lastName if we captured it)
      const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || firstName.trim();
      const uname = username.trim().toLowerCase();
      const profile = await api.auth.sync({ name });
      profileId = profile.clerkId;
      const updated = await api.auth.updateProfile({
        name,
        displayName: name,
        accountType: 'buyer',
        expectedClerkId: profile.clerkId,
        ...(uname ? { username: uname } : {}),
      });
      await hydrateMyProfileFromAccount({
        userId: profile.clerkId,
        name: updated.displayName || updated.name || name,
        username: updated.username ?? uname,
        bio: updated.bio,
      }, socialKeysForUser(profile.clerkId));
      await saveBuyerProfileForUser(profile.clerkId, {
        ...DEFAULT_BUYER_PROFILE,
        name: updated.displayName || updated.name || name,
        username: updated.username ?? uname,
      });
      if (referralCode.trim()) {
        await api.referrals.apply(referralCode.trim(), profile.clerkId).catch((error) => {
          logBuyerOnboardingFailure('referral', error, retryAttempt);
        });
      }
      failureStage = 'pending-sync-queue';
      await queueBuyerOnboardingSync(profile.clerkId, styleInterests);
      pendingSyncQueued = true;
      failureStage = 'preferences-or-completion';
      await syncBuyerOnboarding(profile.clerkId, styleInterests, api);
      await AsyncStorage.multiSet([
        [ONBOARDING_KEY, 'true'],
        [ONBOARDING_OWNER_KEY, profile.clerkId],
        ['user_role', 'buyer'],
        ['onboarding_first_name', firstName],
        ['onboarding_style_interests', JSON.stringify(styleInterests)],
      ]);
      await AsyncStorage.multiRemove([draftKeyForUser(profile.clerkId)!, LEGACY_DRAFT_KEY]);
      await AsyncStorage.multiRemove([PENDING_FLOW_KEY, PENDING_USERNAME_KEY]);
      void registerGrantedPushToken(profile.clerkId, api);
      // Route to the feed explainer for first-time buyers
      router.replace('/thread-explainer' as never);
    } catch (error) {
      setFinishing(false);
      logBuyerOnboardingFailure(
        failureStage,
        error,
        retryAttempt,
      );
      if (isUsernameTakenError(error)) {
        returnToAuthForUsernameConflict(BUYER_STEP_INDEX.AUTH);
        return;
      }
      if (
        retryAttempt
        && failureStage === 'preferences-or-completion'
        && pendingSyncQueued
        && profileId
        && isRecoverableBuyerOnboardingSyncError(error)
      ) {
        try {
          await AsyncStorage.multiSet([
            [ONBOARDING_KEY, 'true'],
            [ONBOARDING_OWNER_KEY, profileId],
            ['user_role', 'buyer'],
            ['onboarding_first_name', firstName],
            ['onboarding_style_interests', JSON.stringify(styleInterests)],
          ]);
        } catch (storageError) {
          logBuyerOnboardingFailure('local-fallback', storageError, true);
        }
        void syncBuyerOnboarding(profileId, styleInterests, api).catch((backgroundError) => {
          logBuyerOnboardingFailure('background-retry', backgroundError, true);
        });
        router.replace('/thread-explainer' as never);
        return;
      }
      Alert.alert(
        'Setup incomplete',
        profileId
          && failureStage === 'preferences-or-completion'
          ? "We couldn\u2019t save your preferences. Try once more, or we’ll finish syncing after you enter the app."
          : "We couldn\u2019t finish setting up your profile. Please try again.",
        [{ text: 'Retry', onPress: () => { void finishBuyer(true); } }],
      );
    }
  }

  async function finishSeller() {
    if (finishing) return;
    setFinishing(true);
    try {
      const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || firstName.trim();
      const uname = username.trim().toLowerCase();
      const profile = await api.auth.sync({ name });
      await api.auth.onboarding({
        brandName: brandName.trim(),
        brandStage,
        ...(uname ? { username: uname } : {}),
      });
      await api.auth.updateProfile({
        name,
        displayName: name,
        accountType: 'seller',
        expectedClerkId: profile.clerkId,
      });
      if (referralCode.trim()) {
        await api.referrals.apply(referralCode.trim(), profile.clerkId).catch((error) => {
          console.error('[seller-onboarding] referral save failed', {
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }
      if (goals.length > 0 || brandStage) {
        await api.seller.saveOnboardingData({ goals, brandStage });
      }
      await api.auth.completeOnboarding('seller');
      await selectTheme(selectedThemeId);
      await AsyncStorage.multiSet([
        [ONBOARDING_KEY, 'true'],
        [ONBOARDING_OWNER_KEY, profile.clerkId],
        ['user_role', 'seller'],
        ['onboarding_first_name', firstName],
        ['onboarding_brand_name', brandName],
        ['onboarding_brand_stage', brandStage],
        ['onboarding_goals', JSON.stringify(goals)],
        ['onboarding_selected_plan', selectedPlanId],
      ]);
      await AsyncStorage.multiRemove([draftKeyForUser(profile.clerkId)!, LEGACY_DRAFT_KEY]);
      await AsyncStorage.multiRemove([PENDING_FLOW_KEY, PENDING_USERNAME_KEY]);
      void registerGrantedPushToken(profile.clerkId, api);
      api.ai.brandMemoryRebuild().catch(() => {});
      router.replace('/(tabs)/' as never);
    } catch (error) {
      setFinishing(false);
      console.error('[seller-onboarding] save failed', {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      });
      if (isUsernameTakenError(error)) {
        returnToAuthForUsernameConflict(SELLER_STEP_INDEX.AUTH);
        return;
      }
      Alert.alert(
        'Setup incomplete',
        "We couldn\u2019t save your brand profile. Check your connection and try again.",
        [{ text: 'Retry', onPress: () => { void finishSeller(); } }],
      );
    }
  }

  // ── Developer reset ─────────────────────────────────────────────────────────
  async function devReset() {
    try { if (isSignedIn) await signOut(); } catch {}
    await AsyncStorage.multiRemove([
      ONBOARDING_KEY, ONBOARDING_OWNER_KEY, 'user_role', LEGACY_DRAFT_KEY, PENDING_FLOW_KEY, PENDING_USERNAME_KEY,
      ...(user?.id ? [draftKeyForUser(user.id)!] : []),
      'onboarding_first_name', 'onboarding_brand_name',
      'onboarding_style_interests', 'splash_seen',
    ]);
    router.replace('/splash' as never);
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function canContinue(): boolean {
    // Step 0 = Welcome, Step 1 = AccountType: both drive their own CTAs, not the footer.
    if (step === BUYER_STEP_INDEX.WELCOME) return true;
    if (step === BUYER_STEP_INDEX.ACCOUNT_TYPE) return !!selectedFlow;
    // Auth step: user can always "continue" (auth has its own internal validation)
    if (flow === 'buyer' && step === BUYER_STEP_INDEX.AUTH) return true;
    if (flow === 'seller' && step === SELLER_STEP_INDEX.AUTH) return true;
    if (!flow) return false;
    if (flow === 'buyer') {
      if (step === BUYER_STEP_INDEX.NAME) return firstName.trim().length >= 2;
      if (step === BUYER_STEP_INDEX.STYLE) return true;
      if (step === BUYER_STEP_INDEX.BRANDS) return true;
    }
    if (flow === 'seller') {
      if (step === SELLER_STEP_INDEX.NAME) return firstName.trim().length >= 2;
      if (step === SELLER_STEP_INDEX.BRAND_NAME) return brandName.trim().length >= 1;
      if (step === SELLER_STEP_INDEX.BRAND_STAGE) return !!brandStage;
      if (step === SELLER_STEP_INDEX.GOALS) return true;
      if (step === SELLER_STEP_INDEX.PLAN) return true;
    }
    return true;
  }

  // ── Step dots indicator ──────────────────────────────────────────────────────
  function showsProgressBar(): boolean {
    // The cinematic Welcome opener has its own full-bleed visual — no dots yet.
    return step !== BUYER_STEP_INDEX.WELCOME;
  }

  function progressSteps(): { current: number; total: number } {
    const progressFlow = flow ?? selectedFlow;
    const total = progressFlow ? totalStepsFor(progressFlow) : totalStepsFor('buyer');
    return { current: Math.min(step, total - 1), total };
  }

  // ── Step rendering ──────────────────────────────────────────────────────────
  function renderStep() {
    // Step 0: Welcome — cinematic opener shown before any account-type choice.
    if (step === BUYER_STEP_INDEX.WELCOME) return (
      <WelcomeStep
        onGetStarted={() => transitionTo(BUYER_STEP_INDEX.ACCOUNT_TYPE, 1)}
        onSignIn={() => router.replace('/sign-in' as never)}
      />
    );

    // Step 1: AccountType (before any auth — buyer/seller choice)
    if (step === BUYER_STEP_INDEX.ACCOUNT_TYPE && !flow) return (
      <AccountTypeStep
        selected={selectedFlow}
        onSelect={setSelectedFlow}
        onContinue={() => { void continueFromAccountType(); }}
        embedded
      />
    );

    // If flow is already set (draft restore) and we're at the AccountType step, still show it
    if (step === BUYER_STEP_INDEX.ACCOUNT_TYPE && flow) {
      return (
        <AccountTypeStep
          selected={flow}
          onSelect={(t) => { setSelectedFlow(t); setFlow(t); }}
          onContinue={() => { void continueFromAccountType(); }}
          embedded
        />
      );
    }

    if (!flow) return null;

    /* ─── BUYER STEPS ─── */
    if (flow === 'buyer') {
      // Step 1: Shared buyer/seller account-creation form
      if (step === BUYER_STEP_INDEX.AUTH) return (
        <>
          <SharedAuthStep
            signUp={signUp}
            startGoogleOAuth={startGoogleOAuth}
            startAppleOAuth={startAppleOAuth}
            onAuthComplete={handleAuthComplete}
            onDevClear={devReset}
            username={username}
            onUsernameChange={updateUsername}
            referralCode={referralCode}
            onReferralCodeChange={setReferralCode}
            onFirstNamePrefill={setFirstName}
            onLastNamePrefill={setLastName}
            allowSignedInAccountCreation={isAddAccount}
          />
          {deviceProbeEnabled && (
            <TouchableOpacity
              testID="onboarding-device-auth-complete"
              accessibilityLabel="Complete auth device probe"
              style={sm.deviceProbeControl}
              onPress={handleAuthComplete}
            />
          )}
        </>
      );

      // Step 2: Name
      if (step === BUYER_STEP_INDEX.NAME) return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={sm.scroll} keyboardShouldPersistTaps="handled">
            <StepHeadline>What should{'\n'}we call you?</StepHeadline>
            <StepSub>This is how your profile will appear.</StepSub>
            <Reveal index={2} style={sm.inputWrap}>
              <FloatingInput
                ref={firstNameInputRef}
                testID="onboarding-first-name-input"
                onFocus={recordDeviceFocus}
                label="First name"
                placeholder="Alex"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                maxLength={40}
                valid={firstName.trim().length >= 2}
              />
            </Reveal>
          </ScrollView>
        </KeyboardAvoidingView>
      );

      // Step 3: Style interests — emoji chips with solid-fill selected state
      if (step === BUYER_STEP_INDEX.STYLE) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <StepHeadline>What do you{'\n'}want to see?</StepHeadline>
          <StepSub>Pick a few for better recommendations. You can skip this for now.</StepSub>
          <Reveal index={2} style={sm.chipGrid}>
            {STYLE_INTERESTS_WITH_EMOJI.map(({ label: item, emoji }) => (
              <StyleChip
                key={item}
                label={item}
                emoji={emoji}
                selected={styleInterests.includes(item)}
                onPress={() => setStyleArr((prev) => prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item])}
              />
            ))}
          </Reveal>
        </ScrollView>
      );

      // Step 5: Brands to follow — personalizes the Thread before the buyer ever sees it
      if (step === BUYER_STEP_INDEX.BRANDS) return (
        <BrandsToFollowStep />
      );

      // Step 6: Loading
      if (step === BUYER_STEP_INDEX.LOADING) return (
        <LoadingAnimation steps={BUYER_LOADING_STEPS} onDone={() => transitionTo(BUYER_STEP_INDEX.NOTIFICATIONS, 1)} />
      );

      // Step 5: Notifications
      if (step === BUYER_STEP_INDEX.NOTIFICATIONS) return (
        <NotificationsStep
          flow="buyer"
          onEnable={() => transitionTo(BUYER_STEP_INDEX.SUCCESS, 1)}
          onSkip={() => transitionTo(BUYER_STEP_INDEX.SUCCESS, 1)}
        />
      );

      // Step 6: Success
      if (step === BUYER_STEP_INDEX.SUCCESS) return (
        <SuccessScreen flow="buyer" firstName={firstName} brandName="" onFinish={finishBuyer} finishing={finishing} />
      );
    }

    /* ─── SELLER STEPS ─── */
    if (flow === 'seller') {
      // Step 1: Shared buyer/seller account-creation form
      if (step === SELLER_STEP_INDEX.AUTH) return (
        <>
          <SharedAuthStep
            signUp={signUp}
            startGoogleOAuth={startGoogleOAuth}
            startAppleOAuth={startAppleOAuth}
            onAuthComplete={handleAuthComplete}
            onDevClear={devReset}
            username={username}
            onUsernameChange={updateUsername}
            referralCode={referralCode}
            onReferralCodeChange={setReferralCode}
            onFirstNamePrefill={setFirstName}
            onLastNamePrefill={setLastName}
            allowSignedInAccountCreation={isAddAccount}
          />
          {deviceProbeEnabled && (
            <TouchableOpacity
              testID="onboarding-device-auth-complete"
              accessibilityLabel="Complete auth device probe"
              style={sm.deviceProbeControl}
              onPress={handleAuthComplete}
            />
          )}
        </>
      );

      // Step 2: Name (pre-filled from auth form)
      if (step === SELLER_STEP_INDEX.NAME) return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={sm.scroll} keyboardShouldPersistTaps="handled">
            <StepHeadline>What should{'\n'}we call you?</StepHeadline>
            <StepSub>This is how your workspace will greet you.</StepSub>
            <Reveal index={2} style={sm.inputWrap}>
              <FloatingInput
                ref={firstNameInputRef}
                testID="onboarding-first-name-input"
                onFocus={recordDeviceFocus}
                label="First name"
                placeholder="Alex"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                maxLength={40}
                valid={firstName.trim().length >= 2}
              />
            </Reveal>
          </ScrollView>
        </KeyboardAvoidingView>
      );

      // Step 3: Brand name
      if (step === SELLER_STEP_INDEX.BRAND_NAME) return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={sm.scroll} keyboardShouldPersistTaps="handled">
            <StepHeadline>What are you{'\n'}building?</StepHeadline>
            <StepSub>Use your current name, a working name, or change it later.</StepSub>
            <Reveal index={2} style={sm.inputWrap}>
              <FloatingInput
                ref={brandNameInputRef}
                testID="onboarding-brand-name-input"
                onFocus={recordDeviceFocus}
                label="Brand name"
                placeholder="e.g. Noir Collective"
                value={brandName}
                onChangeText={setBrandName}
                autoCapitalize="words"
                maxLength={60}
                valid={brandName.trim().length >= 1}
                hint="Brandthread AI will use this to shape your workspace."
              />
            </Reveal>
          </ScrollView>
        </KeyboardAvoidingView>
      );

      // Step 4: Brand stage
      if (step === SELLER_STEP_INDEX.BRAND_STAGE) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <StepHeadline>Where is your{'\n'}brand today?</StepHeadline>
          <StepSub>We'll tailor your workspace to your stage.</StepSub>
          <View style={sm.radioList}>
            {BRAND_STAGES.map((s, i) => (
              <Reveal key={s.value} index={i + 2}>
                <RadioRow
                  label={s.label}
                  sub={s.sub}
                  selected={brandStage === s.value}
                  onPress={() => setBrandStage(s.value)}
                />
              </Reveal>
            ))}
          </View>
        </ScrollView>
      );

      // Step 5: Goals
      if (step === SELLER_STEP_INDEX.GOALS) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <StepHeadline>What do you{'\n'}need help with?</StepHeadline>
          <StepSub>Choose what matters right now, or skip and personalize later.</StepSub>
          <Reveal index={2} style={sm.chipGrid}>
            {SELLER_GOALS.map((g) => (
              <Chip
                key={g}
                label={g}
                selected={goals.includes(g)}
                onPress={() => setGoals((prev) => prev.includes(g) ? prev.filter((v) => v !== g) : [...prev, g])}
              />
            ))}
          </Reveal>
          <Reveal index={3} style={sm.buildBtn}>
            <PillButton
              label={goals.length > 0 ? 'Build my workspace' : 'Skip for now'}
              variant={goals.length > 0 ? 'primary' : 'secondary'}
              haptic={false}
              onPress={() => goNext()}
            />
          </Reveal>
        </ScrollView>
      );

      // Step 6: Personalized plan recommendation
      if (step === SELLER_STEP_INDEX.PLAN) return (
        planPrepDone ? (
          <SellerPlanRecommendationStep
            brandStage={brandStage}
            goals={goals}
            selectedPlanId={selectedPlanId}
            onSelect={setSelectedPlanId}
            onContinue={() => goNext()}
          />
        ) : (
          <SellerPreviewStep
            brandName={brandName.trim()}
            selectedThemeId={selectedThemeId}
            onSelectTheme={setSelectedThemeId}
            generateSample={async (style) => {
              const account = await api.auth.sync({ name: firstName.trim() });
              if (account.accountType === 'buyer') {
                throw new Error('This account is already set up as a buyer.');
              }
              await api.auth.updateProfile({ accountType: 'seller' });
              return api.logo.onboardingSample(brandName.trim(), style);
            }}
            onContinue={() => setPlanPrepDone(true)}
          />
        )
      );

      // Step 7: Loading
      if (step === SELLER_STEP_INDEX.LOADING) return (
        <LoadingAnimation steps={SELLER_LOADING_STEPS} onDone={() => transitionTo(SELLER_STEP_INDEX.NOTIFICATIONS, 1)} />
      );

      // Step 8: Notifications
      if (step === SELLER_STEP_INDEX.NOTIFICATIONS) return (
        <NotificationsStep
          flow="seller"
          onEnable={() => transitionTo(SELLER_STEP_INDEX.SUCCESS, 1)}
          onSkip={() => transitionTo(SELLER_STEP_INDEX.SUCCESS, 1)}
        />
      );

      // Step 9: Success
      if (step === SELLER_STEP_INDEX.SUCCESS) return (
        <SuccessScreen flow="seller" firstName={firstName} brandName={brandName} onFinish={finishSeller} finishing={finishing} />
      );
    }

    return null;
  }

  const isWelcomeStep = step === BUYER_STEP_INDEX.WELCOME;
  const isFullScreen = isWelcomeStep
                     || (flow === 'buyer' && step >= BUYER_STEP_INDEX.LOADING)
                     || (flow === 'seller' && step >= SELLER_STEP_INDEX.LOADING);

  const isAccountTypeStep = step === BUYER_STEP_INDEX.ACCOUNT_TYPE;
  const isAuthStep = (flow === 'buyer' && step === BUYER_STEP_INDEX.AUTH)
                   || (flow === 'seller' && step === SELLER_STEP_INDEX.AUTH);

  // Show Continue button in footer (not auth, not goals, not full-screen, not account type)
  const showFooter = !isFullScreen
    && !isAuthStep
    && !isAccountTypeStep
    && !(flow === 'seller' && (step === SELLER_STEP_INDEX.GOALS || step === SELLER_STEP_INDEX.PLAN));

  function footerButtonLabel(): string {
    if (flow && isStepSkippable(flow, step)) {
      if (flow === 'buyer' && step === BUYER_STEP_INDEX.STYLE) {
        return styleInterests.length > 0 ? 'Continue' : 'Skip for now';
      }
      if (flow === 'buyer' && step === BUYER_STEP_INDEX.BRANDS) {
        return 'Continue';
      }
    }
    return 'Continue';
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
        <View pointerEvents="none" style={sm.backgroundDim} />
        <StatusBar barStyle="light-content" />
        {/* Brief on-brand hold while the session resolves: the mark and a thread beginning to sew. */}
        <View accessible accessibilityLabel="Loading" style={sm.bootWrap}>
          <BrandthreadLogo size={44} />
          <ThreadDraw height={36} color={theme.text} duration={1100} style={sm.bootThread} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar barStyle="light-content" />

      {/* The thread weaves behind each headline as screens hand off. */}
      {!isFullScreen && (
        <ThreadWeave
          stepKey={`${flow ?? 'choose'}-${step}`}
          direction={transitionDirection.current}
          color={theme.text}
          style={[sm.weave, { top: insets.top + 44 }]}
        />
      )}

      {/* Standard header for form steps */}
      {!isFullScreen && (
        <View style={[sm.header, { paddingTop: insets.top + 8 }]}>
          {!isAccountTypeStep && (
            <PressableScale
              style={sm.backBtn}
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather name="chevron-left" size={20} color={FG} />
            </PressableScale>
          )}

          {showsProgressBar() && (
            <View style={{ flex: 1 }}>
              <StepDots current={progressSteps().current} total={progressSteps().total} />
            </View>
          )}
        </View>
      )}

      {/* Full-screen steps retain an unobtrusive progress signal */}
      {isFullScreen && showsProgressBar() && (
        <View
          pointerEvents="none"
          style={[sm.progressOverlay, { paddingTop: insets.top + 8 }]}
        >
          <StepDots current={progressSteps().current} total={progressSteps().total} />
        </View>
      )}

      {/* Step content */}
      <Animated.View style={[
        sm.stepWrap,
        (isAccountTypeStep || isFullScreen) && sm.accountTypeStepWrap,
        isAuthStep && sm.interactiveStepWrap,
        {
          opacity: transitionProgress,
          transform: [{
            translateX: transitionProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [transitionDirection.current * 28, 0],
            }),
          }],
        },
      ]} testID={`onboarding-step-${flow ?? 'choose'}-${step}`} accessibilityLabel={`Onboarding ${flow ?? 'choose'} step ${step}`}>
        {renderStep()}
      </Animated.View>
      {deviceProbeEnabled && (
        <View pointerEvents="none" style={sm.deviceProbeMetric}>
          <View
            accessible
            testID="onboarding-transition-metric"
            accessibilityLabel={deviceTransitionMetric}
          />
          <View
            accessible
            testID="onboarding-focus-metric"
            accessibilityLabel={deviceFocusMetric}
          />
        </View>
      )}

      {/* Footer Continue button */}
      {showFooter && (
        <LinearGradient
          colors={[`${theme.background}00`, theme.background]}
          locations={[0, 0.35]}
          style={[sm.footer, { paddingBottom: insets.bottom + 16 }]}
        >
          <PrimaryButton
            label={footerButtonLabel()}
            onPress={() => goNext()}
            disabled={!canContinue()}
            haptic={false}
          />
        </LinearGradient>
      )}
    </View>
  );
}

const createSm = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const BORDER = theme.border;
  return StyleSheet.create({
  deviceProbeControl: { position: 'absolute', right: 0, bottom: 0, width: 2, height: 2, opacity: 0.01 },
  deviceProbeMetric: { position: 'absolute', width: 1, height: 1, opacity: 0.01 },
  header:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: SPACE.sm, gap: SPACE.sm, zIndex: 3 },
  progressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.lg,
    paddingBottom: 8,
  },
  backBtn:   { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  weave:     { position: 'absolute', left: 0, right: 0, zIndex: 0, opacity: 0.9 },
  stepWrap:  { flex: 1, paddingHorizontal: SPACE.lg },
  interactiveStepWrap: { position: 'relative', zIndex: 2 },
  accountTypeStepWrap: { paddingHorizontal: 0 },
  footer:    { paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg, marginTop: -SPACE.lg },
  backgroundDim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(7,7,15,0.34)',
  },
  bootWrap:  { alignItems: 'center', gap: SPACE.md, width: 160 },
  bootThread:{ width: 160 },

  scroll:    { flexGrow: 1, paddingTop: SPACE.xs, paddingBottom: SPACE.xxl },
  inputWrap: { marginTop: SPACE.xl },
  chipGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.xl, marginBottom: SPACE.md },
  radioList: { gap: SPACE.sm, marginTop: SPACE.xl },
  buildBtn:  { marginTop: SPACE.xs },
  });
};
