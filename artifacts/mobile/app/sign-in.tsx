/**
 * Sign-in / Sign-up screen — Clerk Core v3 Signals API
 * Supports: email/password, Google OAuth, Apple OAuth, email verification
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  useColorScheme, ScrollView,
} from 'react-native';
import { useSignIn, useSignUp, useOAuth } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

// Required for OAuth session completion
WebBrowser.maybeCompleteAuthSession();

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const { signIn, errors: signInErrors, fetchStatus: signInFetch } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpFetch } = useSignUp();
  const { startOAuthFlow: googleOAuth } = useOAuth({ strategy: 'oauth_google' });
  const { startOAuthFlow: appleOAuth }  = useOAuth({ strategy: 'oauth_apple' });

  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';
  const { initialMode } = useLocalSearchParams<{ initialMode?: string }>();

  const [mode, setMode]         = useState<Mode>(initialMode === 'sign-up' ? 'sign-up' : 'sign-in');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [code, setCode]         = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [oauthError, setOAuthError] = useState('');

  const bg      = isDark ? '#0E0E0E' : '#F5F5F5';
  const card    = isDark ? '#1A1A1A' : '#FFFFFF';
  const border  = isDark ? '#2A2A2A' : '#E0E0E0';
  const fg      = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted   = isDark ? '#888' : '#666';
  const primary = '#00C853';
  const inputBg = isDark ? '#252525' : '#F0F0F0';

  const inputStyle  = [styles.input, { backgroundColor: inputBg, borderColor: border, color: fg }];
  const labelStyle  = [styles.label, { color: muted }];
  const isSigningIn = signInFetch === 'fetching';
  const isSigningUp = signUpFetch === 'fetching';

  // ─── OAuth ──────────────────────────────────────────────────────────────────

  const handleOAuth = async (start: () => Promise<any>, provider: string) => {
    setOAuthError('');
    try {
      const result = await start();
      if (result?.createdSessionId && result?.setActive) {
        await result.setActive({ session: result.createdSessionId });
      }
    } catch (e: any) {
      if (e?.message?.includes('cancelled') || e?.message?.includes('cancel')) return;
      setOAuthError(`${provider} sign-in failed. Please try again.`);
    }
  };

  // ─── Email sign-in ──────────────────────────────────────────────────────────

  const handleSignIn = async () => {
    const { error } = await signIn.password({
      emailAddress: email.trim().toLowerCase(),
      password,
    });
    if (error) return;
    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl('/');
          if (url.startsWith('http')) {
            if (typeof window !== 'undefined') window.location.href = url;
          } else {
            router.replace(url as Href);
          }
        },
      });
    }
  };

  // ─── Email sign-up step 1 ───────────────────────────────────────────────────

  const handleSignUp = async () => {
    const nameParts = name.trim().split(/\s+/);
    const { error } = await signUp.password({
      emailAddress: email.trim().toLowerCase(),
      password,
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(' ') || undefined,
    });
    if (error) return;
    await signUp.verifications.sendEmailCode();
  };

  // ─── Email sign-up step 2 ───────────────────────────────────────────────────

  const handleVerify = async () => {
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl('/account-type');
          if (url.startsWith('http')) {
            if (typeof window !== 'undefined') window.location.href = url;
          } else {
            router.replace(url as Href);
          }
        },
      });
    }
  };

  // ─── Verification screen ────────────────────────────────────────────────────

  if (
    mode === 'sign-up' &&
    signUp.status === 'missing_requirements' &&
    signUp.unverifiedFields?.includes('email_address') &&
    signUp.missingFields?.length === 0
  ) {
    return (
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: bg }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.card, { backgroundColor: card, borderColor: border, marginTop: insets.top + 40 }]}>
          <BrandRow primary={primary} fg={fg} />
          <Text style={[styles.title, { color: fg }]}>Check your email</Text>
          <Text style={[styles.subtitle, { color: muted }]}>We sent a 6-digit code to {email}</Text>

          <View style={styles.field}>
            <Text style={labelStyle}>Verification code</Text>
            <TextInput
              style={[inputStyle, { letterSpacing: 6, fontSize: 20, textAlign: 'center' }]}
              placeholder="000000"
              placeholderTextColor={muted}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            {signUpErrors.fields.code && (
              <Text style={styles.error}>{signUpErrors.fields.code.message}</Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: primary }, (isSigningUp || code.length < 6) && { opacity: 0.6 }]}
            onPress={handleVerify}
            disabled={isSigningUp || code.length < 6}
            activeOpacity={0.85}
          >
            {isSigningUp ? <ActivityIndicator color="#021208" /> : <Text style={styles.btnText}>Verify email</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.switchRow} onPress={() => signUp.verifications.sendEmailCode()}>
            <Text style={[styles.switchText, { color: muted }]}>
              {"Didn't get it? "}<Text style={{ color: primary, fontFamily: 'Inter_600SemiBold' }}>Resend</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── Main form ──────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: card, borderColor: border, marginTop: insets.top + 32, marginBottom: insets.bottom + 24 }]}>

          {/* Back to welcome */}
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={muted} />
          </TouchableOpacity>

          <BrandRow primary={primary} fg={fg} />

          <Text style={[styles.title, { color: fg }]}>
            {mode === 'sign-in' ? 'Welcome back.' : 'CREATE YOUR BRANDTHREAD ACCOUNT'}
          </Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            {mode === 'sign-in'
              ? 'Sign in to continue building your Brandthread.'
              : 'One account for everything you build.'}
          </Text>

          {/* OAuth buttons */}
          <TouchableOpacity
            style={[styles.oauthBtn, { borderColor: border }]}
            onPress={() => handleOAuth(googleOAuth, 'Google')}
            activeOpacity={0.85}
          >
            <Text style={styles.oauthBtnIcon}>🇬</Text>
            <Text style={[styles.oauthBtnText, { color: fg }]}>Continue with Google</Text>
          </TouchableOpacity>

          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.oauthBtn, { borderColor: border, backgroundColor: isDark ? '#FFF' : '#000', marginTop: 10 }]}
              onPress={() => handleOAuth(appleOAuth, 'Apple')}
              activeOpacity={0.85}
            >
              <Text style={styles.oauthBtnIcon}>🍎</Text>
              <Text style={[styles.oauthBtnText, { color: isDark ? '#000' : '#FFF' }]}>Continue with Apple</Text>
            </TouchableOpacity>
          )}

          {oauthError ? <Text style={[styles.error, { marginTop: 8 }]}>{oauthError}</Text> : null}

          {/* Divider */}
          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: border }]} />
            <Text style={[styles.dividerText, { color: muted }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: border }]} />
          </View>

          {/* Full name (sign-up only) */}
          {mode === 'sign-up' && (
            <View style={styles.field}>
              <Text style={labelStyle}>Full name</Text>
              <TextInput
                style={inputStyle}
                placeholder="Alex Thomas"
                placeholderTextColor={muted}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
            </View>
          )}

          {/* Email */}
          <View style={styles.field}>
            <Text style={labelStyle}>Email address</Text>
            <TextInput
              style={inputStyle}
              placeholder="you@yourbrand.com"
              placeholderTextColor={muted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            {mode === 'sign-in' && signInErrors.fields.identifier && (
              <Text style={styles.error}>{friendlyError(signInErrors.fields.identifier.message)}</Text>
            )}
            {mode === 'sign-up' && signUpErrors.fields.emailAddress && (
              <Text style={styles.error}>{friendlyError(signUpErrors.fields.emailAddress.message)}</Text>
            )}
          </View>

          {/* Password */}
          <View style={styles.field}>
            <View style={styles.pwLabelRow}>
              <Text style={labelStyle}>Password</Text>
              {mode === 'sign-in' && (
                <TouchableOpacity onPress={() => router.push('/forgot-password' as never)}>
                  <Text style={[styles.forgotLink, { color: primary }]}>Forgot password?</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.pwWrap, { backgroundColor: inputBg, borderColor: border }]}>
              <TextInput
                style={[styles.pwInput, { color: fg }]}
                placeholder="••••••••"
                placeholderTextColor={muted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
              />
              <TouchableOpacity onPress={() => setShowPw(v => !v)} style={styles.eyeBtn}>
                <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={muted} />
              </TouchableOpacity>
            </View>
            {mode === 'sign-in' && signInErrors.fields.password && (
              <Text style={styles.error}>{friendlyError(signInErrors.fields.password.message)}</Text>
            )}
            {mode === 'sign-up' && signUpErrors.fields.password && (
              <Text style={styles.error}>{friendlyError(signUpErrors.fields.password.message)}</Text>
            )}
            {mode === 'sign-up' && (
              <Text style={[styles.pwHint, { color: muted }]}>Use at least 8 characters</Text>
            )}
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: primary }, (isSigningIn || isSigningUp) && { opacity: 0.7 }]}
            onPress={mode === 'sign-in' ? handleSignIn : handleSignUp}
            disabled={!email || !password || isSigningIn || isSigningUp}
            activeOpacity={0.85}
          >
            {(isSigningIn || isSigningUp)
              ? <ActivityIndicator color="#021208" />
              : <Text style={styles.btnText}>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</Text>}
          </TouchableOpacity>

          {/* Terms (sign-up only) */}
          {mode === 'sign-up' && (
            <Text style={[styles.terms, { color: muted }]}>
              By continuing, you agree to Brandthread's{' '}
              <Text style={{ color: primary }}>Terms of Service</Text> and{' '}
              <Text style={{ color: primary }}>Privacy Policy</Text>.
            </Text>
          )}

          {/* Mode switch */}
          <TouchableOpacity
            style={styles.switchRow}
            onPress={() => setMode(m => m === 'sign-in' ? 'sign-up' : 'sign-in')}
          >
            <Text style={[styles.switchText, { color: muted }]}>
              {mode === 'sign-in' ? "Don't have an account? " : 'Already have an account? '}
              <Text style={{ color: primary, fontFamily: 'Inter_600SemiBold' }}>
                {mode === 'sign-in' ? 'Sign up' : 'Sign in'}
              </Text>
            </Text>
          </TouchableOpacity>

          <View nativeID="clerk-captcha" />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function friendlyError(msg: string): string {
  if (!msg) return msg;
  const m = msg.toLowerCase();
  // Only match specific patterns — broad 'identifier' matching misclassifies session errors
  if (m.includes('that email address is taken') || (m.includes('email') && m.includes('already exists') && !m.includes('session')))
    return 'An account already exists with this email. Try signing in instead.';
  if (m.includes('password') && (m.includes('weak') || m.includes('pwned')))
    return 'Use a stronger password with at least 8 characters.';
  if ((m.includes('invalid') || m.includes('format')) && m.includes('email'))
    return 'Enter a valid email address.';
  if (m.includes('already signed in') || (m.includes('session') && m.includes('exists')))
    return 'You are already signed in. Sign out to create another account.';
  if (m.includes('network') || m.includes('fetch') || m.includes('timeout'))
    return "We couldn't connect. Check your internet and try again.";
  if (m.includes('incorrect') || m.includes('wrong password') || m.includes('invalid password'))
    return 'Incorrect email or password.';
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts. Please wait a moment and try again.';
  return msg;
}

