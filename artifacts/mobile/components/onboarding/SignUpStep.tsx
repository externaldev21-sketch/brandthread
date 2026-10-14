/**
 * Sign up — the first onboarding screen, for buyers and sellers alike.
 *
 * Grailed's sign-up, reskinned: one caps headline, the buyer/seller choice
 * as two plain radio rows (SSENSE puts its shop-preference radios on the
 * register form the same way), date of birth, then Apple / Google / email
 * as square buttons. Email opens Grailed's sheet: Email, Password, NEXT
 * pinned at the bottom, then the 6-digit code.
 *
 * Kept from the old auth step: the age gate and terms agreement before any
 * account is created (email, Google or Apple), Clerk sign-up + email code,
 * the "account already exists" branch, the signed-in "finish setting up"
 * case, add-account mode and the signup_* analytics events.
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, useSignUp, useUser } from '@clerk/expo';
import { track } from '@/lib/analytics';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { LegalContinueNotice } from '@/components/legal/LegalConsent';
import { rememberPendingConsent } from '@/lib/legalConsent';
import { checkDobInput, formatDobInput, setPendingDob } from '@/lib/ageGate';
import {
  isOAuthCancellationError,
  isOAuthFlowComplete,
  mapOAuthError,
  oauthProviderVisibility,
} from '@/lib/oauthFlow';
import { mapClerkError } from '@/lib/onboarding/clerkErrors';
import type { Flow } from '@/lib/onboardingFlow';
import { ChoiceRow, Field, Headline, Body, ONB_TYPE, SquareButton, StepScreen, TextAction, useKitTheme } from './kit';

type Phase = 'choose' | 'email' | 'verify' | 'existing';

export interface SignUpStepProps {
  flow: Flow | null;
  onSelectFlow: (flow: Flow) => void;
  signUp: ReturnType<typeof useSignUp>['signUp'];
  startGoogleOAuth: () => Promise<any>;
  startAppleOAuth: () => Promise<any>;
  /** Persist the chosen flow before leaving for Clerk (PENDING_FLOW_KEY resume). */
  onBeforeAuth: (flow: Flow) => void;
  /** OAuth / native sign-up finished without a remount. */
  onAuthComplete: () => void;
  /** Already signed in (resuming unfinished onboarding): continue with the chosen flow. */
  onContinueSignedIn: () => void;
  onSignOutAndRestart: () => Promise<void>;
  referralCode: string;
  allowSignedInAccountCreation?: boolean;
  /** Dev web preview user: no real account is made, so the auth buttons are skipped. */
  skipAuth?: boolean;
}

