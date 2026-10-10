import * as Haptics from 'expo-haptics';
/**
 * Brandthread onboarding — one question per screen (v9).
 *
 * Order and rules live in lib/onboardingFlow.ts; resume rules in
 * lib/onboardingDraft.ts. This file owns Clerk, the API writes and which
 * step component renders.
 *
 *   BOTH:   Welcome → "Are you a buyer or a seller?"
 *   BUYER:  Instagram sign-up — email → code → password → birthday → terms →
 *           name → username → profile picture → "Welcome to Brandthread,
 *           @username" → styles → sizes → brands to follow → feed.
 *   SELLER: Shopify onboarding — brand stage → goals → location → the same
 *           account steps → name → brand name → username → "Building your
 *           store" (store preview + one free logo) → plan + free trial →
 *           dashboard.
 *
 * Nothing about payouts or notifications is asked here: payouts live on the
 * dashboard checklist, and push permission is requested at the first
 * follow / order / message (lib/contextualPushPermission.ts).
 *
 * Resume: every change is saved as a draft (password and code excluded), so
 * reopening the app lands on the same step with the same answers.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LegalConsent } from '@/components/legal/LegalConsent';
import { AiGeneratedBadge } from '@/components/AiGeneratedBadge';
import { LegalContinueNotice } from '@/components/legal/LegalConsent';
import { AgeDobField } from '@/components/age/AgeNotices';
import { NativeDateTimeField } from '@/components/ui/NativeDateTimeField';
import { dateToMdy, mdyToDate } from '@/lib/dateTimeField';
import { formatDobInput } from '@/lib/ageGate';
import {
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth, useClerk, useSSO, useSignUp, useUser } from '@clerk/expo';
import { haptics } from '@/lib/haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import { track } from '@/lib/analytics';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { useUsernameLiveCheck } from '@/lib/onboarding/useUsernameLiveCheck';
import { suggestUsername } from '@/lib/onboarding/usernameSuggestion';
import { classifySignUpCreateError, identifierTakenMessage } from '@/lib/onboarding/signUpErrors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { classifySignUpError, clerkErrorParam, existingAccountHeadline, findSessionForEmail } from '@/lib/signUpErrors';
import { hydrateMyProfileFromAccount, socialKeysForUser } from '@/services/socialService';
import { DEFAULT_BUYER_PROFILE, saveBuyerProfileForUser } from '@/lib/buyerProfile';
import { registerGrantedPushToken } from '@/lib/contextualPushPermission';
import { getInstallId } from '@/lib/installId';
import { pickFromLibrary } from '@/lib/pickProfileImage';
import { rememberPendingConsent } from '@/lib/legalConsent';
import { checkDobInput, setPendingDob, submitPendingAge } from '@/lib/ageGate';
import { COUNTRIES } from '@/lib/addressRegions';
import {
  queueBuyerOnboardingSync,
  isRecoverableBuyerOnboardingSyncError,
  syncBuyerOnboarding,
} from '@/lib/buyerOnboardingSync';
import { ApiError } from '@/lib/networkNotice';
import {
  APPLE_OAUTH_STRATEGY,
  oauthProviderVisibility,
  isOAuthCancellationError,
  isOAuthFlowComplete,
  makeBrandthreadRedirectUri,
  mapOAuthError,
} from '@/lib/oauthFlow';
import {
  allStepsFor,
  isAccountStep,
  isStepId,
  nextStepId,
  prevStepId,
  progressFraction,
  DRAFT_VERSION,
  SELLER_QUESTION_STEPS,
  type AuthMethod,
  type Flow,
  type StepId,
} from '@/lib/onboardingFlow';
import {
  PENDING_DRAFT_KEY,
  parseDraft,
  resolveResumeStep,
  sanitizeDraftForStorage,
  userDraftKey,
  type OnboardingDraft,
} from '@/lib/onboardingDraft';
import { EMPTY_SURVEY, hasSurveyAnswers, sanitizeDraftSurvey, saveBuyerSurvey, type OnboardingSurvey } from '@/lib/onboardingSurvey';
import { Icon, Input } from '@/components/ui';
import { WelcomeStep } from '@/components/onboarding/WelcomeStep';
import { BrandsToFollowStep } from '@/components/onboarding/BrandsToFollowStep';
import { SizesStep } from '@/components/onboarding/SizesStep';
import { StepScreen } from '@/components/onboarding/steps/StepScreen';
import { ClearButton } from '@/components/onboarding/steps/FieldAccessories';
import {
  BirthdayStep,
  CodeStep,
  EmailStep,
  PasswordStep,
  TermsStep,
  dobToWheelDate,
  wheelDateToDobInput,
} from '@/components/onboarding/steps/AccountSteps';
import { BrandNameStep, NameStep, PhotoStep, UsernameStep, WelcomeUserStep } from '@/components/onboarding/steps/ProfileSteps';
import {
  BRAND_STAGE_OPTIONS,
  BuildingStoreStep,
  ChoiceCardsStep,
  LocationStep,
  SELLER_GOAL_OPTIONS,
} from '@/components/onboarding/steps/SellerSteps';
import type { WheelDate } from '@/components/onboarding/steps/WheelDatePicker';
import { PlanStep } from '@/components/onboarding/steps/PlanStep';
import { useSellerTrialCheckout } from '@/lib/useSellerTrialCheckout';
import { recommendSellerPlan } from '@/lib/sellerPlans';
import type { SellerPlanId } from '@/lib/sellerBilling';
import { AccountTypeStep, type AccountType } from './account-type';
import { ONBOARDING_KEY, ONBOARDING_OWNER_KEY } from './_layout';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { radius } from '@/constants/radii';

// Required on Android so the in-app browser tab closes after OAuth redirect
WebBrowser.maybeCompleteAuthSession();

// ─── Data ───────────────────────────────────────────────────────────────────
const STYLE_INTERESTS = [
  'Streetwear', 'Luxury', 'Vintage', 'Athleisure', 'Basics', 'Accessories',
  'Sneakers', 'Denim', 'Graphic tees', 'Minimal', 'Avant-garde', 'Sustainable fashion',
];
const DEFAULT_BUYER_INTERESTS = ['Basics', 'Minimal', 'Sustainable fashion'];

/**
 * Set by the web landing page's "Start shopping" / "Start selling" buttons
 * (scripts/landing-page.js). Read once to pre-select that answer on the
 * buyer/seller question, then cleared.
 */
const PENDING_FLOW_KEY = 'onboarding_pending_flow';
/** Device-scoped keys from the previous (v8) flow; cleared so they can't leak into this one. */
const LEGACY_PENDING_KEYS = ['onboarding_draft', PENDING_FLOW_KEY, 'onboarding_pending_username'];

function cleanReferral(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : '';
}

function defaultCountry(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    const region = (locale.split('-').find((part, i) => i > 0 && /^[A-Z]{2}$/.test(part)) ?? '');
    if (COUNTRIES.some((c) => c.value === region)) return region;
  } catch { /* fall through */ }
  return 'US';
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

// ─── Clerk error mapper ──────────────────────────────────────────────────────
function clerkCode(err: any): string {
  const inner = err?.errors?.[0] ?? err;
  return String(inner?.code ?? '').toLowerCase();
}

function mapClerkError(err: any): string {
  if (!err) return 'Something went wrong. Try again.';
  const inner = err?.errors?.[0] ?? err;
  const code = clerkCode(err);
  const msg = String(inner?.message ?? inner?.longMessage ?? err?.message ?? '').toLowerCase();

  if (code === 'form_identifier_exists') return identifierTakenMessage(err) ?? 'Check what you entered and try again.';
  if (code === 'session_exists' || code === 'identifier_already_signed_in') return 'This device is logged in to another account. Log out first.';
  if (code === 'form_password_pwned' || code === 'form_password_strength_insufficient') return 'This password is too common. Choose a stronger one.';
  if (code === 'form_password_length_too_short') return 'Use at least 8 characters.';
  if (code === 'form_param_format_invalid' || code === 'form_param_nil') return msg.includes('email') ? 'Enter a valid email address.' : 'Check what you entered and try again.';
  if (code === 'form_code_incorrect') return "That code isn't right. Check your email and try again.";
  if (code === 'verification_expired') return 'That code expired. Tap "I didn\'t get the code" for a new one.';
  if (code === 'request_rate_limited') return 'Too many attempts. Wait a moment and try again.';
  if (code === 'network_failure' || code === 'request_timeout') return "Couldn't connect. Check your internet and try again.";
  if (code === 'missing_publishable_key' || code === 'publishable_key_invalid') return 'Sign-up is unavailable right now.';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) return "Couldn't connect. Check your internet and try again.";
  if (msg.includes('rate limit') || msg.includes('too many')) return 'Too many attempts. Wait a moment and try again.';
  return inner?.message || err?.message || 'Something went wrong. Try again.';
}

function isUsernameTakenError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && /username/i.test(error.message);
}

