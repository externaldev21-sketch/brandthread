/**
 * Brandthread Onboarding — complete buyer + seller flows
 *
 * NEW STEP ORDER (v6):
 * BOTH:   0=AccountType (buyer/seller choice, before Clerk account creation)
 * BUYER:  1=Auth  2=Name  3=Style  4=Loading  5=Notifications  6=Success
 * SELLER: 1=Auth  2=Name  3=BrandName  4=BrandStage  5=Goals  6=Plan  7=Loading  8=Notifications  9=Success
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
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
import { SCREEN_BG } from '@/lib/theme';
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
const DRAFT_VERSION = 6;

// ─── Step indices (v6 order: AccountType first, then path-specific auth) ──────
const BUYER_STEP_INDEX = {
  ACCOUNT_TYPE: 0,
  AUTH: 1,
  NAME: 2,
  STYLE: 3,
  LOADING: 4,
  NOTIFICATIONS: 5,
  SUCCESS: 6,
} as const;

const SELLER_STEP_INDEX = {
  ACCOUNT_TYPE: 0,
  AUTH: 1,
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

function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && APP_THEME_PRESETS.some((preset) => preset.id === value);
}

/**
 * Drafts from before v6 need a one-time translation.
 * v6: AccountType=0, Auth=1, then path-specific steps 2+
 * v5: Auth=0, AccountType=1, then path-specific steps 2+
 * v4: Same order as v5 but without PLAN step in seller
 * v1-v3: various older orders
 */
