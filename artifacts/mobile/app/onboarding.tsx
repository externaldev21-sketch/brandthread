/**
 * Brandthread onboarding — buyer and seller, from Sign up to landing in the app.
 *
 * Step order, skip rules and draft migration live in lib/onboardingFlow.ts.
 * Every screen is drawn with components/onboarding/kit.tsx (SSENSE's type
 * and spacing, Grailed's fields and buttons): a "01 / 04" counter, one caps
 * headline, one sentence, one square button.
 *
 * BOTH:   0=SignUp (Shop/Sell, birthday, Apple / Google / email)  1=Profile
 * BUYER:  2=Brands  3=Sizes  4=Notifications
 * SELLER: 2=BrandName  3=Notifications
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Platform, StatusBar, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth, useSSO, useSignUp, useUser } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { ONBOARDING_KEY, ONBOARDING_OWNER_KEY } from './_layout';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { submitPendingAge } from '@/lib/ageGate';
import { hydrateMyProfileFromAccount, socialKeysForUser } from '@/services/socialService';
import { DEFAULT_BUYER_PROFILE, saveBuyerProfileForUser } from '@/lib/buyerProfile';
import { registerGrantedPushToken } from '@/lib/contextualPushPermission';
import {
  queueBuyerOnboardingSync,
  isRecoverableBuyerOnboardingSyncError,
  syncBuyerOnboarding,
} from '@/lib/buyerOnboardingSync';
import { ApiError } from '@/lib/networkNotice';
import { APPLE_OAUTH_STRATEGY, makeBrandthreadRedirectUri } from '@/lib/oauthFlow';
import {
  BUYER_STEP_INDEX,
  SELLER_STEP_INDEX,
  DRAFT_VERSION,
  restoreDraftStep,
  stepCounterFor,
  type Flow,
} from '@/lib/onboardingFlow';
import { EMPTY_SURVEY, hasSurveyAnswers, sanitizeDraftSurvey, saveBuyerSurvey, type OnboardingSurvey } from '@/lib/onboardingSurvey';
import { BrandsToFollowStep } from '@/components/onboarding/BrandsToFollowStep';
import { SizesStep } from '@/components/onboarding/SizesStep';
import { SignUpStep } from '@/components/onboarding/SignUpStep';
import { ProfileStep } from '@/components/onboarding/ProfileStep';
import { NotificationsStep } from '@/components/onboarding/NotificationsStep';
import { Body, Field, Headline, SquareButton, StepScreen } from '@/components/onboarding/kit';

// Required on Android so the in-app browser tab closes after OAuth redirect
WebBrowser.maybeCompleteAuthSession();

const LEGACY_DRAFT_KEY = 'onboarding_draft';
const DRAFT_KEY_PREFIX = 'onboarding_draft:';
const PENDING_FLOW_KEY = 'onboarding_pending_flow';
const PENDING_USERNAME_KEY = 'onboarding_pending_username';

function draftKeyForUser(userId?: string | null): string | null {
  return userId ? `${DRAFT_KEY_PREFIX}${userId}` : null;
}

export default function OnboardingScreen() {
  const { theme } = useAppTheme();
  const { isSignedIn, signOut, isLoaded: authLoaded } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const startGoogleOAuth = useCallback(() => startSSOFlow({ strategy: 'oauth_google', redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri) }), [startSSOFlow]);
  const startAppleOAuth = useCallback(() => startSSOFlow({ strategy: APPLE_OAUTH_STRATEGY, redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri) }), [startSSOFlow]);
  const api = useApi();
  const router = useRouter();

  const {
    postAuth,
    addAccount,
    referralCode: referralCodeParam,
    deviceFlow,
    deviceStep,
    deviceProbe,
    previewUser,
  } = useLocalSearchParams<{
    postAuth?: string;
    addAccount?: string;
    referralCode?: string;
    deviceFlow?: string;
    deviceStep?: string;
    deviceProbe?: string;
    previewUser?: string;
  }>();
  const isAddAccount = addAccount === '1';
  const isDevWebPreviewUser = __DEV__ && Platform.OS === 'web' && previewUser === '1';
  const deviceProbeEnabled = __DEV__ && deviceProbe === '1';
  const deviceProbeFlow: Flow | null = __DEV__ && (deviceFlow === 'buyer' || deviceFlow === 'seller')
    ? deviceFlow
    : null;
  const parsedDeviceStep = Number(deviceStep);
  const deviceProbeStep = deviceProbeFlow && Number.isInteger(parsedDeviceStep)
    ? Math.max(0, parsedDeviceStep)
    : 0;

  // The Shop / Sell choice. It's the flow from the moment it's picked: the
  // choice sits on the Sign up screen itself, so there's nothing to confirm.
  // Shop is preselected — most people arrive to shop.
  const [flow, setFlow] = useState<Flow | null>(deviceProbeFlow ?? 'buyer');
  const [step, setStep] = useState(deviceProbeStep);
  const [ready, setReady] = useState(deviceProbeEnabled);
  const [addAccountSourceUserId, setAddAccountSourceUserId] = useState<string | null | undefined>(
    isAddAccount ? undefined : null,
  );

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  // Mirrored into a device-scoped key immediately so a remount (e.g. the web
  // postAuth redirect) can't silently drop it before the per-user draft exists.
  const updateUsername = useCallback((value: string) => {
    setUsername(value);
    void AsyncStorage.setItem(PENDING_USERNAME_KEY, value).catch(() => {});
  }, []);
  // Invite links (/invite/CODE) carry the code here; it's applied after the account exists.
  const [referralCode] = useState(
    typeof referralCodeParam === 'string'
      ? referralCodeParam.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
      : '',
  );
  // Only what the buyer actually picked is saved — no preselected interests.
  const styleInterests: string[] = [];
  const [survey, setSurvey] = useState<OnboardingSurvey>(EMPTY_SURVEY);
  const setSurveySizes = useCallback((sizes: OnboardingSurvey['sizes']) => setSurvey((prev) => ({ ...prev, sizes })), []);
  const setSurveyBrands = useCallback((likedBrandIds: string[]) => setSurvey((prev) => (
    prev.likedBrandIds.length === likedBrandIds.length && prev.likedBrandIds.every((id, i) => id === likedBrandIds[i])
      ? prev : { ...prev, likedBrandIds }
  )), []);

  const [brandName, setBrandName] = useState('');
  const [finishing, setFinishing] = useState(false);

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
  useEffect(() => {
    if (!deviceProbeEnabled) return;
    setFlow(deviceProbeFlow);
    setStep(deviceProbeStep);
    setReady(true);
    setDeviceTransitionMetric('idle');
    setDeviceFocusMetric('idle');
  }, [deviceProbeEnabled, deviceProbeFlow, deviceProbeStep]);

  // Clerk may take longer than local storage to initialize in a web preview.
  useEffect(() => {
    const fallback = setTimeout(() => setReady(true), 1200);
    return () => clearTimeout(fallback);
  }, []);

  // In add-account mode the already-active account is only the source of the
  // flow. Never restore or overwrite its draft while creating the second identity.
  useEffect(() => {
    if (!isAddAccount || !userLoaded || addAccountSourceUserId !== undefined) return;
    setAddAccountSourceUserId(user?.id ?? null);
  }, [addAccountSourceUserId, isAddAccount, user?.id, userLoaded]);

  // ── Restore draft / resume a pending flow ────────────────────────────────
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
              setStep(restoreDraftStep(draft.flow, draft.step ?? 0, draft.version));
              setFirstName(draft.firstName ?? '');
              setLastName(draft.lastName ?? '');
              setUsername(draft.username ?? '');
              setSurvey(sanitizeDraftSurvey(draft.survey));
              setBrandName(draft.brandName ?? '');
            }
          } catch { /* bad json, ignore */ }
        } else if (!isAddAccount && (pendingFlow === 'buyer' || pendingFlow === 'seller')) {
          // Never honored when adding a second account: the pending pair is a
          // single device-scoped global, meant only to resume this device's own
          // abandoned attempt. Signed in after email verification → straight to
          // Profile; otherwise back on Sign up with the same choice made.
          setFlow(pendingFlow);
          setStep(isSignedIn && postAuth === '1' ? BUYER_STEP_INDEX.PROFILE : 0);
        } else if (isAddAccount && (pendingFlow || pendingUsername)) {
          await AsyncStorage.multiRemove([PENDING_FLOW_KEY, PENDING_USERNAME_KEY]);
        }
        if (pendingUsername && !isAddAccount) {
          setUsername((current) => current || pendingUsername);
        }
      } catch {
        // Local persistence is optional; a storage issue must not block signup.
      } finally {
        setReady(true);
      }
    }
    void init();
  }, [addAccountSourceUserId, authLoaded, userLoaded, isSignedIn, isAddAccount, postAuth, user?.id, deviceProbeEnabled]);

  // OAuth accounts already carry a name; use it as the starting value.
  useEffect(() => {
    if (!user || firstName) return;
    const fromClerk = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    if (fromClerk) setFirstName(fromClerk);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Persist draft ────────────────────────────────────────────────────────
  const saveDraft = useCallback(async () => {
    const userId = user?.id;
    const draftKey = draftKeyForUser(userId);
    if (!draftKey || !userId) return;
    const data = {
      version: DRAFT_VERSION,
      ownerId: userId,
      flow, step, firstName, lastName, username, survey, brandName,
    };
    await AsyncStorage.setItem(draftKey, JSON.stringify(data));
  }, [flow, step, firstName, lastName, username, survey, brandName, user?.id]);

  useEffect(() => {
    if (!user?.id || !ready || !flow) return;
    if (isAddAccount && user.id === addAccountSourceUserId) return;
    const timer = setTimeout(() => {
      saveDraft().catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [addAccountSourceUserId, isAddAccount, user?.id, ready, flow, saveDraft]);

  // Let the screen transition finish before opening the keyboard.
  useEffect(() => {
    const isProfile = step === BUYER_STEP_INDEX.PROFILE;
    const isBrandName = flow === 'seller' && step === SELLER_STEP_INDEX.BRAND_NAME;
    if (!isProfile && !isBrandName) return;
    const timer = setTimeout(() => {
      if (isBrandName) brandNameInputRef.current?.focus();
      else if (!firstName) firstNameInputRef.current?.focus();
    }, 260);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, step]);

  // ── Auth completion (OAuth / native, no remount) ─────────────────────────
  const handleAuthComplete = useCallback(() => {
    transitionTo(BUYER_STEP_INDEX.PROFILE, 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  // OAuth flips isSignedIn while on Sign up — move on to Profile.
  const prevSignedIn = useRef<boolean | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (prevSignedIn.current === null) { prevSignedIn.current = isSignedIn ?? false; return; }
    if (!prevSignedIn.current && isSignedIn && step === 0 && flow) {
      transitionTo(BUYER_STEP_INDEX.PROFILE, 1);
    }
    prevSignedIn.current = isSignedIn ?? false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, ready, flow]);

  // ── Navigation ───────────────────────────────────────────────────────────
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
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (deviceProbeEnabled && sequence === transitionSequence.current) {
          const animationMs = Math.round(performance.now() - animationStartedAt);
          setDeviceTransitionMetric(
            `${flow ?? 'choose'}-${next};firstFrame=${firstFrameMs};animation=${animationMs};phases=${finished ? 1 : 0}`,
          );
        }
      });
    });
  }

  function goNext() {
    transitionTo(step + 1, 1);
  }

  /** Record the choice before Clerk takes over, so a remount resumes the same flow. */
  function persistPendingFlow(chosen: Flow) {
    void AsyncStorage.multiSet([
      [PENDING_FLOW_KEY, chosen],
      [ONBOARDING_KEY, 'false'],
    ]).catch(() => {});
  }

  // ── Finish ───────────────────────────────────────────────────────────────
  // A username can be taken between Profile and the final save (another
  // signup wins the race). Retrying would fail identically, so send the
  // person back to Profile to pick another.
  function isUsernameTakenError(error: unknown): boolean {
    return error instanceof ApiError && error.status === 409 && /username/i.test(error.message);
  }

  function returnToProfileForUsernameConflict() {
    setFinishing(false);
    Alert.alert(
      'Username taken',
      'Someone just took that username. Choose another.',
      [{ text: 'Choose another', onPress: () => transitionTo(BUYER_STEP_INDEX.PROFILE, -1) }],
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
    if (isDevWebPreviewUser && typeof window !== 'undefined') {
      window.location.assign('/?bt_preview=buyer');
      return;
    }
    let profileId: string | null = null;
    let failureStage = 'required-profile';
    let pendingSyncQueued = false;
    try {
      const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || firstName.trim();
      const uname = username.trim().toLowerCase();
      const profile = await api.auth.sync({ name });
      await submitPendingAge(api);
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
      // Sizes + followed brands: best-effort, queued on failure, never blocks completion.
      await saveBuyerSurvey(profile.clerkId, survey, styleInterests, api);
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
      router.replace('/thread-explainer' as never);
    } catch (error) {
      setFinishing(false);
      logBuyerOnboardingFailure(failureStage, error, retryAttempt);
      if (isUsernameTakenError(error)) {
        returnToProfileForUsernameConflict();
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
        void saveBuyerSurvey(profileId, survey, styleInterests, api);
        void syncBuyerOnboarding(profileId, styleInterests, api).catch((backgroundError) => {
          logBuyerOnboardingFailure('background-retry', backgroundError, true);
        });
        router.replace('/thread-explainer' as never);
        return;
      }
      Alert.alert(
        'Setup incomplete',
        profileId && failureStage === 'preferences-or-completion'
          ? 'We couldn’t save your preferences. Try once more, or we’ll finish syncing after you enter the app.'
          : 'We couldn’t finish setting up your profile. Try again.',
        [{ text: 'Retry', onPress: () => { void finishBuyer(true); } }],
      );
    }
  }

  async function finishSeller() {
    if (finishing) return;
    setFinishing(true);
    if (isDevWebPreviewUser && typeof window !== 'undefined') {
      window.location.assign('/?bt_preview=seller');
      return;
    }
    try {
      const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || firstName.trim();
      const uname = username.trim().toLowerCase();
      const profile = await api.auth.sync({ name });
      await submitPendingAge(api);
      await api.auth.onboarding({
        brandName: brandName.trim(),
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
      await api.auth.completeOnboarding('seller');
      await AsyncStorage.multiSet([
        [ONBOARDING_KEY, 'true'],
        [ONBOARDING_OWNER_KEY, profile.clerkId],
        ['user_role', 'seller'],
        ['onboarding_first_name', firstName],
        ['onboarding_brand_name', brandName],
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
        returnToProfileForUsernameConflict();
        return;
      }
      Alert.alert(
        'Setup incomplete',
        'We couldn’t save your store. Check your connection and try again.',
        [{ text: 'Retry', onPress: () => { void finishSeller(); } }],
      );
    }
  }

  // ── Sign out and start over ──────────────────────────────────────────────
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

  // ── Steps ────────────────────────────────────────────────────────────────
  function renderStep() {
    if (step === 0 || !flow) return (
      <>
        <SignUpStep
          flow={flow}
          onSelectFlow={setFlow}
          signUp={signUp}
          startGoogleOAuth={startGoogleOAuth}
          startAppleOAuth={startAppleOAuth}
          onBeforeAuth={persistPendingFlow}
          onAuthComplete={handleAuthComplete}
          onContinueSignedIn={() => transitionTo(BUYER_STEP_INDEX.PROFILE, 1)}
          onSignOutAndRestart={devReset}
          referralCode={referralCode}
          allowSignedInAccountCreation={isAddAccount}
          skipAuth={isDevWebPreviewUser}
        />
        {deviceProbeEnabled && (
          <TouchableOpacity
            testID="onboarding-device-auth-complete"
            accessibilityLabel="Complete auth device probe"
            style={styles.deviceProbeControl}
            onPress={handleAuthComplete}
          />
        )}
      </>
    );

    const counter = stepCounterFor(flow, step);

    if (step === BUYER_STEP_INDEX.PROFILE) return (
      <ProfileStep
        ref={firstNameInputRef}
        counter={counter}
        title={flow === 'buyer' ? 'Your profile' : 'About you'}
        body={flow === 'buyer' ? 'Your name and the handle people find you by.' : 'Your name and your handle on Brandthread.'}
        nameLabel="Name"
        namePlaceholder="First and last name"
        name={firstName}
        onNameChange={(v) => { setFirstName(v); setLastName(''); }}
        username={username}
        onUsernameChange={updateUsername}
        onNameFocus={recordDeviceFocus}
        onNext={goNext}
      />
    );

    if (flow === 'buyer') {
      if (step === BUYER_STEP_INDEX.BRANDS) return (
        <StepScreen
          counter={counter}
          scroll={false}
          testID="onboarding-brands"
          footer={<SquareButton testID="onboarding-next" label={survey.likedBrandIds.length > 0 ? 'Next' : 'Skip'} onPress={goNext} />}
        >
          <BrandsToFollowStep onLikedChange={setSurveyBrands} />
        </StepScreen>
      );
      if (step === BUYER_STEP_INDEX.SIZES) return (
        <StepScreen
          counter={counter}
          scroll={false}
          testID="onboarding-sizes"
          footer={(
            <SquareButton
              testID="onboarding-next"
              label={hasSurveyAnswers({ sizes: survey.sizes, likedBrandIds: [] }) ? 'Next' : 'Skip'}
              onPress={goNext}
            />
          )}
        >
          <SizesStep sizes={survey.sizes} onChange={setSurveySizes} />
        </StepScreen>
      );
      if (step === BUYER_STEP_INDEX.NOTIFICATIONS) return (
        <NotificationsStep
          counter={counter}
          body="Be the first to know about new drops, restocks and replies from brands."
          busy={finishing}
          onDone={() => { void finishBuyer(); }}
        />
      );
    }

    if (flow === 'seller') {
      if (step === SELLER_STEP_INDEX.BRAND_NAME) return (
        <StepScreen
          counter={counter}
          footer={<SquareButton testID="onboarding-next" label="Next" onPress={goNext} disabled={brandName.trim().length < 1} />}
        >
          <Headline>Your store</Headline>
          <Body>Use your brand's name. You can change it later.</Body>
          <Field
            ref={brandNameInputRef}
            testID="onboarding-brand-name-input"
            label="Store name"
            value={brandName}
            onChangeText={setBrandName}
            onFocus={recordDeviceFocus}
            autoCapitalize="words"
            maxLength={60}
          />
        </StepScreen>
      );
      if (step === SELLER_STEP_INDEX.NOTIFICATIONS) return (
        <NotificationsStep
          counter={counter}
          body="Know the moment an order comes in, a payout lands or a customer writes."
          busy={finishing}
          onDone={() => { void finishSeller(); }}
        />
      );
    }
    return null;
  }

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: theme.background }} accessibilityLabel="Loading" />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar barStyle="light-content" />
      <Animated.View
        style={[
          styles.stepWrap,
          {
            opacity: transitionProgress,
            transform: [{
              translateX: transitionProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [transitionDirection.current * 16, 0],
              }),
            }],
          },
        ]}
        testID={`onboarding-step-${flow ?? 'choose'}-${step}`}
        accessibilityLabel={`Onboarding ${flow ?? 'choose'} step ${step}`}
      >
        {renderStep()}
      </Animated.View>
      {deviceProbeEnabled && (
        <View pointerEvents="none" style={styles.deviceProbeMetric}>
          <View accessible testID="onboarding-transition-metric" accessibilityLabel={deviceTransitionMetric} />
          <View accessible testID="onboarding-focus-metric" accessibilityLabel={deviceFocusMetric} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stepWrap: { flex: 1 },
  deviceProbeControl: { position: 'absolute', right: 0, bottom: 0, width: 2, height: 2, opacity: 0.01 },
  deviceProbeMetric: { position: 'absolute', width: 1, height: 1, opacity: 0.01 },
});