// ─── Style chips ─────────────────────────────────────────────────────────────
function StyleChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      testID={`onboarding-style-${label.replace(/\s+/g, '-').toLowerCase()}`}
      style={[styles.chip, { borderColor: selected ? theme.text : 'transparent' }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={() => { haptics.selection(); onPress(); }}
    >
      <Text style={[styles.chipText, { color: selected ? theme.text : theme.muted }]}>{label}</Text>
    </Pressable>
  );
}
const createSsc = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  chip:     { backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, borderRadius: radius.md, minHeight: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  emoji:    { fontSize: 16 },
  chipText: { fontSize: 15, fontFamily: FONT.medium, color: theme.muted },
});

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  const sc = createSc(theme);
  return (
    <PressableScale
      style={[sc.chip, selected && { backgroundColor: theme.accentDim, borderColor: theme.text, borderWidth: 1 }]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => { haptics.selection(); onPress(); }}
    >
      <Text style={[sc.chipText, selected && { color: theme.text }]}>{label}</Text>
      {selected && <Feather name="check" size={13} color={theme.text} />}
    </PressableScale>
  );
}
const createSc = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  chip:       { backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, borderRadius: radius.md, minHeight: 44, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipText:   { fontSize: 15, fontFamily: FONT.medium, color: theme.muted },
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
      onPress={() => { haptics.selection(); onPress(); }}
    >
      <StitchAccent active={selected} color={theme.text} style={sr.stitch} />
      <View style={{ flex: 1 }}>
        <Text style={[sr.label, selected && sr.labelOn]}>{label}</Text>
        <Text style={sr.sub}>{sub}</Text>
      </View>
      <View style={[sr.circle, selected && { borderColor: theme.text }]}>
        {selected && <View style={[sr.dot, { backgroundColor: theme.accent }]} />}
      </View>
    </PressableScale>
  );
}
const createSr = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row:     { backgroundColor: theme.card, borderRadius: RADIUS.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, paddingHorizontal: 18, paddingVertical: 20, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, overflow: 'hidden' },
  stitch:  { position: 'absolute', top: 10, left: 18 },
  label:   { fontSize: 17, lineHeight: 22, fontFamily: FONT.semibold, color: theme.text, marginBottom: 2 },
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
  const headerTopInset = useHeaderTopInset();
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
    <View style={[sl.root, { paddingTop: headerTopInset + SPACE.xxl, paddingBottom: insets.bottom + SPACE.xxl }]}>

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
  stepLabelActive:{ color: FG, fontFamily: FONT.semibold },
  });
};


