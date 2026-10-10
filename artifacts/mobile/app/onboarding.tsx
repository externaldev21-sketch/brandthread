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
 *           store" (store preview + one free logo) → dashboard.
 *
 * Nothing about payouts or notifications is asked here: payouts live on the
 * dashboard checklist, and push permission is requested at the first
 * follow / order / message (lib/contextualPushPermission.ts).
 *
 * Resume: every change is saved as a draft (password and code excluded), so
 * reopening the app lands on the same step with the same answers.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useAuth, useSSO, useSignUp, useUser } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
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
  firstStepAfterAccount,
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
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
    >
      <Text style={[styles.chipText, { color: selected ? theme.text : theme.muted }]}>{label}</Text>
    </Pressable>
  );
}

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
    flow: flowParam,
  } = useLocalSearchParams<{
    postAuth?: string;
    addAccount?: string;
    start?: string;
    referralCode?: string;
    deviceFlow?: string;
    deviceStep?: string;
    deviceProbe?: string;
    previewUser?: string;
    /** Set by "Start selling" / "Shop as a buyer" (Accounts session). */
    flow?: string;
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
        const storedFlow = await AsyncStorage.getItem(PENDING_FLOW_KEY).catch(() => null);
        const landingFlow = flowParam === 'buyer' || flowParam === 'seller' ? flowParam : storedFlow;
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
          } else if (landingFlow === 'buyer' || landingFlow === 'seller') {
            // The role is already known ("Start selling" / "Shop as a buyer"
            // created this profile, or the landing page picked it): go
            // straight to the first profile step, even after a relaunch.
            accountCreatedRef.current = true;
            setSelectedFlow(landingFlow);
            setFlow(landingFlow);
            setStepId(firstStepAfterAccount(landingFlow));
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
            existing={existingEmail && existingEmail === email.trim().toLowerCase() ? {
              // Which role the email has is only known for an account signed in
              // on this device (Accounts session's lookup, #806); never guess.
              role: null,
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
            onDone={() => { void finishSeller(); }}
            finishing={finishing}
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
    && stepId !== 'BUILDING'
    && (stepId === 'ACCOUNT_TYPE' ? !isAddAccount && !accountReady : (!!flow && prevStepId(flow, stepId, ctx) !== null));
  const ownsBottomInset = SELLER_QUESTION_STEPS.includes(stepId) || stepId === 'ACCOUNT_TYPE' || stepId === 'BUILDING'
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
