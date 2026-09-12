/**
 * Brandthread Onboarding — complete buyer + seller flows
 *
 * BUYER  steps: 0=Auth 1=AccountType 2=Name 3=Style 4=Loading 5=Notifications 6=Success
 * SELLER steps: 0=Auth 1=AccountType 2=Name 3=BrandName 4=Stage 5=Goals 6=Plan 7=Loading 8=Notifications 9=Success
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
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
import AnimatedGradientBackground from '@/components/branding/AnimatedGradientBackground';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { hydrateMyProfileFromAccount, socialKeysForUser } from '@/services/socialService';
import { DEFAULT_BUYER_PROFILE, saveBuyerProfileForUser } from '@/lib/buyerProfile';
import { SellerPlanRecommendationStep } from '@/components/onboarding/SellerPlanRecommendationStep';
import { recommendSellerPlan } from '@/lib/sellerPlans';
import type { SellerPlanId } from '@/lib/sellerBilling';
import { registerGrantedPushToken } from '@/lib/contextualPushPermission';
import { BG } from '@/lib/theme';
import {
  APPLE_OAUTH_STRATEGY,
  isOAuthCancellationError,
  isOAuthFlowComplete,
  makeBrandthreadRedirectUri,
  mapOAuthError,
} from '@/lib/oauthFlow';

// ─── Palette ────────────────────────────────────────────────────────────────
const CARD    = 'rgba(255,255,255,0.045)';
const BORDER  = 'rgba(255,255,255,0.09)';
const GREEN   = '#34D399';
const FG      = '#FFFFFF';
const MUTED   = 'rgba(255,255,255,0.45)';
const MUTED2  = 'rgba(255,255,255,0.25)';
const INPUT_BG = 'rgba(255,255,255,0.07)';
const INPUT_BD = 'rgba(255,255,255,0.12)';
const ERR     = '#F87171';

const { width: SW } = Dimensions.get('window');

// ─── Data ───────────────────────────────────────────────────────────────────
const STYLE_INTERESTS = [
  'Streetwear', 'Luxury', 'Vintage', 'Athleisure', 'Basics',
  'Accessories', 'Sneakers', 'Denim', 'Graphic tees', 'Minimal',
  'Avant-garde', 'Sustainable fashion',
];

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

const BUYER_LOADING_STEPS  = ['Learning your style', 'Curating your Thread', 'Finding brands you\'ll love', 'Finishing your profile'];
const SELLER_LOADING_STEPS = ['Mapping your brand workspace', 'Preparing your product pipeline', 'Connecting your growth tools', 'Finishing your dashboard'];

const LEGACY_DRAFT_KEY = 'onboarding_draft';
const DRAFT_KEY_PREFIX = 'onboarding_draft:';
const DRAFT_VERSION = 5;

const BUYER_STEP_INDEX = {
  AUTH: 0,
  ACCOUNT_TYPE: 1,
  NAME: 2,
  STYLE: 3,
  LOADING: 4,
  NOTIFICATIONS: 5,
  SUCCESS: 6,
} as const;

const SELLER_STEP_INDEX = {
  AUTH: 0,
  ACCOUNT_TYPE: 1,
  NAME: 2,
  BRAND_NAME: 3,
  BRAND_STAGE: 4,
  GOALS: 5,
  PLAN: 6,
  LOADING: 7,
  NOTIFICATIONS: 8,
  SUCCESS: 9,
} as const;

function draftKeyForUser(userId?: string | null): string | null {
  return userId ? `${DRAFT_KEY_PREFIX}${userId}` : null;
}

type Flow = 'buyer' | 'seller';

// Drafts from before Auth became the literal first onboarding step need a
// one-time translation so closing the app still resumes at the equivalent
// screen. Version 1 seller drafts also had a removed product-model step.
function restoreDraftStep(flow: Flow, step: number, version?: number): number {
  if (version === DRAFT_VERSION) return step;

  if (version === 4) {
    const previousStep = flow === 'buyer'
      ? [BUYER_STEP_INDEX.AUTH, BUYER_STEP_INDEX.ACCOUNT_TYPE, BUYER_STEP_INDEX.NAME, BUYER_STEP_INDEX.STYLE, BUYER_STEP_INDEX.LOADING, BUYER_STEP_INDEX.NOTIFICATIONS, BUYER_STEP_INDEX.SUCCESS]
      : [SELLER_STEP_INDEX.AUTH, SELLER_STEP_INDEX.ACCOUNT_TYPE, SELLER_STEP_INDEX.NAME, SELLER_STEP_INDEX.BRAND_NAME, SELLER_STEP_INDEX.BRAND_STAGE, SELLER_STEP_INDEX.GOALS, SELLER_STEP_INDEX.LOADING, SELLER_STEP_INDEX.NOTIFICATIONS, SELLER_STEP_INDEX.SUCCESS];
    return previousStep[step] ?? (flow === 'buyer' ? BUYER_STEP_INDEX.AUTH : SELLER_STEP_INDEX.AUTH);
  }

  if (version === 3) {
    const previousStep = flow === 'buyer'
      ? [BUYER_STEP_INDEX.AUTH, BUYER_STEP_INDEX.NAME, BUYER_STEP_INDEX.STYLE, BUYER_STEP_INDEX.LOADING, BUYER_STEP_INDEX.NOTIFICATIONS, BUYER_STEP_INDEX.SUCCESS]
      : [SELLER_STEP_INDEX.AUTH, SELLER_STEP_INDEX.NAME, SELLER_STEP_INDEX.BRAND_NAME, SELLER_STEP_INDEX.BRAND_STAGE, SELLER_STEP_INDEX.GOALS, SELLER_STEP_INDEX.LOADING, SELLER_STEP_INDEX.NOTIFICATIONS, SELLER_STEP_INDEX.SUCCESS];
    return previousStep[step] ?? (flow === 'buyer' ? BUYER_STEP_INDEX.AUTH : SELLER_STEP_INDEX.AUTH);
  }

  if (flow === 'buyer') {
    // Previous buyer order: Name, Style, Auth, Loading, Notifications, Success.
    const previousBuyerStep: Record<number, number> = {
      0: BUYER_STEP_INDEX.NAME,
      1: BUYER_STEP_INDEX.STYLE,
      2: BUYER_STEP_INDEX.AUTH,
      3: BUYER_STEP_INDEX.LOADING,
      4: BUYER_STEP_INDEX.NOTIFICATIONS,
      5: BUYER_STEP_INDEX.SUCCESS,
    };
    return previousBuyerStep[step] ?? BUYER_STEP_INDEX.AUTH;
  }

  if (version === 2) {
    // Version 2 seller order: Name, BrandName, Auth, Stage, Goals, Loading,
    // Notifications, Success.
    const previousSellerStep: Record<number, number> = {
      0: SELLER_STEP_INDEX.NAME,
      1: SELLER_STEP_INDEX.BRAND_NAME,
      2: SELLER_STEP_INDEX.AUTH,
      3: SELLER_STEP_INDEX.BRAND_STAGE,
      4: SELLER_STEP_INDEX.GOALS,
      5: SELLER_STEP_INDEX.LOADING,
      6: SELLER_STEP_INDEX.NOTIFICATIONS,
      7: SELLER_STEP_INDEX.SUCCESS,
    };
    return previousSellerStep[step] ?? SELLER_STEP_INDEX.AUTH;
  }

  // Version 1 seller order included a product-model step and put Auth at 5.
  const previousLegacySellerStep: Record<number, number> = {
    0: SELLER_STEP_INDEX.NAME,
    1: SELLER_STEP_INDEX.BRAND_NAME,
    2: SELLER_STEP_INDEX.BRAND_STAGE,
    3: SELLER_STEP_INDEX.GOALS,
    4: SELLER_STEP_INDEX.GOALS,
    5: SELLER_STEP_INDEX.AUTH,
    6: SELLER_STEP_INDEX.LOADING,
    7: SELLER_STEP_INDEX.NOTIFICATIONS,
    8: SELLER_STEP_INDEX.SUCCESS,
  };
  return previousLegacySellerStep[step] ?? SELLER_STEP_INDEX.AUTH;
}

// ─── Clerk error mapper ──────────────────────────────────────────────────────
// Maps Clerk error objects to user-facing strings.
// Uses .code first (most reliable), then conservative message matching.
function mapClerkError(err: any): string {
  if (!err) return 'Something went wrong. Please try again.';

  // Clerk may wrap errors: err.errors[0] or err directly
  const inner = err?.errors?.[0] ?? err;
  const code  = (inner?.code ?? '').toLowerCase();
  const msg   = (inner?.message ?? inner?.longMessage ?? err?.message ?? '').toLowerCase();

  // ── Code-based mapping ───────────────────────────────────────────────────
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

  // ── Conservative message-string fallback ─────────────────────────────────
  // Only match unambiguous phrases — avoids false-positives from the word
  // "identifier" appearing in session-related errors.
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

  // Return raw message as last resort — always better than hiding the error
  return inner?.message || err?.message || 'Something went wrong. Please try again.';
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

function GradientBar({ fraction }: { fraction: number }) {
  const { theme } = useAppTheme();
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <View style={sbar.track}>
      <LinearGradient
        colors={theme.heroGradient}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[sbar.fill, { width: `${Math.round(clamped * 100)}%` }]}
      />
    </View>
  );
}
const sbar = StyleSheet.create({
  track: { height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  fill:  { height: 3, borderRadius: 2 },
});

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      style={[sc.chip, selected && { backgroundColor: theme.accentDim, borderColor: theme.accent, borderWidth: 1.5 }]}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      activeOpacity={0.75}
    >
      <Text style={[sc.chipText, selected && { color: theme.accentLight }]}>{label}</Text>
    </TouchableOpacity>
  );
}
const sc = StyleSheet.create({
  chip:       { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 9 },
  chipText:   { fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
});

function RadioRow({ label, sub, selected, onPress }: { label: string; sub: string; selected: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      style={[sr.row, selected && { borderColor: theme.accent, borderWidth: 1.5, backgroundColor: theme.secondaryDim }]}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      activeOpacity={0.8}
    >
      <View style={{ flex: 1 }}>
        <Text style={[sr.label, selected && sr.labelOn]}>{label}</Text>
        <Text style={sr.sub}>{sub}</Text>
      </View>
      <View style={[sr.circle, selected && { borderColor: theme.accent }]}>
        {selected && <View style={[sr.dot, { backgroundColor: theme.accent }]} />}
      </View>
    </TouchableOpacity>
  );
}
const sr = StyleSheet.create({
  row:     { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label:   { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG, marginBottom: 2 },
  labelOn: { color: FG },
  sub:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 18 },
  circle:  { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dot:     { width: 10, height: 10, borderRadius: 5 },
});

function PrimaryButton({ label, onPress, disabled, loading }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  const { theme } = useAppTheme();
  const onAccentTextStyle = getOnAccentTextStyle(theme);
  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPress} disabled={disabled || loading}>
      {disabled ? (
        <View style={[spb.btn, spb.btnDisabled]}>
          {loading ? <ActivityIndicator color={MUTED} size="small" /> : <Text style={[spb.text, spb.textDisabled]}>{label}</Text>}
        </View>
      ) : (
        <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={spb.btn}>
          {loading ? <ActivityIndicator color={theme.onAccent} size="small" /> : <Text style={[spb.text, onAccentTextStyle]}>{label}</Text>}
        </LinearGradient>
      )}
    </TouchableOpacity>
  );
}
const spb = StyleSheet.create({
  btn:         { borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  btnDisabled: { backgroundColor: 'rgba(255,255,255,0.06)' },
  text:        { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  textDisabled:{ color: MUTED2 },
});

// ─── Loading animation ────────────────────────────────────────────────────────
function LoadingAnimation({ steps, onDone }: { steps: string[]; onDone: () => void }) {
  const { theme } = useAppTheme();
  const insets  = useSafeAreaInsets();
  const [done, setDone]   = useState<boolean[]>(steps.map(() => false));
  const [active, setActive] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.7)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const total = steps.length * 700 + 400;

    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, damping: 14, stiffness: 100, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();

    Animated.timing(progress, { toValue: 1, duration: total - 200, useNativeDriver: false }).start();

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

  return (
    <View style={[sl.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}>
      <AnimatedGradientBackground />

      {/* Logo */}
      <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }], marginBottom: 52 }}>
        <BrandthreadLogo size={72} />
      </Animated.View>

      {/* Steps */}
      <View style={sl.stepsList}>
        {steps.map((label, i) => {
          const isDone = done[i];
          const isActive = active === i && !isDone;
          return (
            <View key={label} style={sl.stepRow}>
              <View style={[sl.stepIcon, isDone && sl.stepIconDone, isActive && { borderColor: theme.accent }]}>
                {isDone ? (
                  <Feather name="check" size={14} color={FG} />
                ) : isActive ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <View style={sl.stepDot} />
                )}
              </View>
              <Text style={[sl.stepLabel, (isDone || isActive) && sl.stepLabelActive]}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Progress bar */}
      <View style={sl.barTrack}>
        <Animated.View
          style={[sl.barFill, {
            width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }]}
        >
          <LinearGradient colors={theme.heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </View>
  );
}
const sl = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  stepsList: { width: '100%', gap: 18, marginBottom: 48 },
  stepRow:   { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepIcon:  {
    width: 30, height: 30, borderRadius: 15,
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepIconDone:   { backgroundColor: GREEN, borderColor: GREEN },
  stepDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: MUTED2 },
  stepLabel:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED },
  stepLabelActive:{ color: FG, fontFamily: 'Inter_500Medium' },
  barTrack: { width: '100%', height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  barFill:  { height: 3, borderRadius: 2, overflow: 'hidden' },
});


