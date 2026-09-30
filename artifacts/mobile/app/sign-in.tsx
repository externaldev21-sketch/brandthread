/**
 * Sign-in screen — Brandthread premium dark design
 *
 * TikTok/Instagram-style: one field accepts an email address or phone
 * number, "Send code" leads to a 6-digit one-time-code screen (auto-advance
 * + paste via OtpCodeInput, resend timer), with a password an explicit
 * alternative. Also: Google/Apple OAuth, TOTP 2FA, and the "add account"
 * flow (see components/AccountSwitcherSheet.tsx).
 *
 * Forgot password is untouched — it's its own screen (app/forgot-password.tsx)
 * with its own custom email-code-based reset, not part of this flow.
 */
import React, { useEffect, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  Alert, View, Text, TextInput, StyleSheet, Platform, ActivityIndicator,
  ScrollView, StatusBar,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import GoogleGlyph from '@/components/branding/GoogleGlyph';
import { useSignIn, useSSO, useAuth, useUser, useClerk } from '@clerk/expo';
import { wasPreviousSessionDropped, MULTI_SESSION_OFF_MESSAGE } from '@/lib/multiSessionMode';
import { detectIdentifierKind, normalizePhoneNumber, isPhoneStrategyUnsupportedError } from '@/lib/signInIdentifier';
import { OtpCodeInput } from '@/components/auth/OtpCodeInput';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Avatar } from '@/components/ui/Avatar';
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticPrimaryAction, hapticToggle } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import {
  APPLE_OAUTH_STRATEGY,
  isOAuthCancellationError,
  makeBrandthreadRedirectUri,
  mapOAuthError,
} from '@/lib/oauthFlow';

WebBrowser.maybeCompleteAuthSession();

const RESEND_COOLDOWN_SECONDS = 30;

type AuthStep = 'identifier' | 'password' | 'code';