export function SignUpStep({
  flow,
  onSelectFlow,
  signUp,
  startGoogleOAuth,
  startAppleOAuth,
  onBeforeAuth,
  onAuthComplete,
  onContinueSignedIn,
  onSignOutAndRestart,
  referralCode,
  allowSignedInAccountCreation = false,
  skipAuth = false,
}: SignUpStepProps) {
  const theme = useKitTheme();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { apple: appleEnabled, google: googleEnabled } = oauthProviderVisibility(Platform.OS, {
    apple: useFeatureFlag('oauthAppleEnabled'),
    google: useFeatureFlag('oauthGoogleEnabled'),
  });

  const [phase, setPhase] = useState<Phase>('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [dobText, setDobText] = useState('');
  const [dobError, setDobError] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOAuthLoading] = useState<'' | 'Apple' | 'Google'>('');
  const [restarting, setRestarting] = useState(false);

  const busy = loading || !!oauthLoading;
  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? '';

  /** Age gate: the DOB is checked here and held in memory only; the server keeps the band. */
  function requireAge(): boolean {
    const check = checkDobInput(dobText, { seller: flow === 'seller' });
    if (!check.ok) { setDobError(check.error); setPendingDob(null); return false; }
    setDobError(null);
    setPendingDob(check.dob);
    return true;
  }

  /** Every way into an account passes the same gate. Continuing is the terms agreement. */
  function beforeAccount(): boolean {
    if (!flow) { setError('Choose Shop or Sell.'); return false; }
    if (!requireAge()) return false;
    void rememberPendingConsent();
    onBeforeAuth(flow);
    setError('');
    return true;
  }

  async function handleOAuth(start: () => Promise<any>, provider: 'Apple' | 'Google') {
    if (busy || !beforeAccount()) return;
    setOAuthLoading(provider);
    track('signup_started', { method: provider.toLowerCase() });
    try {
      const result = await start();
      if (result?.createdSessionId && result?.setActive) {
        await result.setActive({ session: result.createdSessionId });
      }
      if (isOAuthFlowComplete(result)) {
        track('signup_completed', { method: provider.toLowerCase() });
        onAuthComplete();
      } else if (result?.signUp) {
        setError(`${provider} sign-in needs one more step. Try again.`);
      }
    } catch (e) {
      if (!isOAuthCancellationError(e)) setError(mapOAuthError(provider, e));
    } finally {
      setOAuthLoading('');
    }
  }

  function openEmail() {
    if (busy || !beforeAccount()) return;
    setPhase('email');
  }

  const canSubmitEmail = /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 8;

  async function handleEmailSignUp() {
    if (!canSubmitEmail || loading) return;
    if (isSignedIn && !allowSignedInAccountCreation) {
      setError(`You're signed in${currentEmail ? ` as ${currentEmail}` : ''}. Sign out to create another account.`);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error: err } = await signUp.password({ emailAddress: email.trim().toLowerCase(), password });
      if (err) {
        const inner = (err as any)?.errors?.[0] ?? err;
        if (String(inner?.code ?? '').toLowerCase() === 'form_identifier_exists') setPhase('existing');
        else setError(mapClerkError(err));
        return;
      }
      track('signup_started', { method: 'email' });
      await signUp.verifications.sendEmailCode();
      setPhase('verify');
    } catch (e: any) {
      const inner = e?.errors?.[0] ?? e;
      if (String(inner?.code ?? '').toLowerCase() === 'form_identifier_exists') setPhase('existing');
      else setError(mapClerkError(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (code.length !== 6 || loading) return;
    setLoading(true);
    setError('');
    try {
      const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code });
      if (verifyError) {
        setError("That code isn't right. Check your email and try again.");
        return;
      }
      if (signUp.status === 'complete') {
        track('signup_completed', { method: 'email' });
        await signUp.finalize({
          navigate: ({ decorateUrl }: { decorateUrl: (url: string) => string }) => {
            const referralQuery = referralCode ? `&referralCode=${encodeURIComponent(referralCode)}` : '';
            const addAccountQuery = allowSignedInAccountCreation ? '&addAccount=1' : '';
            const destination = `/onboarding?postAuth=1${addAccountQuery}${referralQuery}`;
            const url = decorateUrl(destination);
            if (url.startsWith('http') && typeof window !== 'undefined') window.location.href = url;
            else router.replace(destination as never);
          },
        });
        onAuthComplete();
      }
    } catch (e) {
      setError(mapClerkError(e));
    } finally {
      setLoading(false);
    }
  }

  const back = (to: Phase) => (
    <BackChevron onPress={() => { setPhase(to); setError(''); }} />
  );

  // ── Email: Grailed's sheet ────────────────────────────────────────────────
  if (phase === 'email') {
    return (
      <StepScreen
        headerRight={null}
        testID="onboarding-sign-up-email"
        footer={(
          <SquareButton
            testID="onboarding-email-next"
            label="Next"
            onPress={() => { void handleEmailSignUp(); }}
            disabled={!canSubmitEmail}
            loading={loading}
          />
        )}
      >
        {back('choose')}
        <Headline>Sign up</Headline>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          autoFocus
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoComplete="new-password"
          textContentType="newPassword"
          hint={password.length > 0 && password.length < 8 ? 'At least 8 characters' : null}
          right={(
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              hitSlop={8}
              style={styles.show}
            >
              <Text style={[ONB_TYPE.small, { color: theme.muted }]}>{showPassword ? 'Hide' : 'Show'}</Text>
            </Pressable>
          )}
        />
        {error ? <ErrorText message={error} /> : null}
      </StepScreen>
    );
  }

  // ── 6-digit code ──────────────────────────────────────────────────────────
  if (phase === 'verify') {
    return (
      <StepScreen
        testID="onboarding-sign-up-verify"
        footer={(
          <SquareButton
            testID="onboarding-verify"
            label="Verify"
            onPress={() => { void handleVerify(); }}
            disabled={code.length !== 6}
            loading={loading}
          />
        )}
      >
        {back('email')}
        <Headline>Check your email</Headline>
        <Body>Enter the 6-digit code we sent to {email.trim()}.</Body>
        <Field
          label="Verification code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          style={styles.code}
        />
        {error ? <ErrorText message={error} /> : null}
        <View style={styles.gapTop}>
          <TextAction label="Resend code" onPress={() => { void signUp.verifications.sendEmailCode(); }} />
        </View>
      </StepScreen>
    );
  }

  // ── Email already has an account ──────────────────────────────────────────
  if (phase === 'existing') {
    return (
      <StepScreen
        footer={(
          <>
            <SquareButton label="Sign in" onPress={() => router.replace('/sign-in' as never)} />
            <TextAction
              label="Use a different email"
              onPress={() => { setPhase('email'); setEmail(''); setPassword(''); setError(''); }}
            />
          </>
        )}
      >
        {back('email')}
        <Headline>Account exists</Headline>
        <Body>There's already a Brandthread account for {email.trim()}. Sign in to keep going.</Body>
      </StepScreen>
    );
  }

  const flowChoice = (
    <View style={styles.choice} accessibilityRole="radiogroup">
      <Text style={[ONB_TYPE.caps, { color: theme.muted, marginBottom: 4 }]}>I'M HERE TO</Text>
      <ChoiceRow label="Shop" selected={flow === 'buyer'} onPress={() => onSelectFlow('buyer')} testID="onboarding-account-type-buyer" />
      <ChoiceRow label="Sell" selected={flow === 'seller'} onPress={() => onSelectFlow('seller')} testID="onboarding-account-type-seller" />
    </View>
  );

  // ── Signed in already, onboarding unfinished ──────────────────────────────
  if ((isSignedIn && !allowSignedInAccountCreation) || skipAuth) {
    return (
      <StepScreen
        testID="onboarding-sign-up-signed-in"
        footer={(
          <>
            <SquareButton
              testID="onboarding-account-type-continue"
              label="Continue"
              onPress={() => { if (flow) { onBeforeAuth(flow); onContinueSignedIn(); } }}
              disabled={!flow}
            />
            <TextAction
              label="Sign out and start over"
              onPress={() => {
                if (restarting) return;
                setRestarting(true);
                void onSignOutAndRestart().finally(() => setRestarting(false));
              }}
            />
          </>
        )}
      >
        <Headline>Finish setting up</Headline>
        <Body>{currentEmail ? `Signed in as ${currentEmail}.` : "You're signed in."}</Body>
        {flowChoice}
      </StepScreen>
    );
  }

  // ── Choose: Shop / Sell, birthday, Apple / Google / email ─────────────────
  // The first visible way in is the filled button; Apple leads on iOS
  // (App Store 4.8 asks for it to be at least as prominent as Google).
  const methods: Array<{ key: 'apple' | 'google' | 'email'; label: string }> = [
    ...(appleEnabled ? [{ key: 'apple' as const, label: 'Continue with Apple' }] : []),
    ...(googleEnabled ? [{ key: 'google' as const, label: 'Continue with Google' }] : []),
    { key: 'email' as const, label: 'Continue with email' },
  ];
  return (
    <StepScreen
      testID="onboarding-sign-up"
      headerRight={<TextAction label="Sign in" onPress={() => router.replace('/sign-in' as never)} testID="onboarding-sign-in-link" />}
      footer={(
        <>
          {methods.map((m, i) => (
            <SquareButton
              key={m.key}
              testID={`onboarding-sign-up-${m.key}`}
              label={m.label}
              variant={i === 0 ? 'primary' : 'outline'}
              loading={(m.key === 'apple' && oauthLoading === 'Apple') || (m.key === 'google' && oauthLoading === 'Google')}
              disabled={busy}
              onPress={() => {
                if (m.key === 'apple') void handleOAuth(startAppleOAuth, 'Apple');
                else if (m.key === 'google') void handleOAuth(startGoogleOAuth, 'Google');
                else openEmail();
              }}
            />
          ))}
          <LegalContinueNotice style={styles.legal} />
        </>
      )}
    >
      <Headline>Sign up</Headline>
      {flowChoice}
      <Field
        testID="onboarding-dob-input"
        label="Date of birth"
        placeholder="MM/DD/YYYY"
        value={dobText}
        onChangeText={(t) => { setDobText(formatDobInput(t)); setDobError(null); }}
        keyboardType="number-pad"
        maxLength={10}
        error={dobError}
        hint="Not shown on your profile."
      />
      {error ? <ErrorText message={error} /> : null}
    </StepScreen>
  );
}

function BackChevron({ onPress }: { onPress: () => void }) {
  const theme = useKitTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={12}
      style={styles.back}
      testID="onboarding-back"
    >
      <Feather name="chevron-left" size={24} color={theme.text} />
    </Pressable>
  );
}

function ErrorText({ message }: { message: string }) {
  const theme = useKitTheme();
  return <Text style={[ONB_TYPE.small, { color: theme.error, marginTop: 16 }]} accessibilityLiveRegion="polite">{message}</Text>;
}

const styles = StyleSheet.create({
  choice: { marginTop: 28 },
  back: { alignSelf: 'flex-start', marginLeft: -6, marginBottom: 12 },
  show: { paddingHorizontal: 14, paddingVertical: 14 },
  code: { letterSpacing: 8, fontSize: 20 },
  gapTop: { marginTop: 20, alignItems: 'flex-start' },
  legal: { textAlign: 'left', marginTop: 4 },
});