// ─── Notifications step ────────────────────────────────────────────────────────
// This is an explanatory consent screen only. The native dialog is intentionally
// deferred until the user has received value from a real action in the app.
function NotificationsStep({ flow, onEnable, onSkip }: { flow: Flow; onEnable: () => void; onSkip: () => void }) {
  const { theme } = useAppTheme();
  const insets  = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const slideY  = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.spring(slideY,  { toValue: 0, damping: 18, stiffness: 110, useNativeDriver: true }),
    ]).start();
  }, []);

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
    <View style={[sn.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]}>
      <AnimatedGradientBackground />

      <Animated.View style={[sn.body, { opacity, transform: [{ translateY: slideY }] }]}>
        {/* Bell icon */}
        <View style={sn.bellWrap}>
          <LinearGradient colors={theme.heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[sn.bellBg, { shadowColor: theme.shadowColor }]}>
            <Feather name="bell" size={32} color={theme.onAccent} />
          </LinearGradient>
        </View>

        <Text style={sn.headline}>Never miss what matters.</Text>
        <Text style={sn.sub}>{desc}</Text>

        {/* Notification examples */}
        <View style={sn.examples}>
          {items.map((item) => (
            <View key={item} style={sn.exampleRow}>
              <View style={[sn.exampleDot, { backgroundColor: theme.accent }]} />
              <Text style={sn.exampleText}>{item}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View style={[sn.btns, { opacity }]}>
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={onEnable}
        >
          <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sn.enableBtn}>
              <Text style={[sn.enableBtnText, getOnAccentTextStyle(theme)]}>
                Continue
              </Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={sn.skipBtn} onPress={onSkip} activeOpacity={0.7}>
          <Text style={sn.skipText}>Not now</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}
const sn = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingHorizontal: 24 },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 40 },
  bellWrap: { marginBottom: 32 },
  bellBg:   { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  headline: { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG, textAlign: 'center', letterSpacing: -0.5, marginBottom: 12 },
  sub:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  examples: { gap: 12, width: '100%' },
  exampleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  exampleDot: { width: 6, height: 6, borderRadius: 3 },
  exampleText:{ fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
  btns: { gap: 12 },
  enableBtn: { borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  enableBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  skipBtn: { paddingVertical: 14, alignItems: 'center' },
  skipText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: MUTED },
});