export default function SignInScreen() {
  const { signIn, fetchStatus } = useSignIn();
  const { isSignedIn, signOut, sessionId: preAddAccountSessionId } = useAuth();
  const { user }                = useUser();
  const { startSSOFlow } = useSSO();
  const clerk = useClerk();

  const router = useRouter();
  const { addAccount } = useLocalSearchParams<{ addAccount?: string }>();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const isAddAccount = addAccount === '1';
  const appleOAuthEnabled = useFeatureFlag('oauthAppleEnabled');
  const googleOAuthEnabled = useFeatureFlag('oauthGoogleEnabled');
  const showAppleOAuth = Platform.OS === 'ios' && appleOAuthEnabled;
  const showAnyOAuth = showAppleOAuth || googleOAuthEnabled;

  // Warm up the browser on Android for faster OAuth sheet presentation
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  const [step, setStep]             = useState<AuthStep>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword]     = useState('');
  const passwordRef = useRef<TextInput>(null);
  const [showPw, setShowPw]         = useState(false);
  const [oauthLoading, setOAuth]    = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Best-effort: this app has no way to ask Clerk "is phone sign-in on for
  // this instance" up front. Stays true until a real attempt tells us
  // otherwise, at which point the phone option quietly stops being offered
  // for the rest of this screen's lifetime (see isPhoneStrategyUnsupportedError).
  const [phoneSupported, setPhoneSupported] = useState(true);

  // One-time-code step
  const [code, setCode]             = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeError, setCodeError]   = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);

  // Second-factor (TOTP) step, shown when the account has 2FA turned on.
  const [needsTotp, setNeedsTotp]   = useState(false);
  const [totpCode, setTotpCode]     = useState('');
  const [totpError, setTotpError]   = useState('');
  const [totpLoading, setTotpLoading] = useState(false);

  const isFetching = fetchStatus === 'fetching' || loading;
  const identifierKind = detectIdentifierKind(identifier);
  const canSendCode = identifierKind !== 'invalid' && (identifierKind !== 'phone' || phoneSupported) && !sendingCode;
  const canSubmitPassword = identifierKind !== 'invalid' && password.length >= 1;
  const canVerifyTotp = totpCode.length === 6;
  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? '';
  const showPreviewUser = __DEV__ && Platform.OS === 'web' && !isAddAccount;

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setInterval(() => setResendSeconds((s2) => Math.max(0, s2 - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendSeconds]);

  // Clerk is external and gives this app no way to read its Dashboard
  // "multi-session" setting directly. If it's off, activating the new
  // session below will have silently signed the previous account out — the
  // only way to know is to check whether that previous session is still in
  // the client's session list right after.
  function checkMultiSessionDrop() {
    if (!isAddAccount || !preAddAccountSessionId) return;
    if (wasPreviousSessionDropped(preAddAccountSessionId, clerk.client?.sessions)) {
      Alert.alert('Heads up', MULTI_SESSION_OFF_MESSAGE);
    }
  }

  function finalizeSignIn() {
    return signIn.finalize({
      navigate: ({ decorateUrl }) => {
        // The account switcher is a sheet on the profile screen now (see
        // components/AccountSwitcherSheet.tsx), not its own route — landing
        // on '/' after an add-account sign-in shows the newly-active
        // account's profile, where the switcher can be reopened at any time.
        checkMultiSessionDrop();
        const destination = '/';
        const url = decorateUrl(destination);
        if (url.startsWith('http') && typeof window !== 'undefined') {
          window.location.href = url;
        } else {
          router.replace(destination as Href);
        }
      },
    });
  }

  /** Common "what happened after a first factor was submitted" handling, shared by password and code verification. */
  async function resolveAfterFirstFactor() {
    if (signIn.status === 'complete') {
      await finalizeSignIn();
    } else if (signIn.status === 'needs_second_factor') {
      setNeedsTotp(true);
    } else {
      setError("Couldn't sign you in. Try again.");
    }
  }

  // ─── One-time code ────────────────────────────────────────────────────────────
  async function sendCode(isResend: boolean) {
    if (identifierKind === 'invalid') { setError('Enter a valid email address or phone number.'); return; }
    if (identifierKind === 'phone' && !phoneSupported) {
      setError("Phone sign-in isn't available yet — try your email instead.");
      return;
    }
    setSendingCode(true);
    setError('');
    if (!isResend) setCodeError('');
    try {
      const { error: err } = identifierKind === 'email'
        ? await signIn.emailCode.sendCode({ emailAddress: identifier.trim().toLowerCase() })
        : await signIn.phoneCode.sendCode({ phoneNumber: normalizePhoneNumber(identifier) });
      if (err) {
        if (identifierKind === 'phone' && isPhoneStrategyUnsupportedError(err)) {
          setPhoneSupported(false);
          setError("Phone sign-in isn't available yet — try your email instead.");
          return;
        }
        (isResend ? setCodeError : setError)(mapError(err));
        return;
      }
      setCode('');
      setResendSeconds(RESEND_COOLDOWN_SECONDS);
      if (!isResend) setStep('code');
    } catch (e: any) {
      if (identifierKind === 'phone' && isPhoneStrategyUnsupportedError(e)) {
        setPhoneSupported(false);
        setError("Phone sign-in isn't available yet — try your email instead.");
        return;
      }
      (isResend ? setCodeError : setError)(mapError(e));
    } finally {
      setSendingCode(false);
    }
  }

  async function handleVerifyCode(submitted?: string) {
    const value = submitted ?? code;
    if (value.length !== 6 || verifyingCode) return;
    setVerifyingCode(true);
    setCodeError('');
    try {
      const { error: err } = identifierKind === 'email'
        ? await signIn.emailCode.verifyCode({ code: value })
        : await signIn.phoneCode.verifyCode({ code: value });
      if (err) { setCodeError("That code isn't right. Try again."); setCode(''); return; }
      await resolveAfterFirstFactor();
    } catch (e: any) {
      setCodeError(mapError(e));
      setCode('');
    } finally {
      setVerifyingCode(false);
    }
  }

  // ─── Password ─────────────────────────────────────────────────────────────────
  async function handlePasswordSignIn() {
    if (!canSubmitPassword || isFetching) return;
    setLoading(true);
    setError('');
    try {
      const { error: err } = await signIn.password({ identifier: identifier.trim(), password });
      if (err) { setError(mapError(err)); return; }
      await resolveAfterFirstFactor();
    } catch (e: any) {
      setError(mapError(e));
    } finally {
      setLoading(false);
    }
  }

  // ─── 2FA (TOTP) ───────────────────────────────────────────────────────────────
  async function handleVerifyTotp() {
    if (!canVerifyTotp || totpLoading) return;
    setTotpLoading(true);
    setTotpError('');
    try {
      const { error: err } = await signIn.mfa.verifyTOTP({ code: totpCode });
      if (err) { setTotpError("That code isn't right. Try again."); return; }
      if (signIn.status === 'complete') {
        await finalizeSignIn();
      } else {
        setTotpError("Couldn't sign you in. Try again.");
      }
    } catch (e: any) {
      setTotpError(mapError(e));
    } finally {
      setTotpLoading(false);
    }
  }

  // ─── Sign out ─────────────────────────────────────────────────────────────────
  async function handleSignOut() {
    setSigningOut(true);
    try { await signOut(); } catch {}
    setSigningOut(false);
  }

  // ─── OAuth ────────────────────────────────────────────────────────────────────
  async function handleOAuth(strategy: 'oauth_google' | 'oauth_apple', provider: string) {
    setOAuth(provider);
    setError('');
    try {
      const result = await startSSOFlow({
        strategy,
        redirectUrl: makeBrandthreadRedirectUri(AuthSession.makeRedirectUri),
      });
      const { createdSessionId, setActive, signIn: ssoSignIn, signUp: ssoSignUp } = result as any;

      if (createdSessionId && setActive) {
        // Existing user — activate the session; AuthGate will route by user_role
        await setActive({ session: createdSessionId });
        if (isAddAccount) { checkMultiSessionDrop(); router.replace('/' as never); }
      } else if (ssoSignIn?.status === 'complete' || ssoSignUp?.status === 'complete') {
        // Session was created by Clerk automatically — AuthGate picks it up
        if (isAddAccount) { checkMultiSessionDrop(); router.replace('/' as never); }
      } else if (ssoSignUp) {
        // Brand-new user with no account yet — send them through onboarding
        router.replace('/onboarding' as never);
      }
      // If user cancelled (result with no session) we fall through silently
    } catch (e: any) {
      if (isOAuthCancellationError(e)) {
        setOAuth(''); return;
      }
      setError(mapOAuthError(provider, e));
    } finally {
      setOAuth('');
    }
  }

  function goToIdentifierStep() {
    setStep('identifier');
    setPassword('');
    setCode('');
    setCodeError('');
    setError('');
  }

  // ─── Active session screen ────────────────────────────────────────────────────
  if (isSignedIn && !isAddAccount) {
    return (
      <View style={[s.root, { paddingTop: useHeaderTopInset() }]}>
        <StatusBar barStyle="light-content" />

        <ScrollView
          contentContainerStyle={[s.scroll, s.sessionScroll, { paddingBottom: insets.bottom + 36 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back */}
          <IconButton
            name="arrow-left"
            variant="plain"
            size={20}
            color={theme.muted}
            style={s.backBtn}
            accessibilityLabel="Go back"
            onPress={() => goBackOr(router, '/onboarding')}
          />

          {/* Logo */}
          <View style={s.logoRow}>
            <BrandthreadLogo size={36} />
            <Text style={s.logoText}>BRANDTHREAD</Text>
          </View>

          <Text style={s.headline}>You're already{'\n'}signed in.</Text>
          <Text style={s.subtitle}>
            {currentEmail
              ? `You are currently signed in as ${currentEmail}.`
              : 'You have an active session.'}
          </Text>

          {/* Info card */}
          <View style={s.sessionCard}>
            <View style={s.sessionAvatarRow}>
              <Avatar
                name={user?.firstName ? `${user.firstName} ${user.lastName ?? ''}` : currentEmail}
                size={48}
              />
              <View style={{ flex: 1 }}>
                <Text style={s.sessionName} numberOfLines={1}>
                  {user?.firstName ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : 'Your account'}
                </Text>
                <Text style={s.sessionEmail} numberOfLines={1}>{currentEmail}</Text>
              </View>
            </View>
          </View>

          {/* Continue */}
          <Button
            label="Continue with this account"
            onPress={() => router.replace('/' as never)}
            fullWidth
            style={s.primaryWrap}
          />

          {/* Sign out */}
          <Button
            label="Sign out"
            variant="secondary"
            onPress={handleSignOut}
            loading={signingOut}
            fullWidth
          />
        </ScrollView>
      </View>
    );
  }

  // ─── Two-factor (TOTP) screen ─────────────────────────────────────────────────
  if (needsTotp) {
    return (
      <View style={[s.root, { paddingTop: useHeaderTopInset() }]}>
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 36 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <IconButton
              name="arrow-left"
              variant="plain"
              size={20}
              color={theme.muted}
              style={s.backBtn}
              accessibilityLabel="Go back"
              onPress={() => { setNeedsTotp(false); setTotpCode(''); setTotpError(''); }}
            />

            <View style={s.logoRow}>
              <BrandthreadLogo size={36} />
              <Text style={s.logoText}>BRANDTHREAD</Text>
            </View>

            <Text style={s.headline}>Two-factor authentication</Text>
            <Text style={s.subtitle}>Enter the 6-digit code from your authenticator app.</Text>

            <View style={s.fieldWrap}>
              <Text style={s.label}>Code</Text>
              <TextInput
                style={s.input}
                placeholder="000000"
                placeholderTextColor={theme.subtle}
                value={totpCode}
                onChangeText={t => { setTotpCode(t.replace(/[^0-9]/g, '').slice(0, 6)); setTotpError(''); }}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                maxLength={6}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={handleVerifyTotp}
              />
            </View>

            {totpError ? (
              <View style={s.errorBox}>
                <Feather name="alert-circle" size={14} color={theme.error} />
                <Text style={s.errorText}>{totpError}</Text>
              </View>
            ) : null}

            <Button
              label="Verify code"
              onPress={handleVerifyTotp}
              disabled={!canVerifyTotp}
              loading={totpLoading}
              fullWidth
              style={s.primaryWrap}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ─── One-time-code entry screen ───────────────────────────────────────────────
  if (step === 'code') {
    const maskedIdentifier = identifierKind === 'email'
      ? identifier.replace(/^(.{2}).*(@.*)$/, '$1***$2')
      : identifier.replace(/\d(?=\d{2})/g, '•');
    return (
      <View style={[s.root, { paddingTop: useHeaderTopInset() }]}>
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 36 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <IconButton
              name="arrow-left"
              variant="plain"
              size={20}
              color={theme.muted}
              style={s.backBtn}
              accessibilityLabel="Go back"
              onPress={goToIdentifierStep}
              testID="otp-back"
            />

            <View style={s.logoRow}>
              <BrandthreadLogo size={36} />
              <Text style={s.logoText}>BRANDTHREAD</Text>
            </View>

            <Text style={s.headline}>Enter your code</Text>
            <Text style={s.subtitle}>We sent a 6-digit code to {maskedIdentifier}.</Text>

            <View style={s.otpWrap}>
              <OtpCodeInput
                value={code}
                onChangeText={(v) => { setCode(v); setCodeError(''); }}
                onComplete={handleVerifyCode}
                autoFocus
                error={!!codeError}
                disabled={verifyingCode}
                testID="otp-code-input"
              />
            </View>

            {codeError ? (
              <View style={s.errorBox}>
                <Feather name="alert-circle" size={14} color={theme.error} />
                <Text style={s.errorText}>{codeError}</Text>
              </View>
            ) : null}

            <Button
              label="Verify code"
              onPress={() => handleVerifyCode()}
              disabled={code.length !== 6}
              loading={verifyingCode}
              fullWidth
              style={s.primaryWrap}
            />

            <PressableScale
              onPress={() => { if (resendSeconds <= 0) { hapticToggle(); sendCode(true); } }}
              disabled={resendSeconds > 0 || sendingCode}
              accessibilityLabel="Resend code"
              style={s.resendRow}
              testID="otp-resend"
            >
              <Text style={[s.resendText, { color: resendSeconds > 0 ? theme.muted : theme.accent }]}>
                {resendSeconds > 0 ? `Resend code in 0:${String(resendSeconds).padStart(2, '0')}` : 'Resend code'}
              </Text>
            </PressableScale>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ─── Password entry screen ─────────────────────────────────────────────────────
  if (step === 'password') {
    return (
      <View style={[s.root, { paddingTop: useHeaderTopInset() }]}>
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 36 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <IconButton
              name="arrow-left"
              variant="plain"
              size={20}
              color={theme.muted}
              style={s.backBtn}
              accessibilityLabel="Go back"
              onPress={goToIdentifierStep}
              testID="password-back"
            />

            <View style={s.logoRow}>
              <BrandthreadLogo size={36} />
              <Text style={s.logoText}>BRANDTHREAD</Text>
            </View>

            <Text style={s.headline}>Enter your password</Text>
            <Text style={s.subtitle} numberOfLines={1}>Signing in as {identifier}</Text>

            <View style={s.fieldWrap}>
              <View style={s.pwLabelRow}>
                <Text style={s.label}>Password</Text>
                <PressableScale
                  onPress={() => { hapticToggle(); router.push('/forgot-password' as never); }}
                  accessibilityLabel="Forgot password?"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[s.forgotLink, { color: theme.accent }]}>Forgot password?</Text>
                </PressableScale>
              </View>
              <View style={s.pwRow}>
                <TextInput
                  ref={passwordRef}
                  style={[s.input, s.pwInput]}
                  testID="release-check-password"
                  accessibilityLabel="Password"
                  placeholder="••••••••"
                  placeholderTextColor={theme.subtle}
                  value={password}
                  onChangeText={t => { setPassword(t); setError(''); }}
                  secureTextEntry={!showPw}
                  textContentType="password"
                  autoComplete="current-password"
                  returnKeyType="go"
                  autoFocus
                  onSubmitEditing={handlePasswordSignIn}
                />
                <IconButton
                  name={showPw ? 'eye-off' : 'eye'}
                  variant="plain"
                  size={18}
                  color={theme.muted}
                  style={s.eyeBtn}
                  accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
                  onPress={() => setShowPw(v => !v)}
                />
              </View>
            </View>

            {error ? (
              <View style={s.errorBox}>
                <Feather name="alert-circle" size={14} color={theme.error} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            <Button
              label="Sign in"
              onPress={handlePasswordSignIn}
              disabled={!canSubmitPassword}
              loading={isFetching}
              fullWidth
              style={s.primaryWrap}
            />

            <PressableScale
              onPress={() => { hapticToggle(); setPassword(''); setError(''); sendCode(false); }}
              accessibilityLabel="Use a one-time code instead"
              style={s.resendRow}
            >
              <Text style={[s.resendText, { color: theme.accent }]}>Use a one-time code instead</Text>
            </PressableScale>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ─── Identifier entry screen (default) ─────────────────────────────────────────
  return (
    <View style={[s.root, { paddingTop: useHeaderTopInset() }]}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 36 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back */}
          <IconButton
            name="arrow-left"
            variant="plain"
            size={20}
            color={theme.muted}
            style={s.backBtn}
            accessibilityLabel="Go back"
            onPress={() => goBackOr(router, '/onboarding')}
          />

          {/* Logo */}
          <View style={s.logoRow}>
            <BrandthreadLogo size={36} />
            <Text style={s.logoText}>BRANDTHREAD</Text>
          </View>

          {/* Heading */}
          <Text style={s.headline}>{isAddAccount ? 'Add another account.' : 'Welcome back.'}</Text>
          <Text style={s.subtitle}>
            {isAddAccount
              ? 'Sign in to add an existing Brandthread account to this device.'
              : 'Sign in to continue where you left off.'}
          </Text>

          {/* ── OAuth ─────────────────────────────────────────────────────────── */}
          {/* Apple first — solid black button per Apple HIG, iOS only. Shown above
              Google per App Store guideline 4.8: Sign in with Apple must be at
              least as prominent as other third-party social login options. */}
          {showAppleOAuth && (
            <PressableScale
              style={[s.oauthBtn, s.appleBtn]}
              onPress={() => { hapticPrimaryAction(); handleOAuth('oauth_apple', 'Apple'); }}
              accessibilityLabel="Continue with Apple"
              disabled={!!oauthLoading || isFetching}
            >
              {oauthLoading === 'Apple' ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
                  <Text style={[s.oauthText, { color: '#FFFFFF' }]}>Continue with Apple</Text>
                </>
              )}
            </PressableScale>
          )}

          {/* Google — dark surface with Google logo, per Google brand guidelines */}
          {googleOAuthEnabled && (
            <PressableScale
              style={s.oauthBtn}
              onPress={() => { hapticPrimaryAction(); handleOAuth('oauth_google', 'Google'); }}
              accessibilityLabel="Continue with Google"
              disabled={!!oauthLoading || isFetching}
            >
              {oauthLoading === 'Google' ? (
                <ActivityIndicator color={theme.text} size="small" />
              ) : (
                <>
                  <GoogleGlyph size={18} />
                  <Text style={s.oauthText}>Continue with Google</Text>
                </>
              )}
            </PressableScale>
          )}

          {/* Divider */}
          {showAnyOAuth && (
            <View style={s.divider}>
              <View style={s.divLine} />
              <Text style={s.divText}>or</Text>
              <View style={s.divLine} />
            </View>
          )}

          {/* ── Identifier ─────────────────────────────────────────────────────── */}
          <View style={s.fieldWrap}>
            <Text style={s.label}>{phoneSupported ? 'Email or phone number' : 'Email address'}</Text>
            <TextInput
              style={s.input}
              testID="release-check-email"
              accessibilityLabel={phoneSupported ? 'Email or phone number' : 'Email address'}
              placeholder={phoneSupported ? 'you@yourbrand.com or phone number' : 'you@yourbrand.com'}
              placeholderTextColor={theme.subtle}
              value={identifier}
              onChangeText={t => { setIdentifier(t); setError(''); }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={phoneSupported ? 'default' : 'email-address'}
              textContentType="username"
              autoComplete="email"
              returnKeyType="go"
              onSubmitEditing={() => sendCode(false)}
            />
          </View>

          {/* ── Error ──────────────────────────────────────────────────────────── */}
          {error ? (
            <View style={s.errorBox}>
              <Feather name="alert-circle" size={14} color={theme.error} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* ── Send code ──────────────────────────────────────────────────────── */}
          <Button
            label="Send code"
            onPress={() => sendCode(false)}
            disabled={!canSendCode}
            loading={sendingCode}
            fullWidth
            style={s.primaryWrap}
            testID="send-code-button"
          />

          {/* ── Password alternative ──────────────────────────────────────────── */}
          <Button
            label="Use password instead"
            variant="secondary"
            onPress={() => { if (identifierKind !== 'invalid') { setError(''); setStep('password'); } else { setError('Enter a valid email address or phone number first.'); } }}
            fullWidth
            style={s.primaryWrap}
            testID="use-password-button"
          />

          {showPreviewUser && (
            <Button
              label="Continue as preview user"
              variant="secondary"
              testID="continue-as-preview-user"
              onPress={() => {
                hapticToggle();
                router.replace('/onboarding?previewUser=1' as never);
              }}
              fullWidth
              style={s.primaryWrap}
            />
          )}

          {/* ── Create account ─────────────────────────────────────────────────── */}
          <Button
            label="Create an account"
            variant="secondary"
            onPress={() => router.replace('/onboarding' as never)}
            fullWidth
          />

          <View nativeID="clerk-captcha" />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Error mapper ─────────────────────────────────────────────────────────────
function mapError(err: any): string {
  if (!err) return '';
  const inner = err?.errors?.[0] ?? err;
  const code  = (inner?.code ?? '').toLowerCase();
  const msg   = (inner?.message ?? inner?.longMessage ?? err?.message ?? '').toLowerCase();

  if (code === 'form_identifier_not_found' || code === 'form_password_incorrect')
    return 'Incorrect email or password.';
  if (code === 'session_exists' || code === 'identifier_already_signed_in')
    return 'You are already signed in.';
  if (code === 'request_rate_limited')
    return 'Too many attempts. Please wait a moment.';
  if (code === 'network_failure' || code === 'request_timeout')
    return "Couldn't connect. Check your internet and try again.";
  if (code === 'form_param_format_invalid')
    return msg.includes('email') ? 'Enter a valid email address.' : 'One of your entries is invalid.';
  if (code === 'form_code_incorrect')
    return "That code isn't right. Try again.";

  if (msg.includes('incorrect') || msg.includes('invalid password') || msg.includes('no user'))
    return 'Incorrect email or password.';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout'))
    return "Couldn't connect. Check your internet and try again.";
  if (msg.includes('rate limit') || msg.includes('too many'))
    return 'Too many attempts. Please wait a moment.';

  return inner?.message || err?.message || 'Something went wrong. Please try again.';
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root:    { flex: 1, backgroundColor: theme.background },

  scroll: { paddingHorizontal: SPACING.xl, paddingTop: SPACING.md },

  backBtn: { marginBottom: SPACING.lg, alignSelf: 'flex-start' },

  logoRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xxxl - 4 },
  logoText: { fontSize: 12, fontFamily: FONT.bold, color: theme.text, letterSpacing: 2.5 },

  headline: {
    ...TYPE_SCALE.title1,
    color: theme.text, letterSpacing: -0.8, marginBottom: SPACING.xs,
  },
  subtitle: {
    ...TYPE_SCALE.body,
    color: theme.muted, marginBottom: SPACING.xl + SPACING.xxs,
  },

  oauthBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: theme.cardGlass, borderRadius: RADII.card, borderWidth: 1, borderColor: theme.border,
    paddingVertical: 15, marginBottom: SPACING.xs,
  },
  // Apple button: solid black per Apple Human Interface Guidelines
  appleBtn: { backgroundColor: '#000000', borderColor: 'rgba(255,255,255,0.15)' },
  oauthText: { fontSize: 15, fontFamily: FONT.semibold, color: theme.text },

  divider: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginVertical: SPACING.lg },
  divLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
  divText: { ...TYPE_SCALE.footnote, color: theme.muted },

  fieldWrap: { marginBottom: SPACING.md },
  label:     { fontSize: 12, fontFamily: FONT.semibold, color: theme.muted, marginBottom: SPACING.xs - 2 },
  input: {
    backgroundColor: theme.cardGlass, borderWidth: 1, borderColor: theme.border,
    borderRadius: RADII.input, paddingHorizontal: SPACING.sm + 2, paddingVertical: 13,
    ...TYPE_SCALE.body, color: theme.text,
  },

  pwLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: SPACING.xs - 2,
  },
  forgotLink: { fontSize: 12, fontFamily: FONT.semibold },
  pwRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.cardGlass, borderWidth: 1, borderColor: theme.border, borderRadius: RADII.input,
  },
  pwInput: { flex: 1, borderWidth: 0, backgroundColor: 'transparent' },
  eyeBtn:  {},

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
     backgroundColor: `${theme.error}22`, borderRadius: RADII.input,
     borderWidth: 1, borderColor: theme.error,
    paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 2, marginBottom: SPACING.md,
  },
  errorText: { ...TYPE_SCALE.footnote, color: theme.error, flex: 1 },

  primaryWrap: { marginBottom: SPACING.xs + 2 },

  otpWrap: { marginBottom: SPACING.lg, alignItems: 'center' },
  resendRow: { alignItems: 'center', paddingVertical: SPACING.sm },
  resendText: { fontSize: 13, fontFamily: FONT.semibold },

  // Active session screen
  sessionScroll: { justifyContent: 'flex-start' },
  sessionCard: {
    backgroundColor: theme.cardGlass, borderRadius: RADII.sheet,
    borderWidth: 1, borderColor: theme.border,
    padding: SPACING.md + 2, marginBottom: SPACING.xl,
  },
  sessionAvatarRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md - 2,
  },
  sessionName: {
    fontSize: 15, fontFamily: FONT.semibold, color: theme.text, marginBottom: 2,
  },
  sessionEmail: {
    ...TYPE_SCALE.footnote, color: theme.muted,
  },
});