function BrandRow({ primary, fg }: { primary: string; fg: string }) {
  return (
    <View style={styles.brandRow}>
      <View style={[styles.logoCircle, { backgroundColor: primary }]}>
        <Text style={styles.logoLetter}>B</Text>
      </View>
      <Text style={[styles.brandName, { color: fg }]}>Brandthread</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, paddingHorizontal: 20 },
  card:       { borderRadius: 24, padding: 28, borderWidth: 1, marginHorizontal: 0 },
  backBtn:    { marginBottom: 16 },
  brandRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 },
  logoCircle: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  logoLetter: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFF' },
  brandName:  { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  title:      { fontSize: 22, fontFamily: 'Inter_700Bold', marginBottom: 6, letterSpacing: -0.4 },
  subtitle:   { fontSize: 14, fontFamily: 'Inter_400Regular', marginBottom: 20, lineHeight: 20 },

  oauthBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderRadius: 14, borderWidth: 1.5, paddingVertical: 14,
  },
  oauthBtnIcon: { fontSize: 18 },
  oauthBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  divider:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  field:     { marginBottom: 16 },
  label:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  input:     { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: 'Inter_400Regular' },
  pwLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  forgotLink: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  pwWrap:     { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1 },
  pwInput:    { flex: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: 'Inter_400Regular' },
  eyeBtn:     { paddingHorizontal: 14 },
  pwHint:     { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4 },

  error:     { color: '#EF4444', fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 4 },
  btn:       { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  btnText:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#021208' },

  terms:     { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18, marginTop: 12 },
  switchRow: { marginTop: 16, alignItems: 'center' },
  switchText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
});