function restoreDraftStep(flow: Flow, step: number, version?: number): number {
  if (version === DRAFT_VERSION) return step;

  // v5 → v6: AccountType moved from 1 to 0, Auth moved from 0 to 1; steps 2+ unchanged
  if (version === 5) {
    if (flow === 'buyer') {
      // v5: 0=Auth, 1=AccountType, 2=Name, 3=Style, 4=Loading, 5=Notifications, 6=Success
      // v6: 0=AccountType, 1=Auth, 2=Name, 3=Style, 4=Loading, 5=Notifications, 6=Success
      const v5ToBuyer: Record<number, number> = {
        0: BUYER_STEP_INDEX.AUTH,
        1: BUYER_STEP_INDEX.ACCOUNT_TYPE,
        2: BUYER_STEP_INDEX.NAME,
        3: BUYER_STEP_INDEX.STYLE,
        4: BUYER_STEP_INDEX.LOADING,
        5: BUYER_STEP_INDEX.NOTIFICATIONS,
        6: BUYER_STEP_INDEX.SUCCESS,
      };
      return v5ToBuyer[step] ?? BUYER_STEP_INDEX.ACCOUNT_TYPE;
    }
    // v5 seller: 0=Auth, 1=AccountType, 2=Name, 3=BrandName, 4=BrandStage, 5=Goals, 6=Plan, 7=Loading, 8=Notifications, 9=Success
    const v5ToSeller: Record<number, number> = {
      0: SELLER_STEP_INDEX.AUTH,
      1: SELLER_STEP_INDEX.ACCOUNT_TYPE,
      2: SELLER_STEP_INDEX.NAME,
      3: SELLER_STEP_INDEX.BRAND_NAME,
      4: SELLER_STEP_INDEX.BRAND_STAGE,
      5: SELLER_STEP_INDEX.GOALS,
      6: SELLER_STEP_INDEX.PLAN,
      7: SELLER_STEP_INDEX.LOADING,
      8: SELLER_STEP_INDEX.NOTIFICATIONS,
      9: SELLER_STEP_INDEX.SUCCESS,
    };
    return v5ToSeller[step] ?? SELLER_STEP_INDEX.ACCOUNT_TYPE;
  }

  if (version === 4) {
    const previousStep = flow === 'buyer'
      ? [BUYER_STEP_INDEX.AUTH, BUYER_STEP_INDEX.ACCOUNT_TYPE, BUYER_STEP_INDEX.NAME, BUYER_STEP_INDEX.STYLE, BUYER_STEP_INDEX.LOADING, BUYER_STEP_INDEX.NOTIFICATIONS, BUYER_STEP_INDEX.SUCCESS]
      : [SELLER_STEP_INDEX.AUTH, SELLER_STEP_INDEX.ACCOUNT_TYPE, SELLER_STEP_INDEX.NAME, SELLER_STEP_INDEX.BRAND_NAME, SELLER_STEP_INDEX.BRAND_STAGE, SELLER_STEP_INDEX.GOALS, SELLER_STEP_INDEX.LOADING, SELLER_STEP_INDEX.NOTIFICATIONS, SELLER_STEP_INDEX.SUCCESS];
    return previousStep[step] ?? (flow === 'buyer' ? BUYER_STEP_INDEX.ACCOUNT_TYPE : SELLER_STEP_INDEX.ACCOUNT_TYPE);
  }

  if (version === 3) {
    const previousStep = flow === 'buyer'
      ? [BUYER_STEP_INDEX.AUTH, BUYER_STEP_INDEX.NAME, BUYER_STEP_INDEX.STYLE, BUYER_STEP_INDEX.LOADING, BUYER_STEP_INDEX.NOTIFICATIONS, BUYER_STEP_INDEX.SUCCESS]
      : [SELLER_STEP_INDEX.AUTH, SELLER_STEP_INDEX.NAME, SELLER_STEP_INDEX.BRAND_NAME, SELLER_STEP_INDEX.BRAND_STAGE, SELLER_STEP_INDEX.GOALS, SELLER_STEP_INDEX.LOADING, SELLER_STEP_INDEX.NOTIFICATIONS, SELLER_STEP_INDEX.SUCCESS];
    return previousStep[step] ?? (flow === 'buyer' ? BUYER_STEP_INDEX.ACCOUNT_TYPE : SELLER_STEP_INDEX.ACCOUNT_TYPE);
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
    return previousBuyerStep[step] ?? BUYER_STEP_INDEX.ACCOUNT_TYPE;
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
    return previousSellerStep[step] ?? SELLER_STEP_INDEX.ACCOUNT_TYPE;
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
  return previousLegacySellerStep[step] ?? SELLER_STEP_INDEX.ACCOUNT_TYPE;
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
 * Minimal step-dot indicator.
 * Uses only existing palette references — no new color literals.
 */
function StepDots({ current, total }: { current: number; total: number }) {
  const { theme } = useAppTheme();
  return (
    <View style={sdots.row} accessibilityLabel={`Step ${current + 1} of ${total}`}>
      {Array.from({ length: total }).map((_, i) => {
        const filled = i <= current;
        const active = i === current;
        return (
          <View
            key={i}
            style={[
              sdots.dot,
              active && { width: 18 },
            ]}
          >
            {filled && (
              <LinearGradient
                colors={theme.heroGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}
const sdots = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
});

/**
 * Style-interest chip with solid-fill selected state and checkmark.
 * Selected: solid accent-dim background, accent border, checkmark + label.
 */
function StyleChip({ label, emoji, selected, onPress }: { label: string; emoji: string; selected: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      style={[
        ssc.chip,
        selected && { backgroundColor: theme.accentDim, borderColor: theme.accent, borderWidth: 1.5 },
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      activeOpacity={0.75}
    >
      <Text style={ssc.emoji}>{emoji}</Text>
      {selected && <Feather name="check" size={11} color={theme.accentLight} style={{ marginRight: 1 }} />}
      <Text style={[ssc.chipText, selected && { color: theme.accentLight }]}>{label}</Text>
    </TouchableOpacity>
  );
}
const ssc = StyleSheet.create({
  chip:     { backgroundColor: CARD, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER, borderRadius: 100, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  emoji:    { fontSize: 14 },
  chipText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
});

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      style={[sc.chip, selected && { backgroundColor: theme.accentDim, borderColor: theme.accent, borderWidth: 1.5 }]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      activeOpacity={0.75}
    >
      <Text style={[sc.chipText, selected && { color: theme.accentLight }]}>{label}</Text>
    </TouchableOpacity>
  );
}
const sc = StyleSheet.create({
  chip:       { backgroundColor: CARD, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 9 },
  chipText:   { fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
});

function RadioRow({ label, sub, selected, onPress }: { label: string; sub: string; selected: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      style={[sr.row, selected && { borderColor: theme.accent, borderWidth: 1.5, backgroundColor: theme.secondaryDim }]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
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
  row:     { backgroundColor: CARD, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label:   { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG, marginBottom: 2 },
  labelOn: { color: FG },
  sub:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 18 },
  circle:  { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dot:     { width: 9, height: 9, borderRadius: 5 },
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
  btn:         { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
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
  root: { flex: 1, backgroundColor: SCREEN_BG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
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
  root: { flex: 1, backgroundColor: SCREEN_BG, paddingHorizontal: 24 },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 32 },
  bellWrap: { marginBottom: 28 },
  bellBg:   { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  headline: { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG, textAlign: 'center', letterSpacing: -0.5, marginBottom: 10 },
  sub:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  examples: { gap: 11, width: '100%' },
  exampleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  exampleDot: { width: 6, height: 6, borderRadius: 3 },
  exampleText:{ fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
  btns: { gap: 10 },
  enableBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  enableBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  skipBtn: { paddingVertical: 13, alignItems: 'center' },
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
  root:       { flex: 1, backgroundColor: SCREEN_BG, paddingHorizontal: 24 },
  body:       { flex: 1, justifyContent: 'center' },
  checkCircle:{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 24, shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  headline:   { fontSize: 34, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -1, lineHeight: 40, marginBottom: 10 },
  brandBadge: { alignSelf: 'flex-start', borderRadius: 100, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 10, borderWidth: 1 },
  brandBadgeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  desc:       { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 22, marginBottom: 24 },
  features:   { gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText:{ fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
});

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
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();

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

          <PrimaryButton label={loading ? 'Creating account…' : 'Create account'} onPress={handleSignUp} disabled={!canSubmit} loading={loading} />

          <Text style={sba.legal}>
            By continuing you agree to our{' '}
            <Text style={{ color: theme.accentLight }} onPress={() => Linking.openURL('https://brandthread.app/terms')}>Terms</Text>
            {' and '}
            <Text style={{ color: theme.accentLight }} onPress={() => Linking.openURL('https://brandthread.app/privacy')}>Privacy Policy</Text>.
          </Text>
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

        {/* Google row */}
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

        {/* Apple row — iOS only */}
        {Platform.OS === 'ios' && (
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

        <Text style={sba.legal}>
          By continuing you agree to our{' '}
          <Text style={{ color: theme.accentLight }} onPress={() => Linking.openURL('https://brandthread.app/terms')}>Terms</Text>
          {' and '}
          <Text style={{ color: theme.accentLight }} onPress={() => Linking.openURL('https://brandthread.app/privacy')}>Privacy Policy</Text>.
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Seller Auth Step — single-column labeled form ────────────────────────────
type SellerAuthPhase = 'form' | 'verify' | 'existing-account';

interface SellerAuthStepProps {
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
}

function SellerAuthStep({
  signUp, startGoogleOAuth, startAppleOAuth, onAuthComplete, onDevClear,
  username, onUsernameChange, referralCode, onReferralCodeChange,
  onFirstNamePrefill, onLastNamePrefill,
}: SellerAuthStepProps) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();

  const [phase, setPhase]             = useState<SellerAuthPhase>('form');
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

  const USERNAME_REGEX_AUTH = /^[a-zA-Z0-9_]{3,30}$/;
  const isUsernameValid = USERNAME_REGEX_AUTH.test(username.trim());
  const passwordsMatch = password === confirmPassword;
  const canSubmit = email.includes('@') && password.length >= 8 && passwordsMatch && isUsernameValid && formFirstName.trim().length >= 1;
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
    if (!passwordsMatch) { setError('Passwords do not match.'); return; }
    if (isSignedIn) {
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

  // Already signed in
  if (isSignedIn && phase === 'form') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={ssa.scroll} keyboardShouldPersistTaps="handled">
          <Text style={ssa.headline}>Already signed in</Text>
          <Text style={ssa.sub}>
            {currentEmail ? `You are currently signed in as ${currentEmail}.` : 'You are currently signed in.'}
            {'\n\n'}Sign out first to create a new account, or continue with your current account.
          </Text>
          <TouchableOpacity style={ssa.sessionBtn} onPress={handleClearSession} disabled={clearingSession} activeOpacity={0.85}>
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={ssa.sessionBtnGrad}>
              {clearingSession
                ? <ActivityIndicator color={theme.onAccent} size="small" />
                : <Text style={[ssa.sessionBtnText, getOnAccentTextStyle(theme)]}>Sign out and create another account</Text>}
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={ssa.continueBtn} onPress={onAuthComplete} activeOpacity={0.8}>
            <Text style={ssa.continueBtnText}>Continue with current account →</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Existing account
  if (phase === 'existing-account') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={ssa.scroll} keyboardShouldPersistTaps="handled">
          <Text style={ssa.headline}>Account exists.</Text>
          <Text style={ssa.sub}>An account already exists with this email.</Text>
          <View style={[ssa.existingEmailChip, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
            <Text style={[ssa.existingEmailText, { color: theme.accentLight }]}>{email}</Text>
          </View>
          <View style={[ssa.existingCard, { backgroundColor: theme.secondaryDim, borderColor: theme.accentDim }]}>
            <Text style={ssa.existingCardTitle}>Sign in to continue your Brandthread journey.</Text>
            <Text style={ssa.existingCardSub}>Use your existing account to complete setup. Your onboarding answers are saved.</Text>
          </View>
          <TouchableOpacity style={ssa.existingSignInBtn} onPress={() => router.replace('/sign-in' as never)} activeOpacity={0.88}>
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={ssa.existingSignInGrad}>
              <Text style={[ssa.existingSignInText, getOnAccentTextStyle(theme)]}>Sign in</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={ssa.existingDiffBtn} onPress={() => { setPhase('form'); setEmail(''); setPassword(''); setConfirm(''); setError(''); }} activeOpacity={0.85}>
            <Text style={ssa.existingDiffText}>Use a different email</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Verification
  if (phase === 'verify') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={ssa.scroll} keyboardShouldPersistTaps="handled">
          <Text style={ssa.headline}>Check your email</Text>
          <Text style={ssa.sub}>We sent a 6-digit code to {email}</Text>
          <View style={ssa.inputWrap}>
            <Text style={ssa.label}>Verification code</Text>
            <TextInput
              style={[ssa.input, ssa.codeInput]}
              placeholder="000000"
              placeholderTextColor={MUTED2}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
          </View>
          {error ? <Text style={ssa.error}>{error}</Text> : null}
          <PrimaryButton label={loading ? 'Verifying…' : 'Verify email'} onPress={handleVerify} disabled={!canVerify} loading={loading} />
          <TouchableOpacity style={ssa.resendBtn} onPress={() => signUp.verifications.sendEmailCode()}>
            <Text style={ssa.resendText}>{"Didn't get it? "}<Text style={{ color: theme.accentLight }}>Resend</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Main seller sign-up form: single-column labeled fields
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={ssa.scroll} keyboardShouldPersistTaps="handled">
        <Text style={ssa.headline}>Create your account</Text>
        <Text style={ssa.sub}>Build your brand on Brandthread.</Text>

        {/* Email */}
        <View style={ssa.inputWrap}>
          <Text style={ssa.label}>Email address</Text>
          <TextInput
            style={ssa.input}
            placeholder="brand@yourstudio.co"
            placeholderTextColor={MUTED2}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
        </View>

        {/* First name */}
        <View style={ssa.inputWrap}>
          <Text style={ssa.label}>First name</Text>
          <TextInput
            style={ssa.input}
            placeholder="Alex"
            placeholderTextColor={MUTED2}
            value={formFirstName}
            onChangeText={setFormFirstName}
            autoCapitalize="words"
            maxLength={40}
          />
        </View>

        {/* Last name */}
        <View style={ssa.inputWrap}>
          <Text style={ssa.label}>Last name</Text>
          <TextInput
            style={ssa.input}
            placeholder="Rivera"
            placeholderTextColor={MUTED2}
            value={formLastName}
            onChangeText={setFormLastName}
            autoCapitalize="words"
            maxLength={40}
          />
        </View>

        {/* Password */}
        <View style={ssa.inputWrap}>
          <Text style={ssa.label}>Password</Text>
          <View style={ssa.pwRow}>
            <TextInput
              style={[ssa.input, ssa.pwInput]}
              placeholder="Minimum 8 characters"
              placeholderTextColor={MUTED2}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoComplete="new-password"
            />
            <TouchableOpacity style={ssa.eyeBtn} onPress={() => setShowPw(v => !v)}>
              <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
          {password.length > 0 && password.length < 8 && (
            <Text style={ssa.hint}>Use at least 8 characters</Text>
          )}
        </View>

        {/* Confirm password */}
        <View style={ssa.inputWrap}>
          <Text style={ssa.label}>Confirm password</Text>
          <View style={ssa.pwRow}>
            <TextInput
              style={[ssa.input, ssa.pwInput, !passwordsMatch && confirmPassword.length > 0 ? { borderColor: ERR } : undefined]}
              placeholder="Re-enter password"
              placeholderTextColor={MUTED2}
              value={confirmPassword}
              onChangeText={setConfirm}
              secureTextEntry={!showConfirm}
              autoComplete="new-password"
            />
            <TouchableOpacity style={ssa.eyeBtn} onPress={() => setShowConfirm(v => !v)}>
              <Feather name={showConfirm ? 'eye-off' : 'eye'} size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
          {!passwordsMatch && confirmPassword.length > 0 && (
            <Text style={[ssa.hint, { color: ERR }]}>Passwords do not match</Text>
          )}
        </View>

        {/* Divider */}
        <View style={ssa.divider}>
          <View style={ssa.divLine} />
          <Text style={ssa.divText}>optional</Text>
          <View style={ssa.divLine} />
        </View>

        {/* Username */}
        <View style={ssa.inputWrap}>
          <Text style={ssa.label}>Choose your @username</Text>
          <TextInput
            testID="onboarding-username-input"
            style={[ssa.input, usernameError ? { borderColor: ERR } : undefined]}
            placeholder="e.g. noire_collective"
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
            ? <Text style={ssa.hint}>{usernameError}</Text>
            : username.length > 0
              ? <Text style={ssa.hint}>@{username} · letters, numbers, underscores only</Text>
              : <Text style={ssa.hint}>Letters, numbers, and underscores only</Text>}
        </View>

        {/* Referral code */}
        <View style={ssa.inputWrap}>
          <Text style={ssa.label}>Referral code (optional)</Text>
          <TextInput
            testID="onboarding-referral-input"
            style={ssa.input}
            placeholder="e.g. FASHION"
            placeholderTextColor={MUTED2}
            value={referralCode}
            editable
            onChangeText={v => onReferralCodeChange(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
          />
          <Text style={ssa.hint}>Enter the code from the friend who invited you.</Text>
        </View>

        {error ? <Text style={ssa.error}>{error}</Text> : null}

        <PrimaryButton label={loading ? 'Creating account…' : 'Create account'} onPress={handleSignUp} disabled={!canSubmit} loading={loading} />

        {/* OAuth options below the main CTA */}
        <View style={ssa.divider}>
          <View style={ssa.divLine} />
          <Text style={ssa.divText}>or continue with</Text>
          <View style={ssa.divLine} />
        </View>

        <TouchableOpacity
          style={[ssa.oauthBtn, !isUsernameValid && { opacity: 0.45 }]}
          onPress={() => handleOAuth(startGoogleOAuth, 'Google')}
          activeOpacity={0.85}
          disabled={!!oauthLoading || loading || !isUsernameValid}
        >
          {oauthLoading === 'Google' ? <ActivityIndicator color={theme.accentLight} size="small" /> : <>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: 'Inter_700Bold', fontSize: 11, color: FG, lineHeight: 13 }}>G</Text></View>
            <Text style={ssa.oauthText}>Continue with Google</Text>
          </>}
        </TouchableOpacity>

        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={[ssa.oauthBtn, ssa.appleBtn, !isUsernameValid && { opacity: 0.45 }]}
            onPress={() => handleOAuth(startAppleOAuth, 'Apple')}
            activeOpacity={0.85}
            disabled={!!oauthLoading || loading || !isUsernameValid}
          >
            {oauthLoading === 'Apple' ? <ActivityIndicator color={theme.accentLight} size="small" /> : <>
              <Ionicons name="logo-apple" size={20} color={FG} />
              <Text style={[ssa.oauthText, { color: '#FFFFFF' }]}>Continue with Apple</Text>
            </>}
          </TouchableOpacity>
        )}

        <Text style={ssa.legal}>
          By continuing you agree to our{' '}
          <Text style={{ color: theme.accentLight }} onPress={() => Linking.openURL('https://brandthread.app/terms')}>Terms</Text>
          {' and '}
          <Text style={{ color: theme.accentLight }} onPress={() => Linking.openURL('https://brandthread.app/privacy')}>Privacy Policy</Text>.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Shared styles for buyer auth step
const sba = StyleSheet.create({
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

// Shared styles for seller auth step
const ssa = StyleSheet.create({
  scroll:    { flexGrow: 1, paddingVertical: 8, gap: 0 },
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
  divider:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 14 },
  divLine:   { flex: 1, height: 1, backgroundColor: BORDER },
  divText:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  oauthBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER, paddingVertical: 13, backgroundColor: CARD, marginBottom: 9 },
  appleBtn:  { backgroundColor: SCREEN_BG, borderColor: BORDER },
  oauthText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
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
      <Text style={spreview.headline}>Make it feel like yours.</Text>
      <Text style={spreview.sub}>
        Pick a storefront accent, then try one free AI logo sample before choosing a plan.
        Your choices stay editable later.
      </Text>

      <Text style={spreview.sectionLabel}>Storefront accent</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={spreview.themeRow}>
        {APP_THEME_PRESETS.map((preset) => {
          const selected = preset.id === selectedThemeId;
          return (
            <TouchableOpacity
              key={preset.id}
              testID={`onboarding-theme-${preset.id}`}
              style={[spreview.themeCard, selected && { borderColor: preset.accent, borderWidth: 2 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${preset.name} storefront theme`}
              onPress={() => { Haptics.selectionAsync(); onSelectTheme(preset.id); }}
              activeOpacity={0.8}
            >
              <LinearGradient colors={preset.heroGradient} style={spreview.themeSwatch}>
                <View style={[spreview.themeDot, { backgroundColor: preset.accent }]} />
                <View style={[spreview.themeLine, { backgroundColor: preset.secondary }]} />
              </LinearGradient>
              <Text style={spreview.themeName}>{preset.name}</Text>
              {selected ? <Feather name="check-circle" size={14} color={preset.accentLight} /> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <Text style={spreview.hint}>Saved when your seller workspace is created.</Text>

      <View style={spreview.sampleHeader}>
        <View style={{ flex: 1 }}>
          <Text style={spreview.sectionLabel}>One free AI sample</Text>
          <Text style={spreview.sampleSub}>See your brand name as a logo. This calls the real generator.</Text>
        </View>
        <Feather name="zap" size={18} color={theme.accentLight} />
      </View>
      <View style={spreview.styleRow}>
        {LOGO_SAMPLE_STYLES.map((style) => (
          <Chip key={style} label={style} selected={sampleStyle === style} onPress={() => setSampleStyle(style)} />
        ))}
      </View>

      {sampleUri ? (
        <View style={[spreview.resultCard, { borderColor: theme.accent }]}>
          <Image source={{ uri: sampleUri }} style={spreview.resultImage} resizeMode="contain" accessibilityLabel={`${brandName} AI logo sample`} />
          <View style={spreview.resultCaption}>
            <Feather name="check" size={15} color={GREEN} />
            <Text style={spreview.resultText}>Your real AI sample is ready.</Text>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          testID="onboarding-generate-sample"
          activeOpacity={0.88}
          onPress={() => { void handleGenerate(); }}
          disabled={generating}
        >
          <LinearGradient colors={theme.primaryGradient} style={spreview.generateButton}>
            {generating
              ? <ActivityIndicator color={theme.onAccent} />
              : <><Feather name="image" size={18} color={theme.onAccent} /><Text style={[spreview.generateText, getOnAccentTextStyle(theme)]}>Generate free sample</Text></>}
          </LinearGradient>
        </TouchableOpacity>
      )}
      {sampleError ? (
        <View style={spreview.errorBox}>
          <Text style={spreview.errorText}>{sampleError}</Text>
          <TouchableOpacity onPress={() => { void handleGenerate(); }} disabled={generating || !!sampleUri}>
            <Text style={[spreview.retryText, { color: theme.accentLight }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <TouchableOpacity
        testID="onboarding-preview-continue"
        accessibilityRole="button"
        accessibilityLabel={sampleUri ? 'Continue to plans' : 'Skip sample and continue to plans'}
        style={spreview.continueButton}
        onPress={onContinue}
      >
        <Text style={spreview.continueText}>{sampleUri ? 'Continue to plans' : 'Skip sample · Continue to plans'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
const spreview = StyleSheet.create({
  scroll: { flexGrow: 1, paddingBottom: 24 },
  headline: { fontSize: 26, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.5, marginBottom: 6 },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 21, marginBottom: 18 },
  sectionLabel: { fontSize: 13, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 8 },
  themeRow: { gap: 8, paddingRight: 8 },
  themeCard: { width: 98, minHeight: 96, padding: 6, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  themeSwatch: { height: 52, borderRadius: 8, padding: 9, justifyContent: 'space-between' },
  themeDot: { width: 16, height: 16, borderRadius: 8 },
  themeLine: { width: 36, height: 3, borderRadius: 2 },
  themeName: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: FG, marginTop: 6 },
  hint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED2, marginTop: 6, marginBottom: 20 },
  sampleHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  sampleSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 18, paddingRight: 18 },
  styleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  resultCard: { borderRadius: 12, borderWidth: 1, backgroundColor: '#F7F7F7', overflow: 'hidden', marginBottom: 12 },
  resultImage: { width: '100%', height: 180 },
  resultCaption: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(0,0,0,0.86)' },
  resultText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: FG },
  generateButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  generateText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  errorBox: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 8, padding: 10, borderRadius: 9, backgroundColor: 'rgba(248,113,113,0.10)' },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, color: ERR },
  retryText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  continueButton: { marginTop: 14, borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: GREEN },
  continueDisabled: { backgroundColor: 'rgba(255,255,255,0.07)' },
  continueText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#06110B' },
  continueTextDisabled: { color: MUTED2 },
});

// ─── Main onboarding component ────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { theme, selectTheme } = useAppTheme();
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
  // Step 0 = AccountType for both paths (v6 ordering)
  const [step, setStep]           = useState(0);
  const [ready, setReady]         = useState(false);

  // Buyer data
  const [firstName, setFirstName]         = useState('');
  const [lastName, setLastName]           = useState('');
  const [username, setUsername]           = useState('');
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
  const [selectedThemeId, setSelectedThemeId] = useState<AppThemeId>('purple');
  const [planPrepDone, setPlanPrepDone] = useState(false);

  const [finishing, setFinishing]         = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const restoredDraft = useRef(false);

  // Clerk may take longer than local storage to initialize in a web preview.
  useEffect(() => {
    const fallback = setTimeout(() => {
      setReady(true);
    }, 1200);
    return () => clearTimeout(fallback);
  }, []);

  // ── Restore draft for the active account ─────────────────────────────────────
  useEffect(() => {
    if (!authLoaded || (isSignedIn && !userLoaded)) return;
    if (isSignedIn && !user?.id) return;
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
        ]);
        const draftVal = draftKey ? values.find(([key]) => key === draftKey)?.[1] : null;
        const pendingFlow = values.find(([key]) => key === PENDING_FLOW_KEY)?.[1];

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
              setSelectedThemeId(isAppThemeId(draft.selectedThemeId) ? draft.selectedThemeId : 'purple');
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
      } catch {
        // Local persistence is optional; a storage issue must not block signup.
      } finally {
        setReady(true);
      }
    }
    init();
  }, [authLoaded, userLoaded, isSignedIn, postAuth, user?.id]);

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
    saveDraft().catch(() => {});
  }, [user?.id, ready, flow, saveDraft]);

  // ── Auth completion handler (OAuth/native without remount) ──────────────────
  const handleAuthComplete = useCallback(() => {
    // After auth, move to the first post-auth step (Name) for the chosen flow
    if (flow === 'buyer') {
      setStep(BUYER_STEP_INDEX.NAME);
    } else if (flow === 'seller') {
      setStep(SELLER_STEP_INDEX.NAME);
    } else {
      // No flow set yet — go to auth but shouldn't happen in v6 order
      setStep(BUYER_STEP_INDEX.AUTH);
    }
  }, [flow]);

  // Email verification can reload the web route while Clerk finalizes.
  useEffect(() => {
    if (ready && isSignedIn && postAuth === '1' && !flow) {
      // postAuth=1 means we just verified email; step 0 = AccountType was already passed
      // If flow is still null, go to AccountType so user can choose
      setStep(BUYER_STEP_INDEX.ACCOUNT_TYPE);
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
        setStep(BUYER_STEP_INDEX.NAME);
      } else if (flow === 'seller') {
        setStep(SELLER_STEP_INDEX.NAME);
      }
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
    // After AccountType (step 0), go to path-specific Auth (step 1)
    const next = selectedFlow === 'buyer'
      ? BUYER_STEP_INDEX.AUTH
      : SELLER_STEP_INDEX.AUTH;
    await AsyncStorage.multiSet([
      [PENDING_FLOW_KEY, selectedFlow],
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
      // Compose full name from firstName (and optionally lastName if we captured it)
      const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || firstName.trim();
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
        await api.referrals.apply(referralCode.trim()).catch(() => {});
      }
      if (styleInterests.length > 0) {
        await api.seller.saveOnboardingData({ styleInterests }).catch(() => {});
      }
      await api.auth.completeOnboarding('buyer');
      await AsyncStorage.multiSet([
        [ONBOARDING_KEY, 'true'],
        [ONBOARDING_OWNER_KEY, profile.clerkId],
        ['user_role', 'buyer'],
        ['onboarding_first_name', firstName],
        ['onboarding_style_interests', JSON.stringify(styleInterests)],
      ]);
      await AsyncStorage.multiRemove([draftKeyForUser(profile.clerkId)!, LEGACY_DRAFT_KEY]);
      await AsyncStorage.removeItem(PENDING_FLOW_KEY);
      void registerGrantedPushToken(profile.clerkId, api);
      // Route to the feed explainer for first-time buyers
      router.replace('/thread-explainer' as never);
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
      });
      if (referralCode.trim()) {
        await api.referrals.apply(referralCode.trim()).catch(() => {});
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
      await AsyncStorage.removeItem(PENDING_FLOW_KEY);
      void registerGrantedPushToken(profile.clerkId, api);
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
  async function devReset() {
    try { if (isSignedIn) await signOut(); } catch {}
    await AsyncStorage.multiRemove([
      ONBOARDING_KEY, ONBOARDING_OWNER_KEY, 'user_role', LEGACY_DRAFT_KEY, PENDING_FLOW_KEY,
      ...(user?.id ? [draftKeyForUser(user.id)!] : []),
      'onboarding_first_name', 'onboarding_brand_name',
      'onboarding_style_interests', 'splash_seen',
    ]);
    router.replace('/splash' as never);
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function canContinue(): boolean {
    // Step 0 = AccountType: handled by AccountTypeStep's own CTA
    if (step === BUYER_STEP_INDEX.ACCOUNT_TYPE) return !!selectedFlow;
    // Auth step: user can always "continue" (auth has its own internal validation)
    if (flow === 'buyer' && step === BUYER_STEP_INDEX.AUTH) return true;
    if (flow === 'seller' && step === SELLER_STEP_INDEX.AUTH) return true;
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

  // ── Step dots indicator ──────────────────────────────────────────────────────
  function showsProgressBar(): boolean {
    return true;
  }

  function progressSteps(): { current: number; total: number } {
    const progressFlow = flow ?? selectedFlow;
    const total = progressFlow === 'buyer' ? 7 : 10;
    return { current: Math.min(step, total - 1), total };
  }

  // ── Step rendering ──────────────────────────────────────────────────────────
  function renderStep() {
    // Step 0: AccountType (before any auth — buyer/seller choice)
    if (step === BUYER_STEP_INDEX.ACCOUNT_TYPE && !flow) return (
      <AccountTypeStep
        selected={selectedFlow}
        onSelect={setSelectedFlow}
        onContinue={() => { void continueFromAccountType(); }}
        embedded
      />
    );

    // If flow is already set (draft restore) and we're at step 0, still show AccountType
    if (step === 0 && flow) {
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
      // Step 1: Buyer Auth — bold Sign up screen
      if (step === BUYER_STEP_INDEX.AUTH) return (
        <BuyerAuthStep
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

      // Step 3: Style interests — emoji chips with solid-fill selected state
      if (step === BUYER_STEP_INDEX.STYLE) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <Text style={sm.stepHeadline}>What do you{'\n'}want to see?</Text>
          <Text style={sm.stepSub}>Pick a few for better recommendations. You can skip this for now.</Text>
          <View style={sm.chipGrid}>
            {STYLE_INTERESTS_WITH_EMOJI.map(({ label: item, emoji }) => (
              <StyleChip
                key={item}
                label={item}
                emoji={emoji}
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
      // Step 1: Seller Auth — single-column labeled form
      if (step === SELLER_STEP_INDEX.AUTH) return (
        <SellerAuthStep
          signUp={signUp}
          startGoogleOAuth={startGoogleOAuth}
          startAppleOAuth={startAppleOAuth}
          onAuthComplete={handleAuthComplete}
          onDevClear={devReset}
          username={username}
          onUsernameChange={setUsername}
          referralCode={referralCode}
          onReferralCodeChange={setReferralCode}
          onFirstNamePrefill={setFirstName}
          onLastNamePrefill={setLastName}
        />
      );

      // Step 2: Name (pre-filled from auth form)
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
        <LoadingAnimation steps={SELLER_LOADING_STEPS} onDone={() => setStep(SELLER_STEP_INDEX.NOTIFICATIONS)} />
      );

      // Step 8: Notifications
      if (step === SELLER_STEP_INDEX.NOTIFICATIONS) return (
        <NotificationsStep
          flow="seller"
          onEnable={() => { setStep(SELLER_STEP_INDEX.SUCCESS); }}
          onSkip={() => setStep(SELLER_STEP_INDEX.SUCCESS)}
        />
      );

      // Step 9: Success
      if (step === SELLER_STEP_INDEX.SUCCESS) return (
        <SuccessScreen flow="seller" firstName={firstName} brandName={brandName} onFinish={finishSeller} finishing={finishing} />
      );
    }

    return null;
  }

  const isFullScreen = (flow === 'buyer' && step >= BUYER_STEP_INDEX.LOADING)
                     || (flow === 'seller' && step >= SELLER_STEP_INDEX.LOADING);

  const isAccountTypeStep = step === 0;
  const isAuthStep = (flow === 'buyer' && step === BUYER_STEP_INDEX.AUTH)
                   || (flow === 'seller' && step === SELLER_STEP_INDEX.AUTH);

  // Show Continue button in footer (not auth, not goals, not full-screen, not account type)
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
      <View style={{ flex: 1, backgroundColor: SCREEN_BG, alignItems: 'center', justifyContent: 'center' }}>
        <View pointerEvents="none" style={sm.backgroundDim} />
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: SCREEN_BG }}>
      <StatusBar barStyle="light-content" />

      {/* Standard header for form steps */}
      {!isFullScreen && (
        <View style={[sm.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={sm.backBtn}
            onPress={goBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Feather name="chevron-left" size={20} color={MUTED} />
          </TouchableOpacity>

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
    </View>
  );
}

const sm = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8, gap: 10, zIndex: 3 },
  progressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  backBtn:   { width: 32, height: 32, justifyContent: 'center' },
  stepWrap:  { flex: 1, paddingHorizontal: 24 },
  interactiveStepWrap: { position: 'relative', zIndex: 2 },
  accountTypeStepWrap: { paddingHorizontal: 0 },
  footer:    { paddingHorizontal: 24, paddingTop: 8 },
  backgroundDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7,7,15,0.34)',
  },

  scroll:    { flexGrow: 1, paddingTop: 8, paddingBottom: 40 },
  stepHeadline: { fontSize: 32, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.8, lineHeight: 38, marginBottom: 6 },
  stepSub:   { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 21, marginBottom: 20 },
  inputWrap: { gap: 4 },
  label:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 5 },
  input:     { backgroundColor: INPUT_BG, borderWidth: StyleSheet.hairlineWidth, borderColor: INPUT_BD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, fontFamily: 'Inter_400Regular', color: FG },
  inputHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED2, marginTop: 5 },
  chipGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  radioList: { gap: 8 },
  selectionHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', marginTop: 8 },
  buildBtn:  { marginTop: 8 },
  buildBtnDisabled: { opacity: 0.5 },
  buildBtnInner: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  buildBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  buildBtnTextDisabled: { color: MUTED2 },
});
