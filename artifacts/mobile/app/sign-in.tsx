/**
 * Sign-in screen — Brandthread premium dark design
 * Pure sign-in: email/password, Google OAuth, Apple OAuth
 */
import React, { useEffect, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, StatusBar,
} from 'react-native';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import GoogleGlyph from '@/components/branding/GoogleGlyph';
import { useSignIn, useSSO, useAuth, useUser } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

export default function SignInScreen() {
  const { signIn, fetchStatus } = useSignIn();
  const { isSignedIn, signOut } = useAuth();
  const { user }                = useUser();
  const { startSSOFlow } = useSSO();

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

  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPw, setShowPw]         = useState(false);
  const [oauthLoading, setOAuth]    = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Second-factor (TOTP) step, shown when the account has 2FA turned on.
  const [needsTotp, setNeedsTotp]   = useState(false);
  const [totpCode, setTotpCode]     = useState('');
  const [totpError, setTotpError]   = useState('');
  const [totpLoading, setTotpLoading] = useState(false);

  const isFetching   = fetchStatus === 'fetching' || loading;
  const canSubmit    = email.includes('@') && password.length >= 1;
  const canVerifyTotp = totpCode.length === 6;
  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? '';

  function finalizeSignIn() {
    return signIn.finalize({
      navigate: ({ decorateUrl }) => {
        const destination = isAddAccount ? '/account-switcher' : '/';
        const url = decorateUrl(destination);
        if (url.startsWith('http') && typeof window !== 'undefined') {
          window.location.href = url;
        } else {
          router.replace(destination as Href);
        }
      },
    });
  }

  // ─── Email sign-in ───────────────────────────────────────────────────────────
  async function handleSignIn() {
    if (!canSubmit || isFetching) return;
    setLoading(true);
    setError('');
    try {
      const { error: err } = await signIn.password({
        emailAddress: email.trim().toLowerCase(),
        password,
      });
      if (err) { setError(mapError(err)); return; }
      if (signIn.status === 'complete') {
        await finalizeSignIn();
      } else if (signIn.status === 'needs_second_factor') {
        setNeedsTotp(true);
      } else {
        setError("Couldn't sign you in. Try again.");
      }
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
        if (isAddAccount) router.replace('/account-switcher' as never);
      } else if (ssoSignIn?.status === 'complete' || ssoSignUp?.status === 'complete') {
        // Session was created by Clerk automatically — AuthGate picks it up
        if (isAddAccount) router.replace('/account-switcher' as never);
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

  // ─── Active session screen ────────────────────────────────────────────────────
  if (isSignedIn && !isAddAccount) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
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
      <View style={[s.root, { paddingTop: insets.top }]}>
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

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
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

          {/* ── Email ──────────────────────────────────────────────────────────── */}
          <View style={s.fieldWrap}>
            <Text style={s.label}>Email address</Text>
            <TextInput
              style={s.input}
              placeholder="you@yourbrand.com"
              placeholderTextColor={theme.subtle}
              value={email}
              onChangeText={t => { setEmail(t); setError(''); }}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          {/* ── Password ───────────────────────────────────────────────────────── */}
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
                style={[s.input, s.pwInput]}
                placeholder="••••••••"
                placeholderTextColor={theme.subtle}
                value={password}
                onChangeText={t => { setPassword(t); setError(''); }}
                secureTextEntry={!showPw}
                autoComplete="current-password"
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

          {/* ── Error ──────────────────────────────────────────────────────────── */}
          {error ? (
            <View style={s.errorBox}>
              <Feather name="alert-circle" size={14} color={theme.error} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* ── Sign in ────────────────────────────────────────────────────────── */}
          <Button
            label="Sign in"
            onPress={handleSignIn}
            disabled={!canSubmit}
            loading={isFetching}
            fullWidth
            style={s.primaryWrap}
          />

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