// ─── Notifications step ────────────────────────────────────────────────────────
function NotificationsStep({ flow, onEnable, onSkip }: { flow: Flow; onEnable: () => void; onSkip: () => void }) {
  const { theme } = useAppTheme();
  const sn = createSn(theme);
  const insets  = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();

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
    <View style={[sn.root, { paddingTop: headerTopInset + SPACE.xxl, paddingBottom: insets.bottom + SPACE.lg }]}>

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
                <View style={[sn.exampleDot, { backgroundColor: theme.accent }]} />
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
  const headerTopInset = useHeaderTopInset();
  const copyDelay = Math.round(MOTION.finaleDrawMs * 0.7);

  const ctaLabel = flow === 'buyer' ? 'Start exploring' : 'Go to Dashboard';
  const desc = flow === 'buyer'
    ? 'Your next favorite brand is one swipe away.'
    : 'Your brand now has one home for design, production, selling and growth.';

  return (
    <View style={[ss.root, { paddingTop: headerTopInset + SPACE.xxl, paddingBottom: insets.bottom + SPACE.lg }]}>
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
            onStitched={() => { haptics.success(); }}
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
  brandBadgeText: { fontSize: 13, fontFamily: FONT.semibold },
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
  const { apple: appleOAuthEnabled, google: googleOAuthEnabled } = oauthProviderVisibility(Platform.OS, {
    apple: useFeatureFlag('oauthAppleEnabled'),
    google: useFeatureFlag('oauthGoogleEnabled'),
  });
  const usernameLiveCheck = useUsernameLiveCheck(username);

  const [phase, setPhase]               = useState<BuyerAuthPhase>('choose');
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [code, setCode]                 = useState('');
  const [showPw, setShowPw]             = useState(false);
  const [loading, setLoading]           = useState(false);
  const [oauthLoading, setOAuth]        = useState('');
  const [error, setError]               = useState('');
  const [clearingSession, setClearSession] = useState(false);
  const buyerReferralRef = useRef<TextInput>(null);
  const buyerEmailRef = useRef<TextInput>(null);
  const buyerPasswordRef = useRef<TextInput>(null);
  const [usernameError, setUsernameError] = useState('');
  // Explicit agreement to the Terms, Community Guidelines and Privacy Policy
  // is required before any account is created (email, Google or Apple).
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [dobText, setDobText] = useState('');
  const [dobError, setDobError] = useState<string | null>(null);
  // Date of birth is validated here and held in memory only; the server keeps just the age band.
  function requireAge(): boolean {
    const check = checkDobInput(dobText, { seller: false });
    if (!check.ok) { setDobError(check.error); setPendingDob(null); return false; }
    setDobError(null);
    setPendingDob(check.dob);
    return true;
  }
  const [consentError, setConsentError] = useState(false);
  function recordConsent() {
    void rememberPendingConsent();
  }
  function requireConsent(): boolean {
    if (!agreedToTerms) {
      setConsentError(true);
      setError('Please agree to the Terms of Service and Community Guidelines to continue.');
      return false;
    }
    recordConsent();
    return true;
  }
  function updateConsent(value: boolean) {
    setAgreedToTerms(value);
    setConsentError(false);
    setError((current) => current.startsWith('Please agree') ? '' : current);
  }

  const USERNAME_REGEX_AUTH = /^[a-zA-Z0-9_]{3,30}$/;
  const isUsernameValid = USERNAME_REGEX_AUTH.test(username.trim());
  const canSubmit = email.includes('@') && password.length >= 8 && isUsernameValid && !usernameLiveCheck.error && !usernameLiveCheck.checking;
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
    if (!requireAge()) return;
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
      track('signup_started', { method: 'email' });
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
        track('signup_completed', { method: 'email' });
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
    if (!requireAge()) return;
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
            <TextInput returnKeyType="done" accessibilityLabel="Verification code"
              style={[sba.input, sba.codeInput]}
              placeholder="000000"
              placeholderTextColor={MUTED2}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
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
            <TextInput accessibilityLabel="Username"
              testID="onboarding-username-input"
              style={[sba.input, (usernameError || usernameLiveCheck.error) ? { borderColor: 'rgba(248,113,113,0.5)' } : undefined]}
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
              autoComplete="username-new"
              textContentType="username"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => buyerReferralRef.current?.focus()}
              maxLength={30}
            />
            {usernameError
              ? <Text style={sba.hint}>{usernameError}</Text>
              : usernameLiveCheck.error
                ? <Text style={sba.hint}>{usernameLiveCheck.error}</Text>
                : usernameLiveCheck.checking
                  ? <Text style={sba.hint}>Checking availability…</Text>
                  : username.length >= 3
                    ? <Text style={sba.hint}>@{username} is available</Text>
                    : username.length > 0
                      ? <Text style={sba.hint}>@{username} · letters, numbers, underscores only</Text>
                      : <Text style={sba.hint}>Letters, numbers, and underscores only</Text>}
          </View>

          <View style={sba.inputWrap}>
            <Text style={sba.label}>Referral code (optional)</Text>
            <TextInput accessibilityLabel="Referral code"
              ref={buyerReferralRef}
              testID="onboarding-referral-input"
              style={sba.input}
              placeholder="e.g. FASHION"
              placeholderTextColor={MUTED2}
              value={referralCode}
              editable
              onChangeText={v => onReferralCodeChange(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => buyerEmailRef.current?.focus()}
              maxLength={12}
            />
            <Text style={sba.hint}>Enter the code from the friend who invited you.</Text>
          </View>

          <View style={sba.inputWrap}>
            <Text style={sba.label}>Email address</Text>
            <TextInput accessibilityLabel="Email"
              ref={buyerEmailRef}
              style={sba.input}
              placeholder="mila@nightshiftstudio.co"
              placeholderTextColor={MUTED2}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => buyerPasswordRef.current?.focus()}
            />
          </View>

          <View style={sba.inputWrap}>
            <Text style={sba.label}>Password</Text>
            <View style={sba.pwRow}>
              <TextInput accessibilityLabel="Password"
                ref={buyerPasswordRef}
                style={[sba.input, sba.pwInput]}
                placeholder="Minimum 8 characters"
                placeholderTextColor={MUTED2}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
              />
              <TouchableOpacity accessibilityLabel={showPw ? 'Hide password' : 'Show password'} accessibilityRole="button" style={sba.eyeBtn} onPress={() => setShowPw(v => !v)}>
                <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={MUTED} />
              </TouchableOpacity>
            </View>
            {password.length > 0 && password.length < 8 && (
              <Text style={sba.hint}>Use at least 8 characters</Text>
            )}
          </View>

          {error ? <Text style={sba.error}>{error}</Text> : null}

          <AgeDobField
            value={dobText}
            onChange={(t) => { setDobText(t); setDobError(null); }}
            error={dobError}
            wrapStyle={sba.inputWrap}
            labelStyle={sba.label}
            inputStyle={sba.input}
            hintStyle={sba.hint}
          />

          <LegalConsent checked={agreedToTerms} onChange={updateConsent} showError={consentError} style={{ marginBottom: 16 }} />

          <PrimaryButton label={loading ? 'Creating account…' : 'Create account'} onPress={handleSignUp} disabled={!canSubmit} loading={loading} />

          <LegalContinueNotice style={{ marginTop: 14 }} />

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

        <AgeDobField
          value={dobText}
          onChange={(t) => { setDobText(t); setDobError(null); }}
          error={dobError}
          wrapStyle={sba.inputWrap}
          labelStyle={sba.label}
          inputStyle={sba.input}
          hintStyle={sba.hint}
        />

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
                    <Text style={{ fontFamily: FONT.bold, fontSize: 12, color: '#FFFFFF', lineHeight: 14 }}>G</Text>
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

        <LegalContinueNotice style={{ marginTop: 12 }} />

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
  const clerk = useClerk();
  const api = useApi();
  const { apple: appleOAuthEnabled, google: googleOAuthEnabled } = oauthProviderVisibility(Platform.OS, {
    apple: useFeatureFlag('oauthAppleEnabled'),
    google: useFeatureFlag('oauthGoogleEnabled'),
  });
  const showAnyOAuth = appleOAuthEnabled || googleOAuthEnabled;
  const usernameLiveCheck = useUsernameLiveCheck(username);

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
  // Set only when Clerk says the EMAIL itself is taken (see lib/signUpErrors).
  const [existingRole, setExistingRole] = useState<'buyer' | 'seller' | null>(null);
  const [existingSessionId, setExistingSessionId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  // Explicit agreement to the Terms, Community Guidelines and Privacy Policy
  // is required before any account is created (email, Google or Apple).
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [dobText, setDobText] = useState('');
  const [dobError, setDobError] = useState<string | null>(null);
  // Date of birth is validated here and held in memory only; the server keeps just the age band.
  function requireAge(): boolean {
    const check = checkDobInput(dobText, { seller: true });
    if (!check.ok) { setDobError(check.error); setPendingDob(null); return false; }
    setDobError(null);
    setPendingDob(check.dob);
    return true;
  }
  const [consentError, setConsentError] = useState(false);
  function recordConsent() {
    void rememberPendingConsent();
  }
  function requireConsent(): boolean {
    if (!agreedToTerms) {
      setConsentError(true);
      setError('Please agree to the Terms of Service and Community Guidelines to continue.');
      return false;
    }
    recordConsent();
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
  const signUpFirstNameRef = useRef<TextInput>(null);
  const signUpLastNameRef = useRef<TextInput>(null);
  const signUpPasswordRef = useRef<TextInput>(null);
  const signUpConfirmRef = useRef<TextInput>(null);
  const signUpUsernameRef = useRef<TextInput>(null);
  const signUpReferralRef = useRef<TextInput>(null);
  const signUpDobRef = useRef<TextInput>(null);
  const canSubmit = email.includes('@') && password.length >= 8 && passwordsMatch && isUsernameValid
    && !usernameLiveCheck.error && !usernameLiveCheck.checking && formFirstName.trim().length >= 1;
  const missingFields: string[] = [];
  if (!email.includes('@')) missingFields.push('a valid email');
  if (formFirstName.trim().length < 1) missingFields.push('your first name');
  if (password.length < 8) missingFields.push('a password (8+ characters)');
  else if (!passwordsMatch) missingFields.push('matching passwords');
  if (!isUsernameValid) missingFields.push('a username');
  else if (usernameLiveCheck.error) missingFields.push('a different username');
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
    if (!requireAge()) return;
    if (!passwordsMatch) { setError('Passwords do not match.'); return; }
    setLoading(true);
    setError('');
    setUsernameError('');
    const emailAddress = email.trim().toLowerCase();
    try {
      // Prefill name fields before account creation so draft restore gets them
      const fn = formFirstName.trim();
      const ln = formLastName.trim();
      onFirstNamePrefill(fn);
      onLastNamePrefill(ln);

      // Always start a fresh sign-up. signUp.password() PATCHes whatever
      // sign-up the client still holds (an attempt abandoned at the code
      // step), so a new email could inherit the old attempt's state.
      let { error: err } = await signUp.create({ emailAddress, password });
      if (err && classifySignUpError(err, '').kind === 'signed-in-elsewhere' && isSignedIn && !allowSignedInAccountCreation) {
        // A leftover session (earlier test, preview, another account) must
        // never block creating a new account: sign it out and go on.
        await signOut();
        ({ error: err } = await signUp.create({ emailAddress, password }));
      }
      if (err) { handleCreateError(err, emailAddress); return; }
      await signUp.verifications.sendEmailCode();
      setPhase('verify');
    } catch (e: any) {
      handleCreateError(e, emailAddress);
    } finally {
      setLoading(false);
    }
  }

  function handleCreateError(err: unknown, emailAddress: string) {
    const outcome = classifySignUpError(err, mapClerkError(err));
    if (outcome.kind === 'email-exists') {
      // Only Clerk naming the email field gets here. If that account is
      // already signed in on this device, "Switch to it" is one tap.
      const session = findSessionForEmail((clerk as any)?.client?.sessions, emailAddress);
      setExistingSessionId(session?.id ?? null);
      setExistingRole(null);
      setPhase('existing-account');
      const ownerId = session?.user?.id;
      if (ownerId) {
        api.auth.accountTypes?.([ownerId])
          .then((res) => {
            const type = res?.accountTypes?.[ownerId]?.accountType;
            setExistingRole(type === 'buyer' || type === 'seller' ? type : null);
          })
          .catch(() => {});
      }
      return;
    }
    if (outcome.kind === 'username-taken') { setUsernameError(outcome.message); return; }
    if (outcome.kind === 'signed-in-elsewhere') { setError(mapClerkError(err)); return; }
    setError(outcome.message);
  }

  async function switchToExistingAccount() {
    if (switching) return;
    if (existingSessionId && clerk?.setActive) {
      setSwitching(true);
      try {
        await clerk.setActive({ session: existingSessionId });
        router.replace('/' as never);
      } catch {
        setSwitching(false);
        setError("Couldn't switch accounts. Try again.");
      }
      return;
    }
    const query = `email=${encodeURIComponent(email.trim().toLowerCase())}${isSignedIn ? '&addAccount=1' : ''}`;
    router.replace(`/sign-in?${query}` as never);
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
    if (!requireAge()) return;
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

  // Existing account: only when Clerk said this EMAIL is taken.
  if (phase === 'existing-account') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={ssa.scroll} keyboardShouldPersistTaps="handled">
          <StepHeadline>{existingAccountHeadline(existingRole)}</StepHeadline>
          <Reveal index={2}>
            <View style={[ssa.existingEmailChip, { borderColor: theme.border }]}>
              <Feather name="mail" size={13} color={theme.muted} />
              <Text style={[ssa.existingEmailText, { color: theme.text }]}>{email}</Text>
            </View>
          </Reveal>
          {error ? <InlineError message={error} /> : null}
          <Reveal index={3} style={ssa.stack}>
            <PillButton label="Switch to it" onPress={switchToExistingAccount} loading={switching} disabled={switching} />
            <TouchableOpacity
              style={ssa.resendBtn}
              accessibilityRole="button"
              onPress={() => { setPhase('form'); setEmail(''); setPassword(''); setConfirm(''); setError(''); setExistingSessionId(null); setExistingRole(null); }}
            >
              <Text style={[ssa.resendText, { color: theme.text }]}>Use a different email</Text>
            </TouchableOpacity>
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
            <Text style={ssa.resendText}>{"Didn't get it? "}<Text style={{ color: theme.text, fontFamily: FONT.semibold }}>Resend</Text></Text>
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
            textContentType="emailAddress"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => signUpFirstNameRef.current?.focus()}
            valid={email.includes('@')}
          />
        </Reveal>

        {/* First name */}
        <Reveal index={3}>
          <FloatingInput
            ref={signUpFirstNameRef}
            label="First name"
            placeholder="Alex"
            value={formFirstName}
            onChangeText={setFormFirstName}
            autoCapitalize="words"
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => signUpLastNameRef.current?.focus()}
            maxLength={40}
            valid={formFirstName.trim().length >= 1}
          />
        </Reveal>

        {/* Last name */}
        <Reveal index={4}>
          <FloatingInput
            ref={signUpLastNameRef}
            label="Last name"
            placeholder="Rivera"
            value={formLastName}
            onChangeText={setFormLastName}
            autoCapitalize="words"
            autoComplete="family-name"
            textContentType="familyName"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => signUpPasswordRef.current?.focus()}
            maxLength={40}
          />
        </Reveal>

        {/* Password */}
        <Reveal index={5}>
          <FloatingInput
            ref={signUpPasswordRef}
            label="Password"
            placeholder="Minimum 8 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => signUpConfirmRef.current?.focus()}
            hint={password.length > 0 && password.length < 8 ? 'Use at least 8 characters' : null}
            right={<RevealToggle shown={showPw} onToggle={() => setShowPw(v => !v)} />}
          />
        </Reveal>

        {/* Confirm password */}
        <Reveal index={6}>
          <FloatingInput
            ref={signUpConfirmRef}
            label="Confirm password"
            placeholder="Re-enter password"
            value={confirmPassword}
            onChangeText={setConfirm}
            secureTextEntry={!showConfirm}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => signUpUsernameRef.current?.focus()}
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
            ref={signUpUsernameRef}
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
            autoComplete="username-new"
            textContentType="username"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => signUpReferralRef.current?.focus()}
            maxLength={30}
            error={usernameError || usernameLiveCheck.error || null}
            valid={isUsernameValid && !usernameLiveCheck.error && !usernameLiveCheck.checking}
            hint={usernameLiveCheck.checking
              ? 'Checking availability…'
              : username.length >= 3 && !usernameLiveCheck.error
                ? `@${username} is available`
                : username.length > 0
                  ? `@${username} · letters, numbers, underscores only`
                  : 'Letters, numbers, and underscores only'}
          />
        </Reveal>

        {/* Referral code */}
        <Reveal index={8}>
          <FloatingInput
            ref={signUpReferralRef}
            testID="onboarding-referral-input"
            value={referralCode}
            editable
            onChangeText={v => onReferralCodeChange(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
            label="Referral code (optional)"
            placeholder="e.g. FASHION"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => signUpDobRef.current?.focus()}
            maxLength={12}
            hint="Enter the code from the friend who invited you."
          />
        </Reveal>

        <Reveal index={9}>
          <NativeDateTimeField
            mode="date"
            label="Date of birth"
            value={mdyToDate(dobText)}
            onChange={(d) => { setDobText(dateToMdy(d)); setDobError(null); }}
            maximumDate={new Date()}
            iosEmptyDisplay="spinner"
            error={dobError}
            testID="onboarding-dob-input"
            fallback={(
              <FloatingInput
                ref={signUpDobRef}
                testID="onboarding-dob-input"
                value={dobText}
                onChangeText={(t) => { setDobText(formatDobInput(t)); setDobError(null); }}
                label="Date of birth"
                placeholder="MM/DD/YYYY"
                keyboardType="number-pad"
                returnKeyType="done"
                maxLength={10}
                error={dobError}
              />
            )}
          />
        </Reveal>

        <Reveal index={9}>
          <LegalConsent checked={agreedToTerms} onChange={updateConsent} showError={consentError} style={{ marginTop: SPACE.xs, marginBottom: SPACE.md }} />
        </Reveal>

        {error ? <InlineError message={error} /> : null}

        <Reveal index={10}>
          <PrimaryButton label={loading ? 'Creating account…' : 'Create account'} onPress={handleSignUp} disabled={!canSubmit} loading={loading} />
          {!canSubmit && missingFieldsHint ? <Text style={[ssa.hint, ssa.hintCentered]}>{missingFieldsHint}</Text> : null}
          <LegalContinueNotice style={{ marginTop: SPACE.sm }} />
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
              <GoogleGlyph size={20} />
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
  chooseHeadline: { fontSize: 36, fontFamily: FONT.bold, color: FG, letterSpacing: -1.2, marginBottom: 8 },
  chooseSub: { fontSize: 15, fontFamily: FONT.regular, color: MUTED, lineHeight: 22, marginBottom: 32 },
  bigRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
    paddingVertical: 16, paddingHorizontal: 16, backgroundColor: CARD, marginBottom: 10,
  },
  appleRow: { backgroundColor: '#000000', borderColor: 'rgba(255,255,255,0.15)' },
  bigRowIcon: { width: 28, alignItems: 'center' },
  bigRowText: { flex: 1, fontSize: 15, fontFamily: FONT.semibold, color: FG },
  signInLink: { paddingVertical: 16, alignItems: 'center' },
  signInLinkText: { fontSize: 14, fontFamily: FONT.regular, color: MUTED },
  backToChoose: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  backToChooseText: { fontSize: 14, fontFamily: FONT.medium, color: MUTED },
  headline:  { fontSize: 28, fontFamily: FONT.bold, color: FG, letterSpacing: -0.5, marginBottom: 4 },
  sub:       { fontSize: 14, fontFamily: FONT.regular, color: MUTED, marginBottom: 20 },
  inputWrap: { marginBottom: 12 },
  label:     { fontSize: 12, fontFamily: FONT.semibold, color: MUTED, marginBottom: 5 },
  input:     { backgroundColor: INPUT_BG, borderWidth: StyleSheet.hairlineWidth, borderColor: INPUT_BD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: FONT.regular, color: FG },
  codeInput: { letterSpacing: 8, fontSize: 22, textAlign: 'center', fontFamily: FONT.bold },
  pwRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD, borderRadius: 12 },
  pwInput:   { flex: 1, borderWidth: 0, backgroundColor: 'transparent' },
  eyeBtn:    { paddingHorizontal: 14 },
  hint:      { fontSize: 12, fontFamily: FONT.regular, color: MUTED, marginTop: 4 },
  error:     { color: ERR, fontSize: 13, fontFamily: FONT.regular, marginBottom: 10 },
  resendBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  resendText:{ fontSize: 14, fontFamily: FONT.regular, color: MUTED },
  legal:     { fontSize: 12, fontFamily: FONT.regular, color: MUTED2, textAlign: 'center', lineHeight: 18, marginTop: 12 },
  existingEmailChip: {
    alignSelf: 'flex-start',
    borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 6, marginBottom: 16,
  },
  existingEmailText: { fontSize: 13, fontFamily: FONT.semibold },
  existingCard: {
    borderRadius: 12, borderWidth: 1,
    padding: 16, marginBottom: 20,
  },
  existingCardTitle: {
    fontSize: 17, fontFamily: FONT.bold, color: FG, marginBottom: 6, lineHeight: 23,
  },
  existingCardSub: {
    fontSize: 14, fontFamily: FONT.regular, color: MUTED, lineHeight: 20,
  },
  existingSignInBtn:  { marginBottom: 9, borderRadius: 12, overflow: 'hidden' },
  existingSignInGrad: { paddingVertical: 16, alignItems: 'center', borderRadius: 12 },
  existingSignInText: { fontSize: 15, fontFamily: FONT.bold, color: FG },
  existingDiffBtn: {
    borderRadius: 12, paddingVertical: 15, alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  existingDiffText: { fontSize: 15, fontFamily: FONT.bold, color: FG },
  sessionBtn:     { marginTop: 8, marginBottom: 10, borderRadius: 14, overflow: 'hidden' },
  sessionBtnGrad: { paddingVertical: 16, alignItems: 'center', paddingHorizontal: 20 },
  sessionBtnText: { fontSize: 15, fontFamily: FONT.bold, color: FG },
  continueBtn:    { paddingVertical: 14, alignItems: 'center' },
  continueBtnText:{ fontSize: 14, fontFamily: FONT.medium, color: MUTED },
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
  oauthBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER, minHeight: 56, backgroundColor: 'transparent', marginBottom: SPACE.sm },
  appleBtn:  { borderColor: BORDER },
  oauthText: { fontSize: 16, fontFamily: FONT.semibold, color: FG },
  existingEmailChip: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: RADIUS.pill, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14, paddingVertical: 8, marginTop: SPACE.lg, marginBottom: SPACE.md,
  },
  existingEmailText: { fontSize: 14, fontFamily: FONT.semibold },
  existingCard: {
    borderRadius: RADIUS.card, borderWidth: StyleSheet.hairlineWidth,
    padding: SPACE.md + 2,
  },
  existingCardTitle: {
    fontSize: 17, fontFamily: FONT.bold, color: FG, marginBottom: 6, lineHeight: 23,
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
                onPress={() => { haptics.selection(); onSelectTheme(preset.id); }}
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
            <AiGeneratedBadge position="topLeft" />
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
  themeName: { flex: 1, fontSize: 12, fontFamily: FONT.semibold, color: FG },
  hint: { ...TYPE.caption, color: MUTED2, marginTop: SPACE.xs },
  sampleHeader: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: SPACE.sm },
  sampleSub: { ...TYPE.caption, color: MUTED, paddingRight: 18, marginTop: -4 },
  styleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginBottom: SPACE.md },
  resultCard: { borderRadius: RADIUS.card, borderWidth: StyleSheet.hairlineWidth, backgroundColor: '#F7F7F7', overflow: 'hidden', marginBottom: SPACE.sm },
  resultImage: { width: '100%', height: 180 },
  resultCaption: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, backgroundColor: 'rgba(0,0,0,0.86)' },
  resultText: { fontSize: 13, fontFamily: FONT.semibold, color: FG },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.xs, padding: SPACE.sm, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: ERR },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, color: ERR },
  retryText: { fontSize: 13, fontFamily: FONT.bold },
  continueWrap: { marginTop: SPACE.md },
  });
};