// ─── Success screen ────────────────────────────────────────────────────────────
function SuccessScreen({ flow, firstName, brandName, onFinish, finishing }: { flow: Flow; firstName: string; brandName: string; onFinish: () => void; finishing?: boolean }) {
  const { theme } = useAppTheme();
  const insets  = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.85)).current;
  const slideY  = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: true }),
      Animated.spring(scale,   { toValue: 1, damping: 16, stiffness: 110, useNativeDriver: true }),
      Animated.spring(slideY,  { toValue: 0, damping: 18, stiffness: 110, useNativeDriver: true }),
    ]).start();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const ctaLabel = flow === 'buyer' ? 'Start exploring' : 'Go to Dashboard';
  const desc = flow === 'buyer'
    ? 'Your next favorite brand is one swipe away.'
    : 'Your brand now has one home for design, production, selling and growth.';

  return (
    <View style={[ss.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]}>
      <AnimatedGradientBackground />

      <Animated.View style={[ss.body, { opacity, transform: [{ scale }, { translateY: slideY }] }]}>
        {/* Checkmark circle */}
        <View>
          <LinearGradient colors={theme.heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[ss.checkCircle, { shadowColor: theme.shadowColor }]}>
            <Feather name="check" size={36} color={theme.onAccent} />
          </LinearGradient>
        </View>

        <Text style={ss.headline}>Welcome to{'\n'}Brandthread.</Text>

        {flow === 'seller' && brandName ? (
          <View style={[ss.brandBadge, { backgroundColor: theme.secondaryDim, borderColor: theme.secondary }]}>
            <Text style={[ss.brandBadgeText, { color: theme.secondary }]}>{brandName}</Text>
          </View>
        ) : null}

        <Text style={ss.desc}>{desc}</Text>

        {/* Feature rows */}
        <View style={ss.features}>
          {(flow === 'buyer'
            ? ['Thread — your personal brand feed', 'Discover drops before they sell out', 'Chat directly with brands', 'Track every order in one place']
            : ['Design Studio & AI tools ready', 'Manufacturer network unlocked', 'Your store is ready to launch', 'Analytics dashboard activated']
          ).map((f) => (
            <View key={f} style={ss.featureRow}>
              <Feather name="check-circle" size={16} color={GREEN} />
              <Text style={ss.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View style={{ opacity }}>
        <PrimaryButton label={finishing ? 'Saving…' : ctaLabel} onPress={onFinish} loading={finishing} />
      </Animated.View>
    </View>
  );
}
const ss = StyleSheet.create({
  root:       { flex: 1, backgroundColor: BG, paddingHorizontal: 24 },
  body:       { flex: 1, justifyContent: 'center' },
  checkCircle:{ width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 28, shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  headline:   { fontSize: 36, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -1, lineHeight: 42, marginBottom: 12 },
  brandBadge: { alignSelf: 'flex-start', borderRadius: 100, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 12, borderWidth: 1 },
  brandBadgeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  desc:       { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 22, marginBottom: 28 },
  features:   { gap: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText:{ fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
});

// ─── Auth step ────────────────────────────────────────────────────────────────
type AuthPhase = 'form' | 'verify' | 'existing-account';

interface AuthStepProps {
  signUp: ReturnType<typeof useSignUp>['signUp'];
  startGoogleOAuth: () => Promise<any>;
  startAppleOAuth: () => Promise<any>;
  onAuthComplete: () => void;
  onDevClear: () => Promise<void>;
  /** The @username the user typed above the auth form. */
  username: string;
  onUsernameChange: (v: string) => void;
  referralCode: string;
  onReferralCodeChange: (v: string) => void;
}

function AuthStep({
  signUp, startGoogleOAuth, startAppleOAuth, onAuthComplete, onDevClear,
  username, onUsernameChange, referralCode, onReferralCodeChange,
}: AuthStepProps) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();

  const [phase, setPhase]               = useState<AuthPhase>('form');
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [code, setCode]                 = useState('');
  const [showPw, setShowPw]             = useState(false);
  const [loading, setLoading]           = useState(false);
  const [oauthLoading, setOAuth]        = useState('');
  const [error, setError]               = useState('');
  const [clearingSession, setClearSession] = useState(false);
  const [usernameError, setUsernameError] = useState('');

  // username format: letters, numbers, underscores only, 3-30 chars
  const USERNAME_REGEX_AUTH = /^[a-zA-Z0-9_]{3,30}$/;
  const isUsernameValid = USERNAME_REGEX_AUTH.test(username.trim());
  const canSubmit = email.includes('@') && password.length >= 8 && isUsernameValid;
  const canVerify = code.length === 6;
  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? '';

  // ── Clear local test session ─────────────────────────────────────────────────
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

  // ── Sign-up ──────────────────────────────────────────────────────────────────
  async function handleSignUp() {
    if (!canSubmit || loading) return;

    // CRITICAL: if a session already exists Clerk returns session_exists, which
    // the old code misclassified as "email already taken". Block this early.
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

  // ── Verify email code ────────────────────────────────────────────────────────
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
            const url = decorateUrl(`/onboarding?postAuth=1${referralQuery}`);
            if (url.startsWith('http') && typeof window !== 'undefined') {
              window.location.href = url;
            } else {
              router.replace('/onboarding' as never);
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

  // ── OAuth ────────────────────────────────────────────────────────────────────
  async function handleOAuth(startFlow: () => Promise<any>, provider: string) {
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

  // ── Active session warning ───────────────────────────────────────────────────
  if (isSignedIn && phase === 'form') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
          <Text style={sa.headline}>Already signed in</Text>
          <Text style={sa.sub}>
            {currentEmail
              ? `You are currently signed in as ${currentEmail}.`
              : 'You are currently signed in.'}
            {'\n\n'}Sign out first to create a new account, or continue with your current account.
          </Text>

          <TouchableOpacity
            style={sa.sessionBtn}
            onPress={handleClearSession}
            disabled={clearingSession}
            activeOpacity={0.85}
          >
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sa.sessionBtnGrad}>
              {clearingSession
                ? <ActivityIndicator color={theme.onAccent} size="small" />
                : <Text style={[sa.sessionBtnText, getOnAccentTextStyle(theme)]}>Sign out and create another account</Text>}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={sa.continueBtn} onPress={onAuthComplete} activeOpacity={0.8}>
            <Text style={sa.continueBtnText}>Continue with current account →</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Existing account panel ──────────────────────────────────────────────────
  if (phase === 'existing-account') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
          <Text style={sa.headline}>Account exists.</Text>
          <Text style={sa.sub}>An account already exists with this email.</Text>

          {/* Email chip */}
          <View style={[sa.existingEmailChip, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
            <Text style={[sa.existingEmailText, { color: theme.accentLight }]}>{email}</Text>
          </View>

          {/* Info card */}
          <View style={[sa.existingCard, { backgroundColor: theme.secondaryDim, borderColor: theme.accentDim }]}>
            <Text style={sa.existingCardTitle}>Sign in to continue your Brandthread journey.</Text>
            <Text style={sa.existingCardSub}>
              Use your existing account to complete setup. Your onboarding answers are saved.
            </Text>
          </View>

          {/* Sign in */}
          <TouchableOpacity
            style={sa.existingSignInBtn}
            onPress={() => router.push('/sign-in' as never)}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={theme.primaryGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={sa.existingSignInGrad}
            >
              <Text style={[sa.existingSignInText, getOnAccentTextStyle(theme)]}>Sign in</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Use different email */}
          <TouchableOpacity
            style={sa.existingDiffBtn}
            onPress={() => { setPhase('form'); setEmail(''); setPassword(''); setError(''); }}
            activeOpacity={0.85}
          >
            <Text style={sa.existingDiffText}>Use a different email</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Email verification ───────────────────────────────────────────────────────
  if (phase === 'verify') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
          <Text style={sa.headline}>Check your email</Text>
          <Text style={sa.sub}>We sent a 6-digit code to {email}</Text>

          <View style={sa.inputWrap}>
            <Text style={sa.label}>Verification code</Text>
            <TextInput
              style={[sa.input, sa.codeInput]}
              placeholder="000000"
              placeholderTextColor={MUTED2}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
          </View>

          {error ? <Text style={sa.error}>{error}</Text> : null}

          <PrimaryButton
            label={loading ? 'Verifying…' : 'Verify email'}
            onPress={handleVerify}
            disabled={!canVerify}
            loading={loading}
          />

          <TouchableOpacity style={sa.resendBtn} onPress={() => signUp.verifications.sendEmailCode()}>
            <Text style={sa.resendText}>{"Didn't get it? "}<Text style={{ color: theme.accentLight }}>Resend</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Sign-up form ─────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
        <Text style={sa.headline}>Create your account</Text>
         <Text style={sa.sub}>One account for everything on Brandthread.</Text>

        {/* Username — collected here so both OAuth and email-password paths get a handle */}
        <View style={sa.inputWrap}>
          <Text style={sa.label}>Choose your @username</Text>
          <TextInput
            testID="onboarding-username-input"
            style={[sa.input, usernameError ? { borderColor: 'rgba(248,113,113,0.5)' } : undefined]}
            placeholder="e.g. alex_style"
            placeholderTextColor={MUTED2}
            value={username}
            editable
            onChangeText={v => {
              // Strip disallowed chars on the fly — no spaces or special characters
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
            ? <Text style={sa.hint}>{usernameError}</Text>
            : username.length > 0
              ? <Text style={sa.hint}>@{username} · letters, numbers, underscores only</Text>
              : <Text style={sa.hint}>Letters, numbers, and underscores only</Text>
          }
        </View>

        <View style={sa.inputWrap}>
          <Text style={sa.label}>Referral code (optional)</Text>
          <TextInput
            testID="onboarding-referral-input"
            style={sa.input}
            placeholder="e.g. FASHION"
            placeholderTextColor={MUTED2}
            value={referralCode}
            editable
            onChangeText={v => onReferralCodeChange(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
          />
          <Text style={sa.hint}>Enter the code from the friend who invited you.</Text>
        </View>

        {/* OAuth — disabled until a valid username is entered */}
        <TouchableOpacity
          style={[sa.oauthBtn, !isUsernameValid && { opacity: 0.45 }]}
          onPress={() => handleOAuth(startGoogleOAuth, 'Google')}
          activeOpacity={0.85}
          disabled={!!oauthLoading || loading || !isUsernameValid}
        >
          {oauthLoading === 'Google' ? <ActivityIndicator color={theme.accentLight} size="small" /> : <>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#4285F4', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: 'Inter_700Bold', fontSize: 11, color: '#FFFFFF', lineHeight: 13 }}>G</Text></View>
            <Text style={sa.oauthText}>Continue with Google</Text>
          </>}
        </TouchableOpacity>

        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={[sa.oauthBtn, sa.appleBtn, !isUsernameValid && { opacity: 0.45 }]}
            onPress={() => handleOAuth(startAppleOAuth, 'Apple')}
            activeOpacity={0.85}
            disabled={!!oauthLoading || loading || !isUsernameValid}
          >
            {oauthLoading === 'Apple' ? <ActivityIndicator color={theme.accentLight} size="small" /> : <>
              <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
              <Text style={[sa.oauthText, { color: '#FFFFFF' }]}>Continue with Apple</Text>
            </>}
          </TouchableOpacity>
        )}

        {/* Divider */}
        <View style={sa.divider}>
          <View style={sa.divLine} />
          <Text style={sa.divText}>or</Text>
          <View style={sa.divLine} />
        </View>

        {/* Email */}
        <View style={sa.inputWrap}>
          <Text style={sa.label}>Email address</Text>
          <TextInput
            style={sa.input}
            placeholder="mila@nightshiftstudio.co"
            placeholderTextColor={MUTED2}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
        </View>

        {/* Password */}
        <View style={sa.inputWrap}>
          <Text style={sa.label}>Password</Text>
          <View style={sa.pwRow}>
            <TextInput
              style={[sa.input, sa.pwInput]}
              placeholder="Minimum 8 characters"
              placeholderTextColor={MUTED2}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoComplete="new-password"
            />
            <TouchableOpacity style={sa.eyeBtn} onPress={() => setShowPw(v => !v)}>
              <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
          {password.length > 0 && password.length < 8 && (
            <Text style={sa.hint}>Use at least 8 characters</Text>
          )}
        </View>

        {error ? <Text style={sa.error}>{error}</Text> : null}

        <PrimaryButton
          label={loading ? 'Creating account…' : 'Create account'}
          onPress={handleSignUp}
          disabled={!canSubmit}
          loading={loading}
        />

        <Text style={sa.legal}>
          By continuing you agree to our{' '}
          <Text style={{ color: theme.accentLight }} onPress={() => Linking.openURL('https://brandthread.app/terms')}>Terms</Text>
          {' and '}
          <Text style={{ color: theme.accentLight }} onPress={() => Linking.openURL('https://brandthread.app/privacy')}>Privacy Policy</Text>.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const sa = StyleSheet.create({
  scroll:    { flexGrow: 1, paddingVertical: 8, gap: 0 },
  headline:  { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.5, marginBottom: 6 },
  sub:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 24 },
  oauthBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingVertical: 14, backgroundColor: CARD, marginBottom: 10 },
  // Apple button: solid black per Apple Human Interface Guidelines
  appleBtn:  { backgroundColor: '#000000', borderColor: 'rgba(255,255,255,0.15)' },
  oauthText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  divider:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 18 },
  divLine:   { flex: 1, height: 1, backgroundColor: BORDER },
  divText:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  inputWrap: { marginBottom: 14 },
  label:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 6 },
  input:     { backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: 'Inter_400Regular', color: FG },
  codeInput: { letterSpacing: 8, fontSize: 22, textAlign: 'center', fontFamily: 'Inter_700Bold' },
  pwRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD, borderRadius: 12 },
  pwInput:   { flex: 1, borderWidth: 0, backgroundColor: 'transparent' },
  eyeBtn:    { paddingHorizontal: 14 },
  hint:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 4 },
  error:     { color: ERR, fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 12 },
  resendBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  resendText:{ fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED },
  legal:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED2, textAlign: 'center', lineHeight: 18, marginTop: 14 },
  // Existing-account panel
  existingEmailChip: {
    alignSelf: 'flex-start',
    borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 7, marginBottom: 20,
  },
  existingEmailText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  existingCard: {
    borderRadius: 16, borderWidth: 1,
    padding: 18, marginBottom: 24,
  },
  existingCardTitle: {
    fontSize: 17, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 8, lineHeight: 23,
  },
  existingCardSub: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 20,
  },
  existingSignInBtn:  { marginBottom: 10, borderRadius: 14, overflow: 'hidden' },
  existingSignInGrad: { paddingVertical: 17, alignItems: 'center', borderRadius: 14 },
  existingSignInText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  existingDiffBtn: {
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  existingDiffText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  // Active-session warning
  sessionBtn:     { marginTop: 8, marginBottom: 12, borderRadius: 16, overflow: 'hidden' },
  sessionBtnGrad: { paddingVertical: 17, alignItems: 'center', paddingHorizontal: 20 },
  sessionBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  continueBtn:    { paddingVertical: 14, alignItems: 'center' },
  continueBtnText:{ fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
});

// ─── Main onboarding component ────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { theme } = useAppTheme();
  const { isSignedIn, signOut, isLoaded: authLoaded } = useAuth();
  const { user, isLoaded: userLoaded }                = useUser();
  const { signUp }              = useSignUp();
  const { startSSOFlow } = useSSO();
  const startGoogleOAuth = useCallback(() => startSSOFlow({ strategy: 'oauth_google', redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri) }), [startSSOFlow]);
  const startAppleOAuth  = useCallback(() => startSSOFlow({ strategy: APPLE_OAUTH_STRATEGY, redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri) }), [startSSOFlow]);
  const api = useApi();

  const router  = useRouter();
  const { postAuth, referralCode: referralCodeParam } = useLocalSearchParams<{ postAuth?: string; referralCode?: string }>();
  const insets  = useSafeAreaInsets();

  const [flow, setFlow]           = useState<Flow | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<AccountType | null>(null);
  const [step, setStep]           = useState(0);
  const [ready, setReady]         = useState(false);

  // Buyer data
  const [firstName, setFirstName]         = useState('');
  const [username, setUsername]           = useState('');
  const [referralCode, setReferralCode]   = useState(
    typeof referralCodeParam === 'string'
      ? referralCodeParam.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
      : '',
  );
  const [styleInterests, setStyleArr]     = useState<string[]>([]);

  // Seller data
  const [brandName, setBrandName]         = useState('');
  const [brandStage, setBrandStage]       = useState('');
  const [goals, setGoals]                 = useState<string[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<SellerPlanId>('starter');

  const [finishing, setFinishing]         = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const restoredDraft = useRef(false);

  // Clerk may take longer than local storage to initialize in a web preview.
  // Never let that delay preselect a role before an account exists.
  useEffect(() => {
    const fallback = setTimeout(() => {
      setReady(true);
    }, 1200);
    return () => clearTimeout(fallback);
  }, []);

  // ── Restore draft for the active account ─────────────────────────────────────
  useEffect(() => {
    // Wait until Clerk has resolved a signed-in identity before choosing the
    // one-time restore key. The independent timeout above covers the web
    // preview without letting it commit a restore for an unknown account.
    if (!authLoaded || (isSignedIn && !userLoaded)) return;
    if (isSignedIn && !user?.id) return;
    if (restoredDraft.current) return;
    restoredDraft.current = true;

    async function init() {
      try {
        const signedInUserId = user?.id;
        const draftKey = draftKeyForUser(signedInUserId);
        // Discard the old global draft rather than risking restoration into a
        // different account on a shared device. Onboarding answers are only
        // persisted after Clerk identifies the user under their own key.
        await AsyncStorage.removeItem(LEGACY_DRAFT_KEY);
        const values = draftKey
          ? await AsyncStorage.multiGet([draftKey])
          : [];
        const draftVal = draftKey ? values.find(([key]) => key === draftKey)?.[1] : null;

        if (draftVal) {
          try {
            const draft = JSON.parse(draftVal);
            if (draft.flow && draft.ownerId === signedInUserId) {
              setFlow(draft.flow);
              setSelectedFlow(draft.flow);
              setStep(restoreDraftStep(draft.flow, draft.step ?? 0, draft.version));
              setFirstName(draft.firstName ?? '');
              setUsername(draft.username ?? '');
              setStyleArr(draft.styleInterests ?? []);
              setBrandName(draft.brandName ?? '');
              setBrandStage(draft.brandStage ?? '');
              setGoals(draft.goals ?? []);
              setSelectedPlanId(draft.selectedPlanId ?? recommendSellerPlan(draft.brandStage ?? '', draft.goals ?? []).planId);
            }
          } catch { /* bad json, ignore */ }
        }
      } catch {
        // Local persistence is optional; a storage issue must not block signup.
      } finally {
        setReady(true);
      }
    }
    init();
  }, [authLoaded, userLoaded, isSignedIn, user?.id]);

  // ── Persist draft ───────────────────────────────────────────────────────────
  const saveDraft = useCallback(async (overrides?: Record<string, unknown>) => {
    const userId = user?.id;
    const draftKey = draftKeyForUser(userId);
    if (!draftKey || !userId) return;
    const data = {
      version: DRAFT_VERSION,
      ownerId: userId,
      flow, step, firstName, username, styleInterests, brandName, brandStage, goals, selectedPlanId,
      ...overrides,
    };
    await AsyncStorage.setItem(draftKey, JSON.stringify(data));
  }, [flow, step, firstName, username, styleInterests, brandName, brandStage, goals, selectedPlanId, user?.id]);

  // Persist onboarding answers under the authenticated user's immutable ID.
  useEffect(() => {
    if (!user?.id || !ready || !flow) return;
    saveDraft().catch(() => {});
  }, [user?.id, ready, flow, saveDraft]);

  // ── Auth completion handler (OAuth/native without remount) ──────────────────
  const handleAuthComplete = useCallback(() => {
    setStep(flow
      ? flow === 'buyer' ? BUYER_STEP_INDEX.NAME : SELLER_STEP_INDEX.NAME
      : BUYER_STEP_INDEX.ACCOUNT_TYPE);
  }, [flow]);

  // Email verification can reload the web route while Clerk finalizes. The
  // route marker guarantees account type is still the immediate next screen.
  useEffect(() => {
    if (ready && isSignedIn && postAuth === '1' && !flow) {
      setStep(BUYER_STEP_INDEX.ACCOUNT_TYPE);
    }
  }, [flow, isSignedIn, postAuth, ready]);

  // ── Watch for OAuth isSignedIn change ────────────────────────────────────────
  const prevSignedIn = useRef<boolean | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (prevSignedIn.current === null) { prevSignedIn.current = isSignedIn ?? false; return; }
    if (!prevSignedIn.current && isSignedIn) {
      setStep(flow
        ? flow === 'buyer' ? BUYER_STEP_INDEX.NAME : SELLER_STEP_INDEX.NAME
        : BUYER_STEP_INDEX.ACCOUNT_TYPE);
    }
    prevSignedIn.current = isSignedIn ?? false;
  }, [isSignedIn, ready, flow]);

  // ── Navigation helpers ──────────────────────────────────────────────────────
  function animateTo(next: number, dir: 1 | -1) {
    Animated.timing(slideAnim, { toValue: dir * -SW, duration: 220, useNativeDriver: true }).start(() => {
      setStep(next);
      slideAnim.setValue(dir * SW);
      Animated.timing(slideAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    });
  }

  function goNext(overrideStep?: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = overrideStep ?? step + 1;
    saveDraft({ step: next });
    animateTo(next, 1);
  }

  function goBack() {
    if (step === 0) { router.back(); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTo(step - 1, -1);
  }

  async function continueFromAccountType() {
    if (!selectedFlow) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = selectedFlow === 'buyer'
      ? BUYER_STEP_INDEX.NAME
      : SELLER_STEP_INDEX.NAME;
    await AsyncStorage.multiSet([
      ['user_role', selectedFlow],
      [ONBOARDING_KEY, 'false'],
    ]);
    setFlow(selectedFlow);
    await saveDraft({ flow: selectedFlow, step: next });
    animateTo(next, 1);
  }

  // ── Finish handlers ─────────────────────────────────────────────────────────
  async function finishBuyer() {
    if (finishing) return;
    setFinishing(true);
    try {
      const name = firstName.trim();
      const uname = username.trim().toLowerCase();
      const profile = await api.auth.sync({ name });
      const updated = await api.auth.updateProfile({
        name,
        displayName: name,
        accountType: 'buyer',
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
        await api.referrals.apply(referralCode.trim()).catch(() => {
          // Referral attribution is optional and must not strand account setup.
        });
      }
      // Style interests improve recommendations but are not required identity
      // data, so a temporary failure must not strand account creation.
      if (styleInterests.length > 0) {
        await api.seller.saveOnboardingData({ styleInterests }).catch(() => {});
      }
      // Commit completion only after every required server/profile write above
      // succeeds. AuthGate can then safely restore this role on another device.
      await api.auth.completeOnboarding('buyer');
      await AsyncStorage.multiSet([
        [ONBOARDING_KEY, 'true'],
        [ONBOARDING_OWNER_KEY, profile.clerkId],
        ['user_role', 'buyer'],
        ['onboarding_first_name', firstName],
        ['onboarding_style_interests', JSON.stringify(styleInterests)],
      ]);
      await AsyncStorage.multiRemove([draftKeyForUser(profile.clerkId)!, LEGACY_DRAFT_KEY]);
      // Preserve registration for people who granted access in a prior install
      // or device setting without showing a prompt during onboarding.
      void registerGrantedPushToken(profile.clerkId, api);
      router.replace('/(buyer)/' as never);
    } catch {
      setFinishing(false);
      Alert.alert(
        'Setup incomplete',
        "We couldn\u2019t save your preferences. Check your connection and try again.",
        [{ text: 'Retry', onPress: finishBuyer }],
      );
    }
  }

  async function finishSeller() {
    if (finishing) return;
    setFinishing(true);
    try {
      const name = firstName.trim();
      const uname = username.trim().toLowerCase();
      const profile = await api.auth.sync({ name });
      // This is the actual seller profile write. The previous flow only
      // stored these answers locally and called the optional questionnaire API.
      await api.auth.onboarding({
        brandName: brandName.trim(),
        brandStage,
        ...(uname ? { username: uname } : {}),
      });
      await api.auth.updateProfile({
        name,
        displayName: name,
        accountType: 'seller',
      });
      if (referralCode.trim()) {
        await api.referrals.apply(referralCode.trim()).catch(() => {
          // The server makes valid referral application atomic and idempotent.
        });
      }
      // Brand profile data — critical; surface error if it fails
      if (goals.length > 0 || brandStage) {
        await api.seller.saveOnboardingData({ goals, brandStage });
      }
      // Seller brand/profile writes are now complete; make completion the final
      // durable server transition before writing device-local routing state.
      await api.auth.completeOnboarding('seller');
      await AsyncStorage.multiSet([
        [ONBOARDING_KEY, 'true'],
        [ONBOARDING_OWNER_KEY, profile.clerkId],
        ['user_role', 'seller'],
        ['onboarding_first_name', firstName],
        ['onboarding_brand_name', brandName],
        ['onboarding_brand_stage', brandStage],   // read by plans.tsx for tier recommendation
        ['onboarding_goals', JSON.stringify(goals)],
        ['onboarding_selected_plan', selectedPlanId],
      ]);
      await AsyncStorage.multiRemove([draftKeyForUser(profile.clerkId)!, LEGACY_DRAFT_KEY]);
      // This only registers an existing grant; it never asks the OS here.
      void registerGrantedPushToken(profile.clerkId, api);
      // Seed the AI brand memory in the background so the assistant has real
      // context on the seller's stage/goals from day one — non-blocking
      api.ai.brandMemoryRebuild().catch(() => {});
      router.replace('/(tabs)/' as never);
    } catch {
      setFinishing(false);
      Alert.alert(
        'Setup incomplete',
        "We couldn\u2019t save your brand profile. Check your connection and try again.",
        [{ text: 'Retry', onPress: finishSeller }],
      );
    }
  }

  // ── Developer reset ─────────────────────────────────────────────────────────
  // Signs out of Clerk, wipes all local test state. Does NOT delete backend accounts.
  async function devReset() {
    try { if (isSignedIn) await signOut(); } catch {}
    await AsyncStorage.multiRemove([
      ONBOARDING_KEY, ONBOARDING_OWNER_KEY, 'user_role', LEGACY_DRAFT_KEY,
      ...(user?.id ? [draftKeyForUser(user.id)!] : []),
      'onboarding_first_name', 'onboarding_brand_name',
      'onboarding_style_interests', 'splash_seen',
    ]);
    router.replace('/splash' as never);
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function canContinue(): boolean {
    if (step === BUYER_STEP_INDEX.AUTH) return true;
    if (step === BUYER_STEP_INDEX.ACCOUNT_TYPE) return !!selectedFlow;
    if (!flow) return false;
    if (flow === 'buyer') {
      if (step === BUYER_STEP_INDEX.NAME) return firstName.trim().length >= 2;
      if (step === BUYER_STEP_INDEX.STYLE) return true;
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

  // ── Progress bar ────────────────────────────────────────────────────────────
  function showsProgressBar(): boolean {
    return true;
  }

  function progressFraction(): number {
    const progressFlow = flow ?? selectedFlow;
    const total = progressFlow === 'buyer' ? 7 : 10;
    return Math.min(1, (step + 1) / total);
  }

  function progressLabel(): string {
    const progressFlow = flow ?? selectedFlow;
    if (!progressFlow) {
      return step === BUYER_STEP_INDEX.AUTH ? 'Step 1' : 'Step 2';
    }
    const total = progressFlow === 'buyer' ? 7 : 10;
    if (step >= total - 1) return 'Complete';
    if (step === total - 2) return 'Almost done';
    return `Step ${step + 1} of ${total}`;
  }

  // ── Step rendering ──────────────────────────────────────────────────────────
  function renderStep() {
    if (step === BUYER_STEP_INDEX.AUTH) return (
      <AuthStep
        signUp={signUp}
        startGoogleOAuth={startGoogleOAuth}
        startAppleOAuth={startAppleOAuth}
        onAuthComplete={handleAuthComplete}
        onDevClear={devReset}
        username={username}
        onUsernameChange={setUsername}
        referralCode={referralCode}
        onReferralCodeChange={setReferralCode}
      />
    );

    if (step === BUYER_STEP_INDEX.ACCOUNT_TYPE && !flow) return (
      <AccountTypeStep
        selected={selectedFlow}
        onSelect={setSelectedFlow}
        onContinue={() => { void continueFromAccountType(); }}
        embedded
      />
    );

    if (!flow) return null;

    /* ─── BUYER STEPS ─── */
    if (flow === 'buyer') {
      // Step 2: Name
      if (step === BUYER_STEP_INDEX.NAME) return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={sm.scroll} keyboardShouldPersistTaps="handled">
            <Text style={sm.stepHeadline}>What should{'\n'}we call you?</Text>
            <Text style={sm.stepSub}>This is how your profile will appear.</Text>
            <View style={sm.inputWrap}>
              <Text style={sm.label}>First name</Text>
              <TextInput
                style={sm.input}
                placeholder="Alex"
                placeholderTextColor={MUTED2}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                autoFocus
                maxLength={40}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      );

      // Step 3: Style interests
      if (step === BUYER_STEP_INDEX.STYLE) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <Text style={sm.stepHeadline}>What do you{'\n'}want to see?</Text>
          <Text style={sm.stepSub}>Pick a few for better recommendations. You can skip this for now.</Text>
          <View style={sm.chipGrid}>
            {STYLE_INTERESTS.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={styleInterests.includes(item)}
                onPress={() => setStyleArr((prev) => prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item])}
              />
            ))}
          </View>
        </ScrollView>
      );

      // Step 4: Loading
      if (step === BUYER_STEP_INDEX.LOADING) return (
        <LoadingAnimation steps={BUYER_LOADING_STEPS} onDone={() => { setStep(BUYER_STEP_INDEX.NOTIFICATIONS); }} />
      );

      // Step 5: Notifications
      if (step === BUYER_STEP_INDEX.NOTIFICATIONS) return (
        <NotificationsStep
          flow="buyer"
          onEnable={() => { setStep(BUYER_STEP_INDEX.SUCCESS); }}
          onSkip={() => setStep(BUYER_STEP_INDEX.SUCCESS)}
        />
      );

      // Step 6: Success
      if (step === BUYER_STEP_INDEX.SUCCESS) return (
        <SuccessScreen flow="buyer" firstName={firstName} brandName="" onFinish={finishBuyer} finishing={finishing} />
      );
    }

    /* ─── SELLER STEPS ─── */
    if (flow === 'seller') {
      // Step 2: Name
      if (step === SELLER_STEP_INDEX.NAME) return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={sm.scroll} keyboardShouldPersistTaps="handled">
            <Text style={sm.stepHeadline}>What should{'\n'}we call you?</Text>
            <Text style={sm.stepSub}>This is how your workspace will greet you.</Text>
            <View style={sm.inputWrap}>
              <Text style={sm.label}>First name</Text>
              <TextInput
                style={sm.input}
                placeholder="Alex"
                placeholderTextColor={MUTED2}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                autoFocus
                maxLength={40}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      );

      // Step 3: Brand name
      if (step === SELLER_STEP_INDEX.BRAND_NAME) return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={sm.scroll} keyboardShouldPersistTaps="handled">
            <Text style={sm.stepHeadline}>What are you{'\n'}building?</Text>
            <Text style={sm.stepSub}>Use your current name, a working name, or change it later.</Text>
            <View style={sm.inputWrap}>
              <Text style={sm.label}>Brand name</Text>
              <TextInput
                style={sm.input}
                placeholder="e.g. Noir Collective"
                placeholderTextColor={MUTED2}
                value={brandName}
                onChangeText={setBrandName}
                autoCapitalize="words"
                autoFocus
                maxLength={60}
              />
              <Text style={sm.inputHint}>Brandthread AI will use this to shape your workspace.</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      );

      // Step 4: Brand stage
      if (step === SELLER_STEP_INDEX.BRAND_STAGE) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <Text style={sm.stepHeadline}>Where is your{'\n'}brand today?</Text>
          <Text style={sm.stepSub}>We'll tailor your workspace to your stage.</Text>
          <View style={sm.radioList}>
            {BRAND_STAGES.map((s) => (
              <RadioRow
                key={s.value}
                label={s.label}
                sub={s.sub}
                selected={brandStage === s.value}
                onPress={() => setBrandStage(s.value)}
              />
            ))}
          </View>
        </ScrollView>
      );

      // Step 5: Goals
      if (step === SELLER_STEP_INDEX.GOALS) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <Text style={sm.stepHeadline}>What do you{'\n'}need help with?</Text>
          <Text style={sm.stepSub}>Choose what matters right now, or skip and personalize later.</Text>
          <View style={sm.chipGrid}>
            {SELLER_GOALS.map((g) => (
              <Chip
                key={g}
                label={g}
                selected={goals.includes(g)}
                onPress={() => setGoals((prev) => prev.includes(g) ? prev.filter((v) => v !== g) : [...prev, g])}
              />
            ))}
          </View>
          <TouchableOpacity
            style={sm.buildBtn}
            onPress={() => goNext()}
          >
            <LinearGradient
              colors={theme.primaryGradient}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={sm.buildBtnInner}
            >
              <Text style={[sm.buildBtnText, getOnAccentTextStyle(theme)]}>
                {goals.length > 0 ? 'Build my workspace' : 'Skip for now'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      );

      // Step 6: Personalized plan recommendation
      if (step === SELLER_STEP_INDEX.PLAN) return (
        <SellerPlanRecommendationStep
          brandStage={brandStage}
          goals={goals}
          selectedPlanId={selectedPlanId}
          onSelect={setSelectedPlanId}
          onContinue={() => goNext()}
        />
      );

      // Step 7: Loading
      if (step === SELLER_STEP_INDEX.LOADING) return (
        <LoadingAnimation steps={SELLER_LOADING_STEPS} onDone={() => setStep(SELLER_STEP_INDEX.NOTIFICATIONS)} />
      );

      // Step 7: Notifications
      if (step === SELLER_STEP_INDEX.NOTIFICATIONS) return (
        <NotificationsStep
          flow="seller"
          onEnable={() => { setStep(SELLER_STEP_INDEX.SUCCESS); }}
          onSkip={() => setStep(SELLER_STEP_INDEX.SUCCESS)}
        />
      );

      // Step 8: Success
      if (step === SELLER_STEP_INDEX.SUCCESS) return (
        <SuccessScreen flow="seller" firstName={firstName} brandName={brandName} onFinish={finishSeller} finishing={finishing} />
      );
    }

    return null;
  }

  // Loading, notification, and success screens keep their full-screen layout,
  // while a compact progress overlay remains visible through completion.
  const isFullScreen = (flow === 'buyer' && step >= BUYER_STEP_INDEX.LOADING)
                     || (flow === 'seller' && step >= SELLER_STEP_INDEX.LOADING);

  const isAuthStep = step === 0;
  const isAccountTypeStep = step === BUYER_STEP_INDEX.ACCOUNT_TYPE && !flow;
  const hasOwnBackground = isFullScreen || isAccountTypeStep;

  // ── Show Continue button in footer (not auth, not goals, not full-screen) ───
  const showFooter = !isFullScreen
    && !isAuthStep
    && !isAccountTypeStep
    && !(flow === 'seller' && (step === SELLER_STEP_INDEX.GOALS || step === SELLER_STEP_INDEX.PLAN));

  function footerButtonLabel(): string {
    if (flow === 'buyer' && step === BUYER_STEP_INDEX.STYLE) {
      return styleInterests.length > 0 ? 'Continue' : 'Skip for now';
    }
    return 'Continue';
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <AnimatedGradientBackground />
        <View pointerEvents="none" style={sm.backgroundDim} />
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {!hasOwnBackground && <AnimatedGradientBackground />}
      {!hasOwnBackground && <View pointerEvents="none" style={sm.backgroundDim} />}
      <StatusBar barStyle="light-content" />

      {/* Standard header for form/auth steps. */}
      {!isFullScreen && (
        <View style={[sm.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={sm.backBtn}
            onPress={goBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Feather name="chevron-left" size={22} color={MUTED} />
          </TouchableOpacity>

          {showsProgressBar() && (
            <View style={{ flex: 1, marginRight: 10 }}>
              <GradientBar fraction={progressFraction()} />
            </View>
          )}
          {showsProgressBar() && (
            <Text style={sm.progressLabel}>{progressLabel()}</Text>
          )}
        </View>
      )}

      {/* Full-screen steps retain an unobtrusive progress signal. */}
      {isFullScreen && showsProgressBar() && (
        <View
          pointerEvents="none"
          style={[sm.progressOverlay, { paddingTop: insets.top + 8 }]}
        >
          <View style={{ flex: 1, marginRight: 10 }}>
            <GradientBar fraction={progressFraction()} />
          </View>
          <Text style={sm.progressLabel}>{progressLabel()}</Text>
        </View>
      )}

      {/* Step content */}
      <Animated.View style={[
        sm.stepWrap,
        isAccountTypeStep && sm.accountTypeStepWrap,
        isAuthStep ? sm.interactiveStepWrap : { transform: [{ translateX: slideAnim }] },
      ]}>
        {renderStep()}
      </Animated.View>

      {/* Footer Continue button */}
      {showFooter && (
        <View style={[sm.footer, { paddingBottom: insets.bottom + 16 }]}>
          <PrimaryButton
            label={footerButtonLabel()}
            onPress={() => goNext()}
            disabled={!canContinue()}
          />
        </View>
      )}

      {/* Dev reset (5-tap on header logo area) */}
    </View>
  );
}

const sm = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 8, zIndex: 3 },
  progressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  backBtn:   { width: 36, height: 36, justifyContent: 'center' },
  progressLabel: { width: 64, fontSize: 11, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'right' },
  stepWrap:  { flex: 1, paddingHorizontal: 24 },
  interactiveStepWrap: { position: 'relative', zIndex: 2 },
  accountTypeStepWrap: { paddingHorizontal: 0 },
  footer:    { paddingHorizontal: 24, paddingTop: 12 },
  backgroundDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7,7,15,0.34)',
  },

  scroll:    { flexGrow: 1, paddingTop: 12, paddingBottom: 40 },
  stepHeadline: { fontSize: 32, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.8, lineHeight: 38, marginBottom: 8 },
  stepSub:   { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 21, marginBottom: 28 },
  inputWrap: { gap: 4 },
  label:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 6 },
  input:     { backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: 'Inter_400Regular', color: FG },
  inputHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED2, marginTop: 6 },
  chipGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  radioList: { gap: 10 },
  selectionHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', marginTop: 8 },
  buildBtn:  { marginTop: 8 },
  buildBtnDisabled: { opacity: 0.5 },
  buildBtnInner: { borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  buildBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  buildBtnTextDisabled: { color: MUTED2 },
});
