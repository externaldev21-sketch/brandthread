/**
 * Sign-in screen — Brandthread premium dark design
 * Pure sign-in: email/password, Google OAuth, Apple OAuth
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, StatusBar,
} from 'react-native';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { ThreadDraw } from '@/components/onboarding/ThreadLine';
import {
  CodeCells,
  FloatingInput,
  HairlineDivider,
  PillButton,
  PressableScale,
  Reveal,
  RevealToggle,
  StepHeadline,
  StepSub,
} from '@/components/onboarding/OnboardingUI';
import { RADIUS, SPACE, TYPE } from '@/components/onboarding/onboardingTokens';
import { useSignIn, useSSO, useAuth, useUser } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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

  // Shared top of every sign-in state: back, then the mark with the thread
  // sewing through the header.
  const renderTop = (onBack: () => void) => (
    <>
      <PressableScale
        style={s.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Feather name="arrow-left" size={18} color={theme.text} />
      </PressableScale>

      <View style={s.logoRow}>
        <ThreadDraw height={56} color={theme.text} delay={120} duration={1200} style={s.logoThread} />
        <View style={[s.logoChip, { backgroundColor: theme.background }]}>
          <BrandthreadLogo size={30} />
          <Text style={s.logoText}>BRANDTHREAD</Text>
        </View>
      </View>
    </>
  );

  const renderError = (message: string) => (
    <Reveal style={s.errorBox}>
      <Feather name="alert-circle" size={14} color={theme.error} />
      <Text style={s.errorText}>{message}</Text>
    </Reveal>
  );

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
          {renderTop(() => { Haptics.selectionAsync(); router.back(); })}

          <StepHeadline size="display">You're already{'\n'}signed in.</StepHeadline>
          <StepSub>
            {currentEmail
              ? `You are currently signed in as ${currentEmail}.`
              : 'You have an active session.'}
          </StepSub>

          {/* Info card */}
          <Reveal index={2}>
            <View style={s.sessionCard}>
              <View style={s.sessionAvatarRow}>
                <View style={s.sessionAvatar}>
                  <Text style={s.sessionAvatarText}>
                    {(currentEmail[0] ?? 'B').toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sessionName} numberOfLines={1}>
                    {user?.firstName ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : 'Your account'}
                  </Text>
                  <Text style={s.sessionEmail} numberOfLines={1}>{currentEmail}</Text>
                </View>
              </View>
            </View>
          </Reveal>

          <Reveal index={3} style={s.stack}>
            <PillButton
              accessibilityLabel="Continue with this account"
              label="Continue with this account"
              haptic={false}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.replace('/' as never); }}
            />
            <PillButton
              accessibilityLabel="Sign out"
              label="Sign out"
              variant="secondary"
              onPress={handleSignOut}
              disabled={signingOut}
              loading={signingOut}
            />
          </Reveal>
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
            {renderTop(() => { Haptics.selectionAsync(); setNeedsTotp(false); setTotpCode(''); setTotpError(''); })}

            <StepHeadline>Two-factor{'\n'}authentication</StepHeadline>
            <StepSub>Enter the 6-digit code from your authenticator app.</StepSub>

            <Reveal index={2} style={s.codeWrap}>
              <CodeCells
                value={totpCode}
                onChangeText={t => { setTotpCode(t.replace(/[^0-9]/g, '').slice(0, 6)); setTotpError(''); }}
                autoFocus
                onSubmitEditing={handleVerifyTotp}
              />
            </Reveal>

            {totpError ? renderError(totpError) : null}

            <Reveal index={3}>
              <PillButton
                accessibilityLabel="Verify code"
                label="Verify code"
                haptic={false}
                onPress={handleVerifyTotp}
                disabled={!canVerifyTotp}
                loading={totpLoading}
              />
            </Reveal>
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
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {renderTop(() => { Haptics.selectionAsync(); router.back(); })}

          {/* Heading */}
          <StepHeadline size="display">{isAddAccount ? 'Add another account.' : 'Welcome back.'}</StepHeadline>
          <StepSub style={s.subtitle}>
            {isAddAccount
              ? 'Sign in to add an existing Brandthread account to this device.'
              : 'Sign in to continue where you left off.'}
          </StepSub>

          {/* ── OAuth ─────────────────────────────────────────────────────────── */}
          {/* Apple first — per Apple HIG, iOS only. Shown above Google per App
              Store guideline 4.8: Sign in with Apple must be at least as
              prominent as other third-party social login options. */}
          <Reveal index={2}>
            {Platform.OS === 'ios' && (
              <PressableScale
                style={[s.oauthBtn, s.appleBtn]}
                onPress={() => handleOAuth('oauth_apple', 'Apple')}
                accessibilityRole="button"
                accessibilityLabel="Continue with Apple"
                disabled={!!oauthLoading || isFetching}
              >
                {oauthLoading === 'Apple' ? (
                  <ActivityIndicator color={theme.text} size="small" />
                ) : (
                  <>
                    <Ionicons name="logo-apple" size={20} color={theme.text} />
                    <Text style={s.oauthText}>Continue with Apple</Text>
                  </>
                )}
              </PressableScale>
            )}

            {/* Google */}
            <PressableScale
              style={s.oauthBtn}
              onPress={() => handleOAuth('oauth_google', 'Google')}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              disabled={!!oauthLoading || isFetching}
            >
              {oauthLoading === 'Google' ? (
                <ActivityIndicator color={theme.text} size="small" />
              ) : (
                <>
                  <View style={s.googleGlyph}><Text style={[s.googleGlyphText, { color: theme.background }]}>G</Text></View>
                  <Text style={s.oauthText}>Continue with Google</Text>
                </>
              )}
            </PressableScale>
          </Reveal>

          {/* Divider */}
          <HairlineDivider>
            <Text style={s.divText}>or</Text>
          </HairlineDivider>

          {/* ── Email ──────────────────────────────────────────────────────────── */}
          <Reveal index={3}>
            <FloatingInput
              label="Email address"
              placeholder="you@yourbrand.com"
              value={email}
              onChangeText={t => { setEmail(t); setError(''); }}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </Reveal>

          {/* ── Password ───────────────────────────────────────────────────────── */}
          <Reveal index={4}>
            <FloatingInput
              label="Password"
              placeholder="••••••••"
              value={password}
              onChangeText={t => { setPassword(t); setError(''); }}
              secureTextEntry={!showPw}
              autoComplete="current-password"
              right={<RevealToggle shown={showPw} onToggle={() => setShowPw(v => !v)} />}
            />
            <TouchableOpacity style={s.forgotWrap} onPress={() => router.push('/forgot-password' as never)}>
              <Text style={s.forgotLink}>Forgot password?</Text>
            </TouchableOpacity>
          </Reveal>

          {/* ── Error ──────────────────────────────────────────────────────────── */}
          {error ? renderError(error) : null}

          {/* ── Sign in / Create account ──────────────────────────────────────── */}
          <Reveal index={5} style={s.stack}>
            <PillButton
              accessibilityLabel="Sign in"
              label="Sign in"
              haptic={false}
              onPress={handleSignIn}
              disabled={!canSubmit}
              loading={isFetching}
            />
            <PillButton
              accessibilityLabel="Create an account"
              label="Create an account"
              variant="secondary"
              haptic={false}
              onPress={() => { Haptics.selectionAsync(); router.replace('/onboarding' as never); }}
            />
          </Reveal>

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

  scroll: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.xs },

  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    justifyContent: 'center', alignItems: 'center', marginBottom: SPACE.md,
  },

  logoRow: { height: 56, justifyContent: 'center', marginBottom: SPACE.xl },
  logoThread: { position: 'absolute', left: -SPACE.lg, right: -SPACE.lg, top: 0 },
  logoChip: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', paddingRight: SPACE.sm },
  logoText: { ...TYPE.eyebrow, color: theme.text },

  subtitle: { marginBottom: SPACE.xl },
  stack: { gap: SPACE.sm, marginTop: SPACE.xs },
  codeWrap: { marginTop: SPACE.xl },

  oauthBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderRadius: RADIUS.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    minHeight: 56, marginBottom: SPACE.sm,
  },
  appleBtn: { borderColor: theme.border },
  oauthText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: theme.text },
  googleGlyph: { width: 20, height: 20, borderRadius: 10, backgroundColor: theme.text, alignItems: 'center', justifyContent: 'center' },
  googleGlyphText: { fontFamily: 'Inter_700Bold', fontSize: 12, lineHeight: 14 },

  divText: { ...TYPE.label, color: theme.muted },

  forgotWrap: { alignSelf: 'flex-end', paddingVertical: SPACE.xxs, marginTop: -SPACE.xxs, marginBottom: SPACE.sm },
  forgotLink: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: theme.text },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.error,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: SPACE.md,
  },
  errorText: { ...TYPE.label, color: theme.error, flex: 1 },

  // Active session screen
  sessionScroll: { justifyContent: 'flex-start' },
  sessionCard: {
    backgroundColor: theme.card, borderRadius: RADIUS.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    padding: SPACE.md + 2, marginTop: SPACE.xl, marginBottom: SPACE.lg,
  },
  sessionAvatarRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  sessionAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: theme.text,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  sessionAvatarText: { fontSize: 20, fontFamily: 'Inter_700Bold', color: theme.background },
  sessionName: {
    fontSize: 16, fontFamily: 'Inter_600SemiBold', color: theme.text, marginBottom: 2,
  },
  sessionEmail: {
    ...TYPE.label, color: theme.muted,
  },
});