// ─── Main onboarding component ────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { theme } = useAppTheme();
  const { isSignedIn, isLoaded: authLoaded, sessionId, signOut } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const startGoogleOAuth = useCallback(() => startSSOFlow({ strategy: 'oauth_google', redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri) }), [startSSOFlow]);
  const startAppleOAuth = useCallback(() => startSSOFlow({ strategy: APPLE_OAUTH_STRATEGY, redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri) }), [startSSOFlow]);
  const { apple: appleOAuthEnabled, google: googleOAuthEnabled } = oauthProviderVisibility(Platform.OS, {
    apple: useFeatureFlag('oauthAppleEnabled'),
    google: useFeatureFlag('oauthGoogleEnabled'),
  });
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();

  const {
    postAuth,
    addAccount,
    start,
    referralCode: referralCodeParam,
    deviceFlow,
    deviceStep,
    deviceProbe,
    previewUser,
  } = useLocalSearchParams<{
    postAuth?: string;
    addAccount?: string;
    start?: string;
    referralCode?: string;
    deviceFlow?: string;
    deviceStep?: string;
    deviceProbe?: string;
    previewUser?: string;
  }>();
  const isAddAccount = addAccount === '1';
  const isDevWebPreviewUser = __DEV__ && Platform.OS === 'web' && previewUser === '1';
  const deviceProbeEnabled = __DEV__ && deviceProbe === '1';
  const deviceProbeFlow: Flow | null = __DEV__ && (deviceFlow === 'buyer' || deviceFlow === 'seller') ? deviceFlow : null;
  const deviceProbeStep: StepId | null = deviceProbeFlow
    ? (isStepId(deviceStep) ? deviceStep : allStepsFor(deviceProbeFlow)[Number(deviceStep) || 0] ?? null)
    : null;

  // ── Flow state ────────────────────────────────────────────────────────────
  const [flow, setFlow] = useState<Flow | null>(deviceProbeFlow);
  const [selectedFlow, setSelectedFlow] = useState<AccountType | null>(deviceProbeFlow);
  // "Create new account" (and the sign-in screen's "Create an account") open
  // straight on the buyer/seller question.
  const [stepId, setStepId] = useState<StepId>(deviceProbeStep ?? (isAddAccount || start === 'account-type' ? 'ACCOUNT_TYPE' : 'WELCOME'));
  const [authMethod, setAuthMethod] = useState<AuthMethod>('email');
  const [ready, setReady] = useState(deviceProbeEnabled);
  const [addAccountSourceUserId, setAddAccountSourceUserId] = useState<string | null | undefined>(isAddAccount ? undefined : null);
  const accountCreatedRef = useRef(false);

  // The session belongs to the account being onboarded (in add-account mode
  // the already signed-in account is only where the flow started).
  const accountReady = isDevWebPreviewUser
    || (!!isSignedIn && !!user?.id && (!isAddAccount || (addAccountSourceUserId !== undefined && user.id !== addAccountSourceUserId)));

  // ── Answers ───────────────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState(''); // memory only, never in a draft
  const [birthday, setBirthday] = useState<WheelDate>(() => dobToWheelDate(null));
  const [dob, setDob] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [referralCode, setReferralCode] = useState(cleanReferral(referralCodeParam));
  const [showReferral, setShowReferral] = useState(false);
  const [styleInterests, setStyleArr] = useState<string[]>(DEFAULT_BUYER_INTERESTS);
  const [survey, setSurvey] = useState<OnboardingSurvey>(EMPTY_SURVEY);
  const setSurveySizes = useCallback((sizes: OnboardingSurvey['sizes']) => setSurvey((prev) => ({ ...prev, sizes })), []);
  const setSurveyBrands = useCallback((likedBrandIds: string[]) => setSurvey((prev) => (
    prev.likedBrandIds.length === likedBrandIds.length && prev.likedBrandIds.every((id, i) => id === likedBrandIds[i])
      ? prev : { ...prev, likedBrandIds }
  )), []);
  const [brandName, setBrandName] = useState('');
  const [brandStage, setBrandStage] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [country, setCountry] = useState(defaultCountry);

  // ── Async UI state ────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<'' | 'apple' | 'google'>('');
  const [stepError, setStepError] = useState<string | null>(null);
  // Set only when Clerk says the typed email itself is taken.
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [sampleStyle, setSampleStyle] = useState('Minimalist');
  const [sampleUri, setSampleUri] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sampleUnavailable, setSampleUnavailable] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [planId, setPlanId] = useState<SellerPlanId | null>(null);

  const usernameLiveCheck = useUsernameLiveCheck(stepId === 'USERNAME' ? username : '');
  const ctx = useMemo(() => ({ accountReady, authMethod }), [accountReady, authMethod]);

  // ── Transition ────────────────────────────────────────────────────────────
  const transitionProgress = useRef(new Animated.Value(1)).current;
  const transitionDirection = useRef<1 | -1>(1);
  const goTo = useCallback((next: StepId, dir: 1 | -1 = 1) => {
    transitionProgress.stopAnimation();
    transitionDirection.current = dir;
    transitionProgress.setValue(0);
    setStepError(null);
    setStepId(next);
    requestAnimationFrame(() => {
      Animated.timing(transitionProgress, {
        toValue: 1,
        duration: 230,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    });
  }, [transitionProgress]);

  const goNext = useCallback((from: StepId) => {
    if (!flow) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const next = nextStepId(flow, from, ctx);
    if (next) goTo(next, 1);
  }, [ctx, flow, goTo]);

  const goBack = useCallback(() => {
    if (stepId === 'ACCOUNT_TYPE') { setFlow(null); goTo('WELCOME', -1); return; }
    if (!flow) return;
    const prev = prevStepId(flow, stepId, ctx);
    if (!prev) return;
    if (prev === 'ACCOUNT_TYPE') setFlow(null);
    goTo(prev, -1);
  }, [ctx, flow, goTo, stepId]);

  // ── Ready fallbacks ───────────────────────────────────────────────────────
  useEffect(() => {
    const fallback = setTimeout(() => setReady(true), 1200);
    return () => clearTimeout(fallback);
  }, []);

  useEffect(() => {
    if (!isAddAccount || !userLoaded || addAccountSourceUserId !== undefined) return;
    // postAuth=1 means this mount follows the new account's own sign-up: the
    // active user is already the new account, not the source.
    setAddAccountSourceUserId(postAuth === '1' ? null : user?.id ?? null);
  }, [addAccountSourceUserId, isAddAccount, postAuth, user?.id, userLoaded]);

  // ── Restore a draft ───────────────────────────────────────────────────────
  const applyDraft = useCallback((draft: OnboardingDraft, resumeAt: StepId) => {
    setFlow(resumeAt === 'WELCOME' || resumeAt === 'ACCOUNT_TYPE' ? null : draft.flow);
    setSelectedFlow(draft.flow);
    setAuthMethod(draft.authMethod);
    setEmail(draft.email);
    setFullName([draft.firstName, draft.lastName].filter(Boolean).join(' '));
    setUsername(draft.username);
    setUsernameEdited(!!draft.username);
    setDob(draft.dob);
    if (draft.dob) setBirthday(dobToWheelDate(draft.dob));
    setPhotoUri(draft.photoUri);
    if (draft.referralCode) setReferralCode((cur) => cur || draft.referralCode);
    if (draft.styleInterests.length > 0) setStyleArr(draft.styleInterests);
    setSurvey(sanitizeDraftSurvey(draft.survey));
    setBrandName(draft.brandName);
    setBrandStage(draft.brandStage);
    setGoals(draft.goals);
    if (draft.country) setCountry(draft.country);
    setStepId(resumeAt);
  }, []);

  const restored = useRef(false);
  useEffect(() => {
    if (deviceProbeEnabled || restored.current) return;
    if (!authLoaded || (isSignedIn && !userLoaded)) return;
    if (isAddAccount && addAccountSourceUserId === undefined) return;
    // "Create an account" is only offered signed out. A session still here
    // is left over (dev preview, an earlier test): sign it out quietly so the
    // new account is created instead of onboarding the old one.
    if (start === 'account-type' && !isAddAccount && postAuth !== '1' && isSignedIn && !isDevWebPreviewUser) {
      void signOut({ sessionId: sessionId ?? undefined }).catch(() => {});
      return;
    }
    restored.current = true;

    void (async () => {
      try {
        const landingFlow = await AsyncStorage.getItem(PENDING_FLOW_KEY).catch(() => null);
        await AsyncStorage.multiRemove(LEGACY_PENDING_KEYS).catch(() => {});
        // "Create new account" always starts clean at the buyer/seller question.
        if (isAddAccount && postAuth !== '1') {
          await AsyncStorage.removeItem(PENDING_DRAFT_KEY);
          setStepId('ACCOUNT_TYPE');
          return;
        }
        const userKey = accountReady ? userDraftKey(user?.id) : null;
        const [[, pendingRaw], [, userRaw]] = await AsyncStorage.multiGet([PENDING_DRAFT_KEY, userKey ?? '__none__']);
        const pending = parseDraft(pendingRaw);
        const own = parseDraft(userRaw);

        if (accountReady) {
          // A sign-up that just finished (email verify reload, OAuth return)
          // hands its device-scoped draft to the new account.
          const draft = pending?.accountCreated ? pending : (own && (!own.ownerId || own.ownerId === user?.id) ? own : null);
          if (pending?.accountCreated && userKey) {
            await AsyncStorage.setItem(userKey, JSON.stringify(sanitizeDraftForStorage({ ...pending, ownerId: user?.id ?? null })));
            await AsyncStorage.removeItem(PENDING_DRAFT_KEY);
          }
          if (draft) {
            accountCreatedRef.current = true;
            applyDraft(draft, resolveResumeStep(draft, { accountReady: true, signUpPending: false, emailVerified: false }));
          } else {
            // Signed in without onboarding answers (e.g. a new Apple account
            // from the sign-in screen): ask buyer or seller, then profile.
            setStepId('ACCOUNT_TYPE');
          }
          return;
        }

        if (landingFlow === 'buyer' || landingFlow === 'seller') {
          setSelectedFlow(landingFlow);
          setStepId('ACCOUNT_TYPE');
          if (!pending || pending.accountCreated) return;
        }
        if (pending && !pending.accountCreated) {
          const sameSignUp = !!signUp?.id && signUp.status !== 'complete'
            && (signUp.emailAddress ?? '').toLowerCase() === pending.email.toLowerCase();
          const emailVerified = sameSignUp
            && (signUp as any)?.verifications?.emailAddress?.status === 'verified';
          applyDraft(pending, resolveResumeStep(pending, { accountReady: false, signUpPending: sameSignUp, emailVerified }));
        }
      } catch {
        // Local persistence is optional; a storage issue must not block sign-up.
      } finally {
        setReady(true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addAccountSourceUserId, authLoaded, userLoaded, isSignedIn, isAddAccount, postAuth, user?.id, deviceProbeEnabled]);

  // ── Save the draft after every change ─────────────────────────────────────
  const buildDraft = useCallback((overrides?: Partial<OnboardingDraft>): OnboardingDraft | null => {
    const draftFlow = flow ?? selectedFlow;
    if (!draftFlow) return null;
    const { first, last } = splitName(fullName);
    return {
      version: DRAFT_VERSION,
      flow: draftFlow,
      stepId,
      authMethod,
      accountCreated: accountCreatedRef.current || accountReady,
      ownerId: accountReady ? user?.id ?? null : null,
      email,
      firstName: first,
      lastName: last,
      username,
      dob,
      referralCode,
      photoUri,
      styleInterests,
      survey,
      brandName,
      brandStage,
      goals,
      country,
      selectedThemeId: theme.id,
      ...overrides,
    };
  }, [flow, selectedFlow, fullName, stepId, authMethod, accountReady, user?.id, email, username, dob, referralCode, photoUri, styleInterests, survey, brandName, brandStage, goals, country, theme.id]);

  const persistDraft = useCallback(async (overrides?: Partial<OnboardingDraft>) => {
    if (deviceProbeEnabled || isDevWebPreviewUser) return;
    const draft = buildDraft(overrides);
    if (!draft) return;
    const key = accountReady ? userDraftKey(user?.id) : PENDING_DRAFT_KEY;
    if (!key) return;
    await AsyncStorage.setItem(key, JSON.stringify(sanitizeDraftForStorage(draft)));
  }, [accountReady, buildDraft, deviceProbeEnabled, isDevWebPreviewUser, user?.id]);

  useEffect(() => {
    if (!ready || stepId === 'WELCOME') return;
    const timer = setTimeout(() => { persistDraft().catch(() => {}); }, 300);
    return () => clearTimeout(timer);
  }, [ready, stepId, persistDraft]);

  // ── The account became ready (email finalize, OAuth, or a restored session) ─
  useEffect(() => {
    if (!ready || !accountReady || !flow) return;
    if (isAccountStep(stepId)) {
      accountCreatedRef.current = true;
      goTo('NAME', 1);
    }
  }, [accountReady, flow, goTo, ready, stepId]);

  // The birthday is sent once the account exists; the server keeps only the band.
  useEffect(() => {
    if (!accountReady || !dob || isDevWebPreviewUser) return;
    setPendingDob(dob);
    void submitPendingAge(api).then(() => setDob(null));
  }, [accountReady, api, dob, isDevWebPreviewUser]);

  // Suggest a username the first time the step opens (Instagram pre-fills one).
  useEffect(() => {
    if (stepId !== 'USERNAME' || usernameEdited || username) return;
    const suggestion = suggestUsername({ brandName: flow === 'seller' ? brandName : '', name: fullName, email });
    if (suggestion) setUsername(suggestion);
  }, [brandName, email, flow, fullName, stepId, username, usernameEdited]);

  // ── Account type ──────────────────────────────────────────────────────────
  function continueFromAccountType() {
    if (!selectedFlow) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    void AsyncStorage.setItem(ONBOARDING_KEY, 'false').catch(() => {});
    setFlow(selectedFlow);
    goTo(nextStepId(selectedFlow, 'ACCOUNT_TYPE', ctx) ?? 'NAME', 1);
  }

  // ── Account steps (Clerk) ─────────────────────────────────────────────────
  const goLogin = useCallback(() => {
    router.replace((isAddAccount ? '/sign-in?addAccount=1' : '/sign-in') as never);
  }, [isAddAccount, router]);

  async function submitEmail() {
    if (busy) return;
    setAuthMethod('email');
    setBusy(true);
    setStepError(null);
    setExistingEmail(null);
    const submitted = email.trim().toLowerCase();
    // Every submit starts a fresh sign-up; an abandoned one is never reused.
    const create = async () => {
      try { return (await signUp.create({ emailAddress: submitted })).error ?? null; } catch (e) { return e; }
    };
    try {
      let error = await create();
      if (error && classifySignUpCreateError(error, submitted, email).kind === 'stale-session' && !isAddAccount) {
        // A leftover session on this device, not the email: clear it and retry once.
        await signOut({ sessionId: sessionId ?? undefined }).catch(() => {});
        error = await create();
      }
      if (error) {
        if (classifySignUpCreateError(error, submitted, email).kind === 'email-exists') setExistingEmail(submitted);
        else setStepError(mapClerkError(error));
        return;
      }
      await signUp.verifications.sendEmailCode();
      track('signup_started', { method: 'email' });
      setCode('');
      goTo('CODE', 1);
    } catch (e) {
      setStepError(mapClerkError(e));
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (resending) return;
    setResending(true);
    setStepError(null);
    try {
      await signUp.verifications.sendEmailCode();
    } catch (e) {
      setStepError(mapClerkError(e));
    } finally {
      setResending(false);
    }
  }

  async function submitCode() {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setStepError(null);
    try {
      const { error } = await signUp.verifications.verifyEmailCode({ code });
      if (error) { setStepError(mapClerkError(error)); return; }
      goTo('PASSWORD', 1);
    } catch (e) {
      setStepError(mapClerkError(e));
    } finally {
      setBusy(false);
    }
  }

  function submitBirthday() {
    const check = checkDobInput(wheelDateToDobInput(birthday), { seller: flow === 'seller' });
    if (!check.ok) { setStepError(check.error); return; }
    setDob(check.dob);
    setPendingDob(check.dob);
    goNext('BIRTHDAY');
  }

  async function finalizeEmailAccount() {
    accountCreatedRef.current = true;
    await persistDraft({ accountCreated: true, stepId: 'NAME' }).catch(() => {});
    track('signup_completed', { method: 'email' });
    await signUp.finalize({
      navigate: ({ decorateUrl }: { decorateUrl: (url: string) => string }) => {
        const referralQuery = referralCode ? `&referralCode=${encodeURIComponent(referralCode)}` : '';
        const addAccountQuery = isAddAccount ? '&addAccount=1' : '';
        const destination = `/onboarding?postAuth=1${addAccountQuery}${referralQuery}`;
        const url = decorateUrl(destination);
        if (url.startsWith('http') && typeof window !== 'undefined') {
          window.location.href = url;
        } else {
          router.replace(destination as never);
        }
      },
    });
  }

  async function runOAuth(provider: 'apple' | 'google') {
    const startFlow = provider === 'apple' ? startAppleOAuth : startGoogleOAuth;
    const label = provider === 'apple' ? 'Apple' : 'Google';
    setOauthBusy(provider);
    setStepError(null);
    try {
      accountCreatedRef.current = true;
      await persistDraft({ accountCreated: true, stepId: 'NAME' }).catch(() => {});
      const result = await startFlow();
      if (result?.createdSessionId && result?.setActive) {
        await result.setActive({ session: result.createdSessionId });
      }
      if (!isOAuthFlowComplete(result)) {
        accountCreatedRef.current = false;
        await persistDraft({ accountCreated: false }).catch(() => {});
        if (result?.signUp) setStepError(`${label} sign-in needs one more step. Try again.`);
      } else {
        track('signup_completed', { method: provider });
      }
    } catch (e) {
      accountCreatedRef.current = false;
      await persistDraft({ accountCreated: false }).catch(() => {});
      if (!isOAuthCancellationError(e)) setStepError(mapOAuthError(label, e));
    } finally {
      setOauthBusy('');
    }
  }

  async function agreeToTerms() {
    if (busy || oauthBusy) return;
    void rememberPendingConsent();
    if (isDevWebPreviewUser) { goTo('NAME', 1); return; }
    if (authMethod !== 'email') { await runOAuth(authMethod); return; }
    if (password.length < 8) { goTo('PASSWORD', -1); return; }
    setBusy(true);
    setStepError(null);
    try {
      const { error } = await signUp.password({ password, legalAccepted: true });
      if (error) {
        if (clerkCode(error).startsWith('form_password')) {
          goTo('PASSWORD', -1);
          setTimeout(() => setStepError(mapClerkError(error)), 0);
        } else {
          setStepError(mapClerkError(error));
        }
        return;
      }
      if (signUp.status === 'complete') {
        await finalizeEmailAccount();
      } else {
        setStepError("We couldn't finish creating your account. Try again.");
      }
    } catch (e) {
      setStepError(mapClerkError(e));
    } finally {
      setBusy(false);
    }
  }

  function chooseOAuth(provider: 'apple' | 'google') {
    setAuthMethod(provider);
    setStepError(null);
    // Birthday and terms come before any account exists, for every method.
    goTo('BIRTHDAY', 1);
  }

  // ── Profile writes ────────────────────────────────────────────────────────
  const composedName = () => fullName.trim().replace(/\s+/g, ' ');

  /** Saves name, username and account type once the username is chosen. */
  async function saveProfileBasics(): Promise<boolean> {
    if (isDevWebPreviewUser) return true;
    const name = composedName();
    const uname = username.trim().toLowerCase();
    try {
      const profile = await api.auth.sync({ name });
      await submitPendingAge(api);
      if (flow === 'seller') {
        await api.auth.onboarding({ brandName: brandName.trim(), ...(brandStage ? { brandStage } : {}), username: uname });
        await api.auth.updateProfile({ name, displayName: name, accountType: 'seller', expectedClerkId: profile.clerkId });
      } else {
        const updated = await api.auth.updateProfile({
          name, displayName: name, accountType: 'buyer', expectedClerkId: profile.clerkId, username: uname,
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
      }
      return true;
    } catch (error) {
      if (isUsernameTakenError(error)) {
        setStepError('That username was just taken. Try another.');
      } else {
        console.error('[onboarding] profile save failed', { message: error instanceof Error ? error.message : String(error) });
        setStepError("We couldn't save your profile. Check your connection and try again.");
      }
      return false;
    }
  }

  async function submitUsername() {
    if (busy) return;
    setBusy(true);
    setStepError(null);
    const ok = await saveProfileBasics();
    setBusy(false);
    if (ok) goNext('USERNAME');
  }

  async function pickPhoto() {
    const asset = await pickFromLibrary([1, 1]);
    if (!asset) return;
    setPhotoUri(asset.uri);
    if (isDevWebPreviewUser) return;
    setUploadingPhoto(true);
    setStepError(null);
    try {
      const { profileImageUrl } = await api.auth.uploadAvatar({ uri: asset.uri, mimeType: asset.mimeType });
      if (profileImageUrl) setPhotoUri(profileImageUrl);
    } catch {
      setStepError("We couldn't upload that picture. Try another one or skip for now.");
      setPhotoUri(null);
    } finally {
      setUploadingPhoto(false);
    }
  }

  // ── Buyer finish ──────────────────────────────────────────────────────────
  function logBuyerFailure(stage: string, error: unknown, retryAttempt: boolean) {
    const apiError = error instanceof ApiError ? error : null;
    console.error('[buyer-onboarding] save failed', {
      stage, retryAttempt,
      message: error instanceof Error ? error.message : String(error),
      status: apiError?.status, code: apiError?.code, requestId: apiError?.requestId,
    });
  }

  async function finishBuyer(retryAttempt = false) {
    if (finishing) return;
    setFinishing(true);
    if (isDevWebPreviewUser && typeof window !== 'undefined') {
      window.location.assign('/?bt_preview=buyer');
      return;
    }
    let profileId: string | null = null;
    let failureStage = 'profile';
    let pendingSyncQueued = false;
    const { first } = splitName(fullName);
    try {
      const profile = await api.auth.sync({ name: composedName() });
      profileId = profile.clerkId;
      if (referralCode.trim()) {
        await api.referrals.apply(referralCode.trim(), profile.clerkId).catch((error) => logBuyerFailure('referral', error, retryAttempt));
      }
      failureStage = 'pending-sync-queue';
      await queueBuyerOnboardingSync(profile.clerkId, styleInterests);
      pendingSyncQueued = true;
      failureStage = 'preferences-or-completion';
      await syncBuyerOnboarding(profile.clerkId, styleInterests, api);
      await saveBuyerSurvey(profile.clerkId, survey, styleInterests, api);
      await AsyncStorage.multiSet([
        [ONBOARDING_KEY, 'true'],
        [ONBOARDING_OWNER_KEY, profile.clerkId],
        ['user_role', 'buyer'],
        ['onboarding_first_name', first],
        ['onboarding_style_interests', JSON.stringify(styleInterests)],
      ]);
      await AsyncStorage.multiRemove([userDraftKey(profile.clerkId)!, PENDING_DRAFT_KEY]);
      void registerGrantedPushToken(profile.clerkId, api);
      router.replace('/thread-explainer' as never);
    } catch (error) {
      setFinishing(false);
      logBuyerFailure(failureStage, error, retryAttempt);
      if (retryAttempt && failureStage === 'preferences-or-completion' && pendingSyncQueued && profileId && isRecoverableBuyerOnboardingSyncError(error)) {
        try {
          await AsyncStorage.multiSet([
            [ONBOARDING_KEY, 'true'],
            [ONBOARDING_OWNER_KEY, profileId],
            ['user_role', 'buyer'],
            ['onboarding_first_name', first],
            ['onboarding_style_interests', JSON.stringify(styleInterests)],
          ]);
        } catch (storageError) {
          logBuyerFailure('local-fallback', storageError, true);
        }
        void saveBuyerSurvey(profileId, survey, styleInterests, api);
        void syncBuyerOnboarding(profileId, styleInterests, api).catch((e) => logBuyerFailure('background-retry', e, true));
        router.replace('/thread-explainer' as never);
        return;
      }
      Alert.alert(
        'Setup incomplete',
        profileId && failureStage === 'preferences-or-completion'
          ? "We couldn't save your preferences. Try once more, or we'll finish syncing after you enter the app."
          : "We couldn't finish setting up your profile. Try again.",
        [{ text: 'Retry', onPress: () => { void finishBuyer(true); } }],
      );
    }
  }

  // ── Seller: build the store, then finish ──────────────────────────────────
  const buildStore = useCallback(async () => {
    setBuilding(true);
    setBuildError(null);
    try {
      if (!isDevWebPreviewUser) {
        await api.seller.saveOnboardingData({ goals, ...(brandStage ? { brandStage } : {}) });
        await api.shippingZones.updateSettings(country).catch(() => {
          // Ship-from country is editable in Shipping; never block the store on it.
        });
      }
      setBuilt(true);
    } catch {
      setBuildError("We couldn't save your store. Check your connection and try again.");
    } finally {
      setBuilding(false);
    }
  }, [api, brandStage, country, goals, isDevWebPreviewUser]);

  useEffect(() => {
    if (stepId === 'BUILDING' && !built && !building && !buildError) void buildStore();
  }, [buildError, buildStore, building, built, stepId]);

  async function generateSample() {
    if (generating || sampleUri) return;
    setGenerating(true);
    setSampleError(null);
    try {
      const result = await api.logo.onboardingSample(brandName.trim(), sampleStyle, await getInstallId());
      if (!result?.b64_json) throw new Error('No image came back. Try again.');
      setSampleUri(`data:image/png;base64,${result.b64_json}`);
    } catch (error: any) {
      const used = error?.code === 'onboarding_sample_used' || error?.status === 429;
      if (used) setSampleUnavailable(true);
      setSampleError(used
        ? 'The free logo was already used on this device or email.'
        : (error?.message || "The logo couldn't be made. Try again."));
    } finally {
      setGenerating(false);
    }
  }

  async function finishSeller() {
    if (finishing) return;
    setFinishing(true);
    if (isDevWebPreviewUser && typeof window !== 'undefined') {
      window.location.assign('/?bt_preview=seller');
      return;
    }
    const { first } = splitName(fullName);
    try {
      const profile = await api.auth.sync({ name: composedName() });
      if (referralCode.trim()) {
        await api.referrals.apply(referralCode.trim(), profile.clerkId).catch((error) => {
          console.error('[seller-onboarding] referral save failed', { message: error instanceof Error ? error.message : String(error) });
        });
      }
      await api.auth.completeOnboarding('seller');
      await AsyncStorage.multiSet([
        [ONBOARDING_KEY, 'true'],
        [ONBOARDING_OWNER_KEY, profile.clerkId],
        ['user_role', 'seller'],
        ['onboarding_first_name', first],
        ['onboarding_brand_name', brandName],
        ['onboarding_brand_stage', brandStage],
        ['onboarding_goals', JSON.stringify(goals)],
        ['onboarding_selected_plan', planId ?? recommendedPlanId],
      ]);
      await AsyncStorage.multiRemove([userDraftKey(profile.clerkId)!, PENDING_DRAFT_KEY]);
      void registerGrantedPushToken(profile.clerkId, api);
      api.ai.brandMemoryRebuild().catch(() => {});
      router.replace('/(tabs)/' as never);
    } catch (error) {
      setFinishing(false);
      console.error('[seller-onboarding] save failed', { message: error instanceof Error ? error.message : String(error) });
      Alert.alert(
        'Setup incomplete',
        "We couldn't save your brand profile. Check your connection and try again.",
        [{ text: 'Retry', onPress: () => { void finishSeller(); } }],
      );
    }
  }

  // ── Seller: plan + free trial (after the preview) ─────────────────────────
  // finishSeller is a plain function declared above; the hook keeps the
  // latest callback, so the trial's success always runs the current one.
  const trial = useSellerTrialCheckout({ onActive: () => { void finishSeller(); } });
  const recommendedPlanId = recommendSellerPlan(brandStage, goals).planId;
  useEffect(() => {
    if (stepId === 'PLAN' && !isDevWebPreviewUser) void trial.checkExisting();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  // ── Step rendering ────────────────────────────────────────────────────────
  const isSeller = flow === 'seller';

  const referralSlot = referralCode && !showReferral
    ? null
    : showReferral
      ? (
        <Input
          testID="onboarding-referral-input"
          label="Invite code"
          value={referralCode}
          onChangeText={(v) => setReferralCode(cleanReferral(v))}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
          style={styles.referralInput}
          right={<ClearButton visible={referralCode.length > 0} onPress={() => setReferralCode('')} />}
        />
      )
      : (
        <Pressable onPress={() => setShowReferral(true)} accessibilityRole="button" hitSlop={8} style={styles.haveCode} testID="onboarding-have-code">
          <Text style={[styles.haveCodeText, { color: theme.muted }]}>Have a code?</Text>
        </Pressable>
      );

  function renderStep(): React.ReactNode {
    switch (stepId) {
      case 'WELCOME':
        return (
          <WelcomeStep
            onGetStarted={() => goTo('ACCOUNT_TYPE', 1)}
            onSignIn={goLogin}
            onBrowse={isSignedIn ? undefined : () => router.replace('/(buyer)/discover' as never)}
          />
        );

      case 'ACCOUNT_TYPE':
        return <AccountTypeStep selected={selectedFlow} onSelect={setSelectedFlow} onContinue={continueFromAccountType} />;

      case 'STAGE':
        return (
          <ChoiceCardsStep
            testID="onboarding-stage-step"
            title="Where is your brand today?"
            subtitle="We'll set up your workspace for this stage."
            options={BRAND_STAGE_OPTIONS}
            selected={brandStage ? [brandStage] : []}
            multi={false}
            onToggle={(v) => setBrandStage(v)}
            progress={flow ? progressFraction(flow, 'STAGE', ctx) : 0}
            onNext={() => goNext('STAGE')}
            onSkip={() => { setBrandStage(''); goNext('STAGE'); }}
            onSkipAll={() => { setBrandStage(''); setGoals([]); goTo('LOCATION', 1); }}
          />
        );

      case 'GOALS':
        return (
          <ChoiceCardsStep
            testID="onboarding-goals-step"
            title="What do you need help with?"
            subtitle="Pick everything that applies."
            options={SELLER_GOAL_OPTIONS}
            selected={goals}
            multi
            onToggle={(v) => setGoals((prev) => prev.includes(v) ? prev.filter((g) => g !== v) : [...prev, v])}
            progress={flow ? progressFraction(flow, 'GOALS', ctx) : 0}
            onNext={() => goNext('GOALS')}
            onSkip={() => { setGoals([]); goNext('GOALS'); }}
            onSkipAll={() => { setGoals([]); goTo('LOCATION', 1); }}
          />
        );

      case 'LOCATION':
        return (
          <LocationStep
            country={country}
            onChange={setCountry}
            progress={flow ? progressFraction(flow, 'LOCATION', ctx) : 0}
            onNext={() => goNext('LOCATION')}
          />
        );

      case 'EMAIL':
        return (
          <EmailStep
            email={email}
            onChange={(v) => { setEmail(v); setStepError(null); setExistingEmail(null); }}
            onNext={() => { void submitEmail(); }}
            loading={busy}
            error={stepError}
            onLogin={goLogin}
            existing={existingEmail && existingEmail === email.trim().toLowerCase() && flow ? {
              role: flow,
              onSwitch: goLogin,
              onUseDifferent: () => { setEmail(''); setExistingEmail(null); },
            } : null}
            apple={appleOAuthEnabled ? { label: 'Continue with Apple', onPress: () => chooseOAuth('apple'), disabled: busy, testID: 'onboarding-email-apple' } : null}
            google={googleOAuthEnabled ? { label: 'Continue with Google', onPress: () => chooseOAuth('google'), disabled: busy, testID: 'onboarding-email-google' } : null}
            extra={referralSlot}
          />
        );

      case 'CODE':
        return (
          <CodeStep
            email={email}
            code={code}
            onChange={(v) => { setCode(v); setStepError(null); }}
            onNext={() => { void submitCode(); }}
            onResend={() => { void resendCode(); }}
            loading={busy}
            resending={resending}
            error={stepError}
            onLogin={goLogin}
          />
        );

      case 'PASSWORD':
        return (
          <PasswordStep
            password={password}
            onChange={(v) => { setPassword(v); setStepError(null); }}
            onNext={() => goNext('PASSWORD')}
            error={stepError}
            onLogin={goLogin}
          />
        );

      case 'BIRTHDAY':
        return (
          <BirthdayStep
            value={birthday}
            onChange={(v) => { setBirthday(v); setStepError(null); }}
            onNext={submitBirthday}
            error={stepError}
            seller={isSeller}
          />
        );

      case 'TERMS':
        return <TermsStep onAgree={() => { void agreeToTerms(); }} loading={busy || !!oauthBusy} error={stepError} />;

      case 'NAME':
        return <NameStep name={fullName} onChange={setFullName} onNext={() => goNext('NAME')} seller={isSeller} />;

      case 'BRAND_NAME':
        return <BrandNameStep brandName={brandName} onChange={setBrandName} onNext={() => goNext('BRAND_NAME')} />;

      case 'USERNAME':
        return (
          <UsernameStep
            username={username}
            onChange={(v) => { setUsername(v); setUsernameEdited(true); setStepError(null); }}
            onNext={() => { void submitUsername(); }}
            checking={usernameLiveCheck.checking}
            takenError={stepError ?? usernameLiveCheck.error}
            loading={busy}
          />
        );

      case 'PHOTO':
        return (
          <PhotoStep
            photoUri={photoUri}
            onPick={() => { void pickPhoto(); }}
            onNext={() => goNext('PHOTO')}
            onSkip={() => goNext('PHOTO')}
            uploading={uploadingPhoto}
            error={stepError}
          />
        );

      case 'WELCOME_USER':
        return <WelcomeUserStep username={username} photoUri={photoUri} onDone={() => goNext('WELCOME_USER')} />;

      case 'STYLE':
        return (
          <StepScreen
            testID="onboarding-style-step"
            title="What do you want to see?"
            subtitle="Pick a few so your feed starts with things you like."
            pinActions
            primary={{ label: 'Next', onPress: () => goNext('STYLE'), disabled: styleInterests.length === 0, testID: 'onboarding-style-next' }}
            secondary={{ label: 'Skip', onPress: () => goNext('STYLE'), testID: 'onboarding-style-skip' }}
          >
            <View style={styles.chipGrid}>
              {STYLE_INTERESTS.map((item) => (
                <StyleChip
                  key={item}
                  label={item}
                  selected={styleInterests.includes(item)}
                  onPress={() => setStyleArr((prev) => prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item])}
                />
              ))}
            </View>
          </StepScreen>
        );

      case 'SIZES':
        return (
          <StepScreen
            testID="onboarding-sizes-step"
            title="What sizes do you wear?"
            subtitle="We'll show the size that fits when you shop."
            pinActions
            primary={{ label: 'Next', onPress: () => goNext('SIZES'), disabled: !hasSurveyAnswers({ sizes: survey.sizes, likedBrandIds: [] }), testID: 'onboarding-sizes-next' }}
            secondary={{ label: 'Skip', onPress: () => goNext('SIZES'), testID: 'onboarding-sizes-skip' }}
          >
            <SizesStep sizes={survey.sizes} onChange={setSurveySizes} />
          </StepScreen>
        );

      case 'BRANDS':
        return (
          <StepScreen
            testID="onboarding-brands-step"
            title="Try following 5+ brands"
            subtitle="Following isn't required, but it makes your feed yours from the start."
            pinActions
            primary={{ label: 'Next', onPress: () => { void finishBuyer(); }, loading: finishing, disabled: survey.likedBrandIds.length === 0, testID: 'onboarding-brands-next' }}
            secondary={{ label: 'Skip', onPress: () => { void finishBuyer(); }, disabled: finishing, testID: 'onboarding-brands-skip' }}
          >
            <BrandsToFollowStep onLikedChange={setSurveyBrands} />
          </StepScreen>
        );

      case 'BUILDING':
        return (
          <BuildingStoreStep
            brandName={brandName.trim()}
            username={username}
            building={building || (!built && !buildError)}
            buildError={buildError}
            onRetryBuild={() => { void buildStore(); }}
            logoUri={sampleUri}
            sampleStyle={sampleStyle}
            onSampleStyle={setSampleStyle}
            onGenerate={() => { void generateSample(); }}
            generating={generating}
            sampleError={sampleError}
            sampleUnavailable={sampleUnavailable}
            onDone={() => goNext('BUILDING')}
          />
        );

      case 'PLAN':
        return (
          <PlanStep
            brandName={brandName.trim()}
            recommendedId={recommendedPlanId}
            selectedId={planId ?? recommendedPlanId}
            onSelect={setPlanId}
            priceLabel={trial.priceLabel}
            trialDays={trial.trialDays}
            reminderDaysBefore={trial.config.reminderDaysBefore}
            onStart={() => {
              if (isDevWebPreviewUser) { void finishSeller(); return; }
              void trial.start(planId ?? recommendedPlanId);
            }}
            starting={trial.busy || finishing}
            error={trial.error}
            onRestore={trial.native ? () => { void trial.restore(); } : undefined}
          />
        );

      default:
        return null;
    }
  }

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: theme.background }} accessible accessibilityLabel="Loading" />;
  }

  const fullBleed = stepId === 'WELCOME';
  const showBack = !fullBleed
    && stepId !== 'WELCOME_USER'
    && (stepId === 'ACCOUNT_TYPE' ? !isAddAccount && !accountReady : (!!flow && prevStepId(flow, stepId, ctx) !== null));
  const ownsBottomInset = SELLER_QUESTION_STEPS.includes(stepId) || stepId === 'ACCOUNT_TYPE' || stepId === 'BUILDING' || stepId === 'PLAN'
    || stepId === 'BIRTHDAY' || stepId === 'STYLE' || stepId === 'SIZES' || stepId === 'BRANDS';

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar barStyle="light-content" />

      {!fullBleed && (
        <View style={[styles.header, { paddingTop: headerTopInset }]}>
          {showBack ? (
            <Pressable
              style={styles.backBtn}
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={12}
              testID="onboarding-back"
            >
              <Icon name="chevron-left" size={24} color={theme.text} />
            </Pressable>
          ) : null}
        </View>
      )}

      <Animated.View
        style={[
          fullBleed ? styles.fullBleed : styles.stepWrap,
          !fullBleed && !ownsBottomInset && { paddingBottom: insets.bottom },
          {
            opacity: transitionProgress,
            transform: [{
              translateX: transitionProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [transitionDirection.current * 28, 0],
              }),
            }],
          },
        ]}
        testID={`onboarding-step-${flow ?? 'choose'}-${stepId}`}
        accessibilityLabel={`Onboarding ${flow ?? 'choose'} ${stepId.toLowerCase()}`}
      >
        {renderStep()}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: SPACING.xs },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepWrap: { flex: 1, paddingHorizontal: SPACING.md },
  fullBleed: { flex: 1 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: {
    minHeight: 44,
    paddingHorizontal: SPACING.md,
    borderRadius: radius.md,
    backgroundColor: FILL_ELEVATED,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { ...TEXT.subhead, fontFamily: FONT.medium },
  haveCode: { alignSelf: 'flex-end', paddingTop: SPACING.sm },
  haveCodeText: { ...TEXT.footnote, fontFamily: FONT.medium },
  referralInput: { marginTop: SPACING.sm },
});
