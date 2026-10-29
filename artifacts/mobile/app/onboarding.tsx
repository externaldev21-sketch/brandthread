/**
 * First-run onboarding (launch rebuild). Every screen copies a reference app
 * on Mobbin 1:1, reskinned to the active theme and the system font — see
 * lib/onboardingFlow.ts for the step list and components/onboarding/launch/
 * for the screens and the Mobbin URL each one matches.
 *
 *   Sign up (TikTok) → birthday (TikTok) → email (Depop) → code
 *   → username (Depop) → photo (Instagram) → interest (Depop) → brands (Depop)
 *   → sizes (Depop) → notifications (Cash App) → Shop or Sell (Etsy)
 *   → sellers: store name + stage (Depop "Start selling") → store setup.
 *
 * Auth is real Clerk only (email code, Apple, Google). Nothing here fakes a
 * session; the dev-only `previewUser=1` path (web dev builds) skips Clerk and
 * never writes completion state.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { useAuth, useSignIn, useSignUp, useSSO, useUser } from '@clerk/expo';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { rememberPendingConsent } from '@/lib/legalConsent';
import { checkDobInput, setPendingDob, submitPendingAge, type AgeBand } from '@/lib/ageGate';
import { hydrateMyProfileFromAccount, setSellerFollowing, socialKeysForUser } from '@/services/socialService';
import { DEFAULT_BUYER_PROFILE, saveBuyerProfileForUser } from '@/lib/buyerProfile';
import { registerGrantedPushToken } from '@/lib/contextualPushPermission';
import { queueBuyerOnboardingSync, isRecoverableBuyerOnboardingSyncError, syncBuyerOnboarding } from '@/lib/buyerOnboardingSync';
import { EMPTY_SURVEY, saveBuyerSurvey, type OnboardingSurvey } from '@/lib/onboardingSurvey';
import {
  APPLE_OAUTH_STRATEGY,
  isOAuthCancellationError,
  isOAuthFlowComplete,
  makeBrandthreadRedirectUri,
  mapOAuthError,
  oauthProviderVisibility,
} from '@/lib/oauthFlow';
import {
  DRAFT_VERSION,
  FIRST_PROFILE_STEP,
  isAuthStep,
  nextProfileStep,
  prevProfileStep,
  progressFor,
  restoreDraftStep,
  type Flow,
  type StepId,
} from '@/lib/onboardingFlow';
import { PENDING_DRAFT_KEY, isPendingDraftFresh, parsePendingSignUp, pendingDraftBelongsTo, resolveResumeStep } from '@/lib/onboardingDraft';
import { isClerkKeyInvalid, mapClerkError } from '@/lib/onboarding/clerkErrors';
import type { DiscoverBrand } from '@/services/discoverService';
import { WelcomeScreen, type WelcomeMode } from '@/components/onboarding/launch/WelcomeScreen';
import { BirthdayScreen, CodeScreen, DetailsScreen, EmailScreen } from '@/components/onboarding/launch/AuthScreens';
import {
  BrandsScreen,
  InterestScreen,
  NotificationsScreen,
  PhotoScreen,
  RoleScreen,
  SizesScreen,
  StageScreen,
  StoreScreen,
  UsernameScreen,
  type Department,
} from '@/components/onboarding/launch/ProfileScreens';
import { ClerkKeyBanner } from '@/components/onboarding/launch/ClerkKeyBanner';
import { OnboardingStepTransition } from '@/components/onboarding/OnboardingStepTransition';
import { ONBOARDING_KEY, ONBOARDING_OWNER_KEY } from './_layout';

WebBrowser.maybeCompleteAuthSession();

const DRAFT_KEY_PREFIX = 'onboarding_draft:';
const LEGACY_DRAFT_KEY = 'onboarding_draft';
const PENDING_FLOW_KEY = 'onboarding_pending_flow';
const PENDING_USERNAME_KEY = 'onboarding_pending_username';

type AuthMethod = 'email' | 'apple' | 'google';
type Provider = 'apple' | 'google';
type ProfileWorkOutcome = { step: 'PHOTO' | 'BRANDS'; error?: string; followedIds?: string[] };

function draftKeyForUser(userId?: string | null): string | null {
  return userId ? `${DRAFT_KEY_PREFIX}${userId}` : null;
}

function isUsernameTakenError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && /username/i.test(error.message);
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (isClerkKeyInvalid(error)) return 'Your account couldn’t be verified because of a server setup problem. Please try again later.';
  if (error instanceof ApiError) {
    if (error.status === 0 || error.status >= 500) return `${fallback} Check your connection and try again.`;
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function OnboardingScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const { signUp } = useSignUp();
  const { signIn } = useSignIn();
  const { startSSOFlow } = useSSO();
  const params = useLocalSearchParams<{ addAccount?: string; referralCode?: string; previewUser?: string }>();
  const isAddAccount = params.addAccount === '1';
  const isDevWebPreviewUser = __DEV__ && Platform.OS === 'web' && params.previewUser === '1';
  const referralCode = typeof params.referralCode === 'string'
    ? params.referralCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    : '';

  const providers = oauthProviderVisibility(Platform.OS, {
    apple: useFeatureFlag('oauthAppleEnabled'),
    google: useFeatureFlag('oauthGoogleEnabled'),
  });

  // ── Step + answers ─────────────────────────────────────────────────────────
  const [step, setStep] = useState<StepId>(isDevWebPreviewUser ? FIRST_PROFILE_STEP : 'WELCOME');
  const [direction, setDirection] = useState<1 | -1>(1);
  const currentStep = useRef(step);
  currentStep.current = step;
  const [ready, setReady] = useState(isDevWebPreviewUser);
  const [welcomeMode, setWelcomeMode] = useState<WelcomeMode>('signup');
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [dob, setDob] = useState('');
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeMode, setCodeMode] = useState<'signup' | 'signin'>('signup');
  const [needs, setNeeds] = useState({ password: false, name: false });
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const [username, setUsername] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; mimeType?: string | null } | null>(null);
  const [photoUploadedUri, setPhotoUploadedUri] = useState<string | null>(null);
  const [department, setDepartment] = useState<Department | null>(null);
  const [brands, setBrands] = useState<DiscoverBrand[]>([]);
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [sizes, setSizes] = useState<OnboardingSurvey['sizes']>(EMPTY_SURVEY.sizes);
  const [role, setRole] = useState<Flow | null>(null);
  const [storeName, setStoreName] = useState('');
  const [stage, setStage] = useState<string | null>(null);

  const sourceUserId = useRef<string | null | undefined>(isAddAccount ? undefined : null);
  const restored = useRef(false);
  const emailRequest = useRef(0);
  const profileWork = useRef<Partial<Record<'PHOTO' | 'BRANDS', Promise<ProfileWorkOutcome>>>>({});
  const currentOwner = useRef(user?.id);
  currentOwner.current = user?.id;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { profileWork.current = {}; }, [user?.id]);

  const go = useCallback((next: StepId, travel?: 1 | -1) => {
    setDirection(travel ?? (next === backTarget(currentStep.current) ? -1 : 1));
    setError('');
    currentStep.current = next;
    setStep(next);
  }, [role]);

  // ── Restore (signed-in users resume where they left off) ─────────────────
  useEffect(() => {
    if (isDevWebPreviewUser || restored.current) return;
    if (!authLoaded || (isSignedIn && !userLoaded)) return;
    if (isAddAccount && sourceUserId.current === undefined) {
      // Add-account: the account that's already signed in is only where we
      // came from — start a clean sign-up and never touch its draft.
      sourceUserId.current = user?.id ?? null;
      restored.current = true;
      setReady(true);
      return;
    }
    restored.current = true;
    if (!isSignedIn || !user?.id) {
      // Signed out: pick up what was typed before a reload, so nothing is asked twice.
      void (async () => {
        try {
          const pending = parsePendingSignUp(await AsyncStorage.getItem(PENDING_DRAFT_KEY));
          if (!pending || !isPendingDraftFresh(pending)) return;
          const dobCheck = pending.dobInput ? checkDobInput(pending.dobInput) : null;
          setDob(pending.dobInput);
          if (dobCheck?.ok) { setPendingDob(dobCheck.dob); setAgeBand(dobCheck.band); }
          setAuthMethod(pending.authMethod);
          setEmail(pending.email);
          setCodeMode(pending.codeMode);
          setFirstName(pending.firstName);
          setLastName(pending.lastName);
          // Clerk keeps the open sign-up/sign-in across reloads; if it's gone,
          // the email screen (address kept) sends a fresh code in one tap.
          const held = pending.codeMode === 'signin'
            ? (signIn as { identifier?: string | null } | undefined)?.identifier
            : (signUp as { emailAddress?: string | null } | undefined)?.emailAddress;
          const signUpPending = pending.stepId === 'CODE' && !!pending.email && (held ?? '').toLowerCase() === pending.email;
          const resume = resolveResumeStep(
            { stepId: pending.stepId, authMethod: pending.authMethod, email: pending.email, dob: dobCheck?.ok ? dobCheck.dob : null },
            { accountReady: false, signUpPending, emailVerified: false },
          );
          setStep(resume === 'DETAILS' ? 'EMAIL' : resume);
        } catch {
          // A missing or unreadable draft just starts at Welcome.
        } finally {
          setReady(true);
        }
      })();
      return;
    }
    void (async () => {
      try {
        await AsyncStorage.removeItem(LEGACY_DRAFT_KEY);
        // The birthday typed before verification belongs to this account until /auth/age succeeds.
        const pending = parsePendingSignUp(await AsyncStorage.getItem(PENDING_DRAFT_KEY));
        if (pending?.dobInput && pendingDraftBelongsTo(pending, user.primaryEmailAddress?.emailAddress)) {
          const dobCheck = checkDobInput(pending.dobInput);
          if (dobCheck.ok) { setPendingDob(dobCheck.dob); setAgeBand(dobCheck.band); }
        }
        const raw = await AsyncStorage.getItem(draftKeyForUser(user.id)!);
        const draft = raw ? JSON.parse(raw) : null;
        const owned = draft && draft.ownerId === user.id;
        setStep(restoreDraftStep(owned ? draft : null, true));
        if (owned && draft.version === DRAFT_VERSION) {
          setUsername(typeof draft.username === 'string' ? draft.username : '');
          setDepartment(draft.department ?? null);
          setFollowedIds(Array.isArray(draft.followedIds) ? draft.followedIds : []);
          setSizes(draft.sizes && typeof draft.sizes === 'object' ? draft.sizes : {});
          setRole(draft.role === 'buyer' || draft.role === 'seller' ? draft.role : null);
          setStoreName(typeof draft.storeName === 'string' ? draft.storeName : '');
          setStage(typeof draft.stage === 'string' ? draft.stage : null);
          setPhotoUploadedUri(typeof draft.photoUploadedUri === 'string' ? draft.photoUploadedUri : null);
          // Resume unacknowledged background writes instead of losing the choice.
          if (typeof draft.pendingPhoto?.uri === 'string') {
            setPhoto({ uri: draft.pendingPhoto.uri, mimeType: draft.pendingPhoto.mimeType ?? null });
            setStep('PHOTO');
          }
          if (Array.isArray(draft.pendingBrands)) {
            const pendingBrands = draft.pendingBrands.filter((b: DiscoverBrand) => typeof b?.sellerId === 'string' && typeof b?.name === 'string');
            if (pendingBrands.length) {
              setBrands(pendingBrands);
              if (!draft.pendingPhoto?.uri) setStep('BRANDS');
            }
          }
        } else {
          const pending = await AsyncStorage.getItem(PENDING_USERNAME_KEY);
          if (pending) setUsername(pending);
        }
      } catch {
        setStep(FIRST_PROFILE_STEP);
      } finally {
        setReady(true);
      }
    })();
  }, [authLoaded, isAddAccount, isDevWebPreviewUser, isSignedIn, user?.id, userLoaded]);

  // ── Persist the signed-in answers per Clerk user ─────────────────────────
  useEffect(() => {
    const key = draftKeyForUser(user?.id);
    if (!ready || !key || isAuthStep(step)) return;
    if (isAddAccount && user?.id === sourceUserId.current) return;
    const t = setTimeout(() => {
      AsyncStorage.setItem(key, JSON.stringify({
        version: DRAFT_VERSION, ownerId: user!.id, step, username, department, followedIds, sizes, role, storeName, stage, photoUploadedUri,
        pendingPhoto: photo && !photoUploadedUri ? photo : null,
        pendingBrands: brands.filter((b) => !followedIds.includes(b.sellerId)),
      })).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [brands, department, followedIds, isAddAccount, photo, photoUploadedUri, ready, role, sizes, stage, step, storeName, user?.id, username]);

  // ── Persist the answers typed before the account exists ─────────────────
  // Device-scoped (no user id yet); cleared on sign-out by AuthGate and once
  // the age is sent. Never the password or the code.
  useEffect(() => {
    if (!ready || isAddAccount || isDevWebPreviewUser || isSignedIn || !isAuthStep(step)) return;
    const t = setTimeout(() => {
      AsyncStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify({
        version: DRAFT_VERSION, stepId: step, authMethod: authMethod ?? 'email', email: email.trim().toLowerCase(),
        codeMode, firstName, lastName, dobInput: dob, savedAt: Date.now(),
      })).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [authMethod, codeMode, dob, email, firstName, isAddAccount, isDevWebPreviewUser, isSignedIn, lastName, ready, step]);

  // Android hardware back follows the on-screen back.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const back = backTarget(step);
      if (!back) return false;
      if (step === 'CODE') editEmail();
      else go(back);
      return true;
    });
    return () => sub.remove();
  });

  function backTarget(id: StepId): StepId | null {
    switch (id) {
      case 'WELCOME': return null;
      case 'BIRTHDAY': return 'WELCOME';
      case 'EMAIL': return 'BIRTHDAY';
      case 'CODE': return 'EMAIL';
      case 'DETAILS': return 'CODE';
      case 'STORE': return 'ROLE';
      case 'STAGE': return 'STORE';
      default: return prevProfileStep(id, role);
    }
  }

  /**
   * Back and "Wrong email? Edit" on the code step both land on the email
   * field with the address kept and editable; Continue there sends a new code.
   */
  function editEmail() {
    if (currentStep.current === 'CODE') go('EMAIL', -1);
  }

  // ── Signed in → first profile step ───────────────────────────────────────
  const onSignedIn = useCallback(() => {
    setBusy(null);
    void AsyncStorage.multiSet([[ONBOARDING_KEY, 'false']]).catch(() => {});
    // An existing account that already finished onboarding is routed out of
    // here by AuthGate (server profile); a new one continues.
    go(FIRST_PROFILE_STEP);
  }, [go]);

  // ── Welcome / birthday ───────────────────────────────────────────────────
  function chooseMethod(method: AuthMethod) {
    setError('');
    if (welcomeMode === 'login') {
      if (method === 'email') {
        // Carry an address typed earlier in this attempt so it isn't asked again.
        const query = [isAddAccount ? 'addAccount=1' : '', email.trim() ? `email=${encodeURIComponent(email.trim().toLowerCase())}` : ''].filter(Boolean).join('&');
        router.push((query ? `/sign-in?${query}` : '/sign-in') as never);
        return;
      }
      void runSSO(method);
      return;
    }
    setAuthMethod(method);
    go('BIRTHDAY');
  }

  function continueFromBirthday() {
    const check = checkDobInput(dob);
    if (!check.ok) { setError(check.error); setPendingDob(null); return; }
    setPendingDob(check.dob);
    setAgeBand(check.band);
    void rememberPendingConsent();
    if (authMethod === 'apple' || authMethod === 'google') { void runSSO(authMethod); return; }
    go('EMAIL');
  }

  async function runSSO(provider: Provider) {
    setBusy(provider);
    setError('');
    if (welcomeMode === 'login') void rememberPendingConsent();
    try {
      const result = await startSSOFlow({
        strategy: provider === 'apple' ? APPLE_OAUTH_STRATEGY : 'oauth_google',
        redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri),
      });
      if (result?.createdSessionId && result?.setActive) await result.setActive({ session: result.createdSessionId });
      if (isOAuthFlowComplete(result)) { onSignedIn(); return; }
      setError(`${provider === 'apple' ? 'Apple' : 'Google'} sign-in needs one more step. Please try again.`);
    } catch (e) {
      if (!isOAuthCancellationError(e)) setError(isClerkKeyInvalid(e) ? mapClerkError(e) : mapOAuthError(provider === 'apple' ? 'Apple' : 'Google', e));
    } finally {
      setBusy(null);
    }
  }

  // ── Email + code ─────────────────────────────────────────────────────────
  async function continueFromEmail() {
    if (busy) return;
    const address = email.trim().toLowerCase();
    const attempt = ++emailRequest.current;
    setBusy('email');
    setError('');
    setCode('');
    go('CODE');
    const isCurrent = () => mounted.current && emailRequest.current === attempt && currentStep.current === 'CODE';
    const fail = (message: string) => {
      if (!isCurrent()) return;
      go('EMAIL', -1);
      setError(message);
    };
    try {
      const created = await signUp.create({ emailAddress: address });
      if (!isCurrent()) return;
      const createErr = created.error as any;
      const exists = createErr && ((createErr.errors?.[0]?.code ?? createErr.code) === 'form_identifier_exists');
      if (exists) {
        // Depop: one field for both. This email has an account → log in by code.
        const sent = await signIn.emailCode.sendCode({ emailAddress: address });
        if (!isCurrent()) return;
        if (sent.error) { fail(mapClerkError(sent.error)); return; }
        setCodeMode('signin');
      } else if (createErr) {
        fail(mapClerkError(createErr));
        return;
      } else {
        const sent = await signUp.verifications.sendEmailCode();
        if (!isCurrent()) return;
        if (sent.error) { fail(mapClerkError(sent.error)); return; }
        setCodeMode('signup');
      }
    } catch (e) {
      fail(mapClerkError(e));
    } finally {
      if (mounted.current && emailRequest.current === attempt) {
        setBusy((current) => current === 'email' ? null : current);
      }
    }
  }

  async function resendCode() {
    const res = codeMode === 'signin'
      ? await signIn.emailCode.sendCode({ emailAddress: email.trim().toLowerCase() })
      : await signUp.verifications.sendEmailCode();
    if (res.error) throw new Error(mapClerkError(res.error));
  }

  async function verifyCode(value: string) {
    if (value.length !== 6 || busy) return;
    setBusy('code');
    setError('');
    try {
      if (codeMode === 'signin') {
        const res = await signIn.emailCode.verifyCode({ code: value });
        if (res.error) { setError(mapClerkError(res.error)); setCode(''); return; }
        if (signIn.status === 'complete') { await signIn.finalize(); onSignedIn(); return; }
        if (signIn.status === 'needs_second_factor') {
          setError('This account uses two-step verification. Log in with your authenticator code to continue.');
          router.replace(`/sign-in?email=${encodeURIComponent(email.trim().toLowerCase())}` as never);
          return;
        }
        setError('Couldn’t log you in. Try again.');
        return;
      }
      const res = await signUp.verifications.verifyEmailCode({ code: value });
      if (res.error) { setError(mapClerkError(res.error)); setCode(''); return; }
      await completeSignUpOrAskDetails();
    } catch (e) {
      setError(mapClerkError(e));
    } finally {
      setBusy(null);
    }
  }

  /** Finishes the Clerk sign-up, or asks only for what this Clerk instance still requires. */
  async function completeSignUpOrAskDetails() {
    if (signUp.status === 'complete') {
      const fin = await signUp.finalize();
      if (fin.error) { setError(mapClerkError(fin.error)); return; }
      onSignedIn();
      return;
    }
    const missing = (signUp.missingFields ?? []) as string[];
    const password = missing.includes('password');
    const name = missing.includes('first_name') || missing.includes('last_name');
    const unsupported = missing.filter((f) => !['password', 'first_name', 'last_name'].includes(f));
    if (unsupported.length) {
      setError(`Sign-up needs ${unsupported.join(', ')}, which this app doesn’t collect yet. Contact support.`);
      return;
    }
    setNeeds({ password, name });
    go('DETAILS');
  }

  async function continueFromDetails() {
    setBusy('details');
    setError('');
    try {
      if (needs.name) {
        const res = await signUp.update({ firstName: firstName.trim(), lastName: lastName.trim() });
        if (res.error) { setError(mapClerkError(res.error)); return; }
      }
      if (needs.password) {
        const res = await signUp.password({ password });
        if (res.error) { setError(mapClerkError(res.error)); return; }
      }
      if (signUp.status !== 'complete') {
        setError('Couldn’t finish creating your account. Check your details and try again.');
        return;
      }
      const fin = await signUp.finalize();
      if (fin.error) { setError(mapClerkError(fin.error)); return; }
      onSignedIn();
    } catch (e) {
      setError(mapClerkError(e));
    } finally {
      setBusy(null);
    }
  }

  // ── Profile steps ────────────────────────────────────────────────────────
  const displayName = (): string => {
    const full = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
      || [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
    return full.length >= 2 ? full : username;
  };

  function advance(from: StepId, nextRole: Flow | null = role) {
    const next = nextProfileStep(from, nextRole);
    if (next) go(next);
  }

  /** The server profile row must exist before uploads / follows. Idempotent. */
  async function ensureServerUser() {
    return api.auth.sync({ name: displayName() });
  }

  function continueFromUsername() {
    void AsyncStorage.setItem(PENDING_USERNAME_KEY, username).catch(() => {});
    advance('USERNAME');
  }

  function continueFromPhoto() {
    if (!photo) { advance('PHOTO'); return; }
    const selectedPhoto = photo;
    const owner = user?.id;
    setError('');
    // Optional uploads must not hold the next screen behind a network round trip.
    // Completion below still waits for them and routes failures back for retry.
    let work!: Promise<ProfileWorkOutcome>;
    work = (async (): Promise<ProfileWorkOutcome> => {
      try {
        await ensureServerUser();
        if (!mounted.current || currentOwner.current !== owner) return { step: 'PHOTO' };
        const res = await api.auth.uploadAvatar(selectedPhoto);
        if (mounted.current && currentOwner.current === owner && profileWork.current.PHOTO === work) {
          setPhotoUploadedUri(res.profileImageUrl);
        }
        return { step: 'PHOTO' };
      } catch (e) {
        return { step: 'PHOTO', error: apiErrorMessage(e, 'Couldn’t upload your picture.') };
      }
    })();
    profileWork.current.PHOTO = work;
    advance('PHOTO');
  }

  function continueFromBrands() {
    const owner = user?.id;
    const selectedBrands = [...brands];
    const previouslyFollowed = [...followedIds];
    setError('');
    let work!: Promise<ProfileWorkOutcome>;
    work = (async (): Promise<ProfileWorkOutcome> => {
      try {
        await ensureServerUser();
        if (!mounted.current || currentOwner.current !== owner) return { step: 'BRANDS' };
        const toFollow = selectedBrands.filter((b) => !previouslyFollowed.includes(b.sellerId));
        const results = await Promise.allSettled(toFollow.map((b) => setSellerFollowing(b.sellerId, true)));
        const ok = toFollow.filter((_, i) => results[i].status === 'fulfilled').map((b) => b.sellerId);
        const nextFollowed = [...new Set([...previouslyFollowed, ...ok])];
        if (mounted.current && currentOwner.current === owner && profileWork.current.BRANDS === work) {
          setFollowedIds(nextFollowed);
        }
        const failed = toFollow.filter((_, i) => results[i].status === 'rejected');
        return {
          step: 'BRANDS', followedIds: nextFollowed,
          // One summary line, however many follows failed.
          ...(failed.length ? { error: `Couldn’t follow ${failed.length === 1 ? failed[0].name : `${failed.length} brands`}. Try again or skip.` } : {}),
        };
      } catch (e) {
        return { step: 'BRANDS', error: apiErrorMessage(e, 'Couldn’t follow those brands.') };
      }
    })();
    profileWork.current.BRANDS = work;
    advance('BRANDS');
  }

  async function settleProfileWork(): Promise<{ followedIds: string[] } | null> {
    const owner = currentOwner.current;
    const outcomes = await Promise.all(Object.values(profileWork.current));
    if (!mounted.current || currentOwner.current !== owner) return null;
    const failed = outcomes.find((outcome) => outcome.error);
    if (failed) {
      setBusy(null);
      go(failed.step, -1);
      setError(failed.error!);
      return null;
    }
    return { followedIds: outcomes.find((outcome) => outcome.step === 'BRANDS')?.followedIds ?? followedIds };
  }

  function skipProfileWork(from: 'PHOTO' | 'BRANDS') {
    // Explicit Skip dismisses a failed optional write, not an acknowledged one.
    delete profileWork.current[from];
    if (from === 'PHOTO') setPhoto(null);
    else setBrands([]);
    advance(from);
  }

  async function turnOnNotifications() {
    setBusy('notifications');
    advance('NOTIFICATIONS');
    try {
      if (Platform.OS !== 'web') {
        const current = await Notifications.getPermissionsAsync();
        if (current.status !== 'granted' && current.canAskAgain !== false) await Notifications.requestPermissionsAsync();
      }
    } catch {
      // Push is optional: a failure or denial never blocks onboarding.
    } finally {
      setBusy((current) => current === 'notifications' ? null : current);
    }
  }

  function continueFromRole() {
    if (!role) return;
    if (role === 'seller' && ageBand === '13_17') { setError('You must be 18 or older to sell.'); return; }
    void AsyncStorage.setItem(PENDING_FLOW_KEY, role).catch(() => {});
    if (role === 'buyer') { void finishBuyer(); return; }
    advance('ROLE', 'seller');
  }

  // ── Finish ───────────────────────────────────────────────────────────────
  async function finishBuyer(retryAttempt = false) {
    if (busy === 'finish') return;
    if (isDevWebPreviewUser && typeof window !== 'undefined') { window.location.assign('/?bt_preview=buyer'); return; }
    setBusy('finish');
    setError('');
    const styleInterests = department ? [department] : [];
    let survey: OnboardingSurvey = { sizes, likedBrandIds: followedIds };
    let profileId: string | null = null;
    let failureStage = 'profile';
    try {
      const pending = await settleProfileWork();
      if (!pending) return;
      survey = { sizes, likedBrandIds: pending.followedIds };
      const name = displayName();
      const profile = await api.auth.sync({ name });
      profileId = profile.clerkId;
      await submitPendingAge(api);
      await AsyncStorage.removeItem(PENDING_DRAFT_KEY).catch(() => {});
      const updated = await api.auth.updateProfile({
        name, displayName: name, accountType: 'buyer', expectedClerkId: profile.clerkId, username,
      });
      await hydrateMyProfileFromAccount({
        userId: profile.clerkId, name: updated.displayName || updated.name || name, username: updated.username ?? username, bio: updated.bio,
      }, socialKeysForUser(profile.clerkId));
      await saveBuyerProfileForUser(profile.clerkId, {
        ...DEFAULT_BUYER_PROFILE, name: updated.displayName || updated.name || name, username: updated.username ?? username,
      });
      if (referralCode) await api.referrals.apply(referralCode, profile.clerkId).catch(() => {});
      failureStage = 'completion';
      await queueBuyerOnboardingSync(profile.clerkId, styleInterests);
      await syncBuyerOnboarding(profile.clerkId, styleInterests, api);
      await saveBuyerSurvey(profile.clerkId, survey, styleInterests, api);
      await markComplete(profile.clerkId, 'buyer');
      router.replace('/thread-explainer' as never);
    } catch (e) {
      setBusy(null);
      console.error('[onboarding] buyer save failed', { stage: failureStage, status: e instanceof ApiError ? e.status : undefined, message: e instanceof Error ? e.message : String(e) });
      if (isUsernameTakenError(e)) { go('USERNAME'); setError('That username was just taken. Choose another.'); return; }
      // The queued sync retries on the next launch (AuthGate), so a second
      // recoverable failure still lets the buyer in.
      if (retryAttempt && failureStage === 'completion' && profileId && isRecoverableBuyerOnboardingSyncError(e)) {
        void saveBuyerSurvey(profileId, survey, styleInterests, api);
        await markComplete(profileId, 'buyer').catch(() => {});
        router.replace('/thread-explainer' as never);
        return;
      }
      setError(apiErrorMessage(e, 'We couldn’t finish setting up your profile.'));
    }
  }

  async function finishSeller() {
    if (busy === 'finish' || !stage) return;
    if (isDevWebPreviewUser && typeof window !== 'undefined') { window.location.assign('/?bt_preview=seller'); return; }
    setBusy('finish');
    setError('');
    try {
      const pending = await settleProfileWork();
      if (!pending) return;
      const name = displayName();
      const profile = await api.auth.sync({ name });
      await submitPendingAge(api);
      await AsyncStorage.removeItem(PENDING_DRAFT_KEY).catch(() => {});
      await api.auth.onboarding({ brandName: storeName.replace(/\s+/g, ' ').trim(), brandStage: stage, username });
      await api.auth.updateProfile({ name, displayName: name, accountType: 'seller', expectedClerkId: profile.clerkId });
      if (referralCode) await api.referrals.apply(referralCode, profile.clerkId).catch(() => {});
      // Interest / sizes / followed brands are buyer-side answers; a seller
      // shops too, so they're kept on the same preference record.
      await saveBuyerSurvey(profile.clerkId, { sizes, likedBrandIds: pending.followedIds }, department ? [department] : [], api);
      await api.auth.completeOnboarding('seller');
      await markComplete(profile.clerkId, 'seller');
      api.ai.brandMemoryRebuild().catch(() => {});
      // Depop: "Start selling" ends in the shop setup. Dashboard underneath,
      // so finishing store setup lands on it.
      router.replace('/(tabs)/' as never);
      router.push('/store-setup-brand' as never);
    } catch (e) {
      setBusy(null);
      console.error('[onboarding] seller save failed', { status: e instanceof ApiError ? e.status : undefined, message: e instanceof Error ? e.message : String(e) });
      if (isUsernameTakenError(e)) { go('USERNAME'); setError('That username was just taken. Choose another.'); return; }
      if (e instanceof ApiError && e.code === 'AGE_RESTRICTED') { go('ROLE'); setError(e.message); return; }
      setError(apiErrorMessage(e, 'We couldn’t open your store.'));
    }
  }

  async function markComplete(clerkId: string, accountType: Flow) {
    await AsyncStorage.multiSet([
      [ONBOARDING_KEY, 'true'],
      [ONBOARDING_OWNER_KEY, clerkId],
      ['user_role', accountType],
      ...(accountType === 'seller' ? [['onboarding_brand_name', storeName.trim()] as [string, string]] : []),
    ]);
    await AsyncStorage.multiRemove([draftKeyForUser(clerkId)!, LEGACY_DRAFT_KEY, PENDING_FLOW_KEY, PENDING_USERNAME_KEY, PENDING_DRAFT_KEY]);
    void registerGrantedPushToken(clerkId, api);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (!ready) return <View style={[s.root, { backgroundColor: theme.background }]} />;

  const progress = progressFor(step, role);
  const back = backTarget(step);
  const onBack = back ? () => go(back) : undefined;
  const isBusy = (key: string) => busy === key;

  function renderStep() {
  switch (step) {
    case 'WELCOME':
      return (
        <WelcomeScreen
          mode={welcomeMode}
          onToggleMode={() => { setError(''); setWelcomeMode((m) => (m === 'signup' ? 'login' : 'signup')); }}
          onEmail={() => chooseMethod('email')}
          onApple={providers.apple ? () => chooseMethod('apple') : undefined}
          onGoogle={providers.google ? () => chooseMethod('google') : undefined}
          onClose={isAddAccount ? () => router.back() : undefined}
          busy={busy === 'apple' || busy === 'google' ? busy : null}
          error={error}
          inviteApplied={!!referralCode}
          devBanner={<ClerkKeyBanner />}
        />
      );
    case 'BIRTHDAY':
      return <BirthdayScreen value={dob} onChange={(v) => { setDob(v); setError(''); }} error={error} onBack={() => go('WELCOME')} onContinue={continueFromBirthday} busy={busy === 'apple' || busy === 'google'} />;
    case 'EMAIL':
      return <EmailScreen value={email} onChange={(v) => { setEmail(v); setError(''); }} error={error} onBack={() => go('BIRTHDAY')} onContinue={() => { void continueFromEmail(); }} busy={isBusy('email')} />;
    case 'CODE':
      return <CodeScreen email={email.trim().toLowerCase()} code={code} onChange={(v) => { setCode(v); setError(''); }} onComplete={(v) => { void verifyCode(v); }} error={error} onBack={editEmail} onEditEmail={editEmail} onResend={resendCode} busy={isBusy('code') || isBusy('email')} />;
    case 'DETAILS':
      return (
        <DetailsScreen
          needsPassword={needs.password}
          needsName={needs.name}
          password={password}
          onPassword={setPassword}
          firstName={firstName}
          onFirstName={setFirstName}
          lastName={lastName}
          onLastName={setLastName}
          error={error}
          onBack={() => go('CODE')}
          onContinue={() => { void continueFromDetails(); }}
          busy={isBusy('details')}
        />
      );
    case 'USERNAME':
      return (
        <UsernameScreen
          value={username}
          onChange={(v) => { setUsername(v); setError(''); }}
          seed={{ firstName: user?.firstName ?? firstName, lastName: user?.lastName ?? lastName, email: user?.primaryEmailAddress?.emailAddress ?? email }}
          submitError={error}
          onContinue={continueFromUsername}
          progress={progress}
          onBack={onBack}
        />
      );
    case 'PHOTO':
      return (
        <PhotoScreen
          uri={photo?.uri ?? photoUploadedUri}
          onPicked={(a) => { setPhoto(a); setPhotoUploadedUri(null); setError(''); }}
          onContinue={() => { void continueFromPhoto(); }}
           onSkip={() => skipProfileWork('PHOTO')}
          busy={isBusy('photo')}
          error={error}
          progress={progress}
          onBack={onBack}
        />
      );
    case 'INTEREST':
      return <InterestScreen value={department} onPick={(d) => { setDepartment(d); advance('INTEREST'); }} onSkip={() => advance('INTEREST')} progress={progress} onBack={onBack} />;
    case 'BRANDS':
      return (
        <BrandsScreen
          selected={brands}
          onChange={(b) => { setBrands(b); setError(''); }}
          onContinue={() => { void continueFromBrands(); }}
           onSkip={() => skipProfileWork('BRANDS')}
          busy={isBusy('brands')}
          error={error}
          progress={progress}
          onBack={onBack}
        />
      );
    case 'SIZES':
      return <SizesScreen sizes={sizes} onChange={setSizes} onContinue={() => advance('SIZES')} onSkip={() => advance('SIZES')} progress={progress} onBack={onBack} />;
    case 'NOTIFICATIONS':
      return <NotificationsScreen onTurnOn={() => { void turnOnNotifications(); }} onSkip={() => advance('NOTIFICATIONS')} busy={isBusy('notifications')} progress={progress} onBack={onBack} />;
    case 'ROLE':
      return <RoleScreen value={role} onChange={(r) => { setRole(r); setError(''); }} onContinue={continueFromRole} busy={isBusy('finish')} error={error} progress={progressFor('ROLE', role)} onBack={onBack} />;
    case 'STORE':
      return <StoreScreen value={storeName} onChange={(v) => { setStoreName(v); setError(''); }} onContinue={() => advance('STORE')} onBack={() => go('ROLE')} error={error} />;
    case 'STAGE':
      return <StageScreen value={stage} onChange={(v) => { setStage(v); setError(''); }} onContinue={() => { void finishSeller(); }} onBack={() => go('STORE')} busy={isBusy('finish')} error={error} />;
    default:
      return null;
  }
  }

  return (
    // No edge-swipe back on the code step (mid-verification): the header back
    // and "Wrong email? Edit" both return to the email field instead.
    <OnboardingStepTransition stepId={step} direction={direction} onBack={step === 'CODE' ? undefined : onBack}>
      {renderStep()}
    </OnboardingStepTransition>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
});
