/**
 * Sign-in screen — Brandthread premium dark design
 * Pure sign-in: email/password, Google OAuth, Apple OAuth
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { useSignIn, useSSO, useAuth, useUser } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

WebBrowser.maybeCompleteAuthSession();

// ─── Design tokens (exact match to onboarding / splash / welcome) ────────────
const BG       = '#07070F';
const PURPLE   = '#8B5CF6';
const CYAN     = '#22D3EE';
const FG       = '#FFFFFF';
const MUTED    = 'rgba(255,255,255,0.5)';
const MUTED2   = 'rgba(255,255,255,0.28)';
const CARD     = 'rgba(255,255,255,0.04)';
const BORDER   = 'rgba(255,255,255,0.09)';
const INPUT_BG = 'rgba(255,255,255,0.07)';
const INPUT_BD = 'rgba(255,255,255,0.12)';
const ERR      = '#F87171';

export default function SignInScreen() {
  const { signIn, fetchStatus } = useSignIn();
  const { isSignedIn, signOut } = useAuth();
  const { user }                = useUser();
  const { startSSOFlow } = useSSO();

  const router = useRouter();
  const insets = useSafeAreaInsets();

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

  const isFetching   = fetchStatus === 'fetching' || loading;
  const canSubmit    = email.includes('@') && password.length >= 1;
  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? '';

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
        await signIn.finalize({
          navigate: ({ decorateUrl }) => {
            const url = decorateUrl('/');
            if (url.startsWith('http') && typeof window !== 'undefined') {
              window.location.href = url;
            } else {
              router.replace(url as Href);
            }
          },
        });
      }
    } catch (e: any) {
      setError(mapError(e));
    } finally {
      setLoading(false);
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
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy,
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch (e: any) {
      if (e?.message?.includes('cancel') || e?.message?.includes('dismiss')) {
        setOAuth(''); return;
      }
      setError(`${provider} sign-in failed. Please try again.`);
    } finally {
      setOAuth('');
    }
  }

  // ─── Active session screen ────────────────────────────────────────────────────
  if (isSignedIn) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" />
        <View style={s.glowTop} />

        <ScrollView
          contentContainerStyle={[s.scroll, s.sessionScroll, { paddingBottom: insets.bottom + 36 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back */}
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => { Haptics.selectionAsync(); router.back(); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Feather name="arrow-left" size={20} color={MUTED} />
          </TouchableOpacity>

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
              <LinearGradient colors={[PURPLE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.sessionAvatar}>
                <Text style={s.sessionAvatarText}>
                  {(currentEmail[0] ?? 'B').toUpperCase()}
                </Text>
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={s.sessionName} numberOfLines={1}>
                  {user?.firstName ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : 'Your account'}
                </Text>
                <Text style={s.sessionEmail} numberOfLines={1}>{currentEmail}</Text>
              </View>
            </View>
          </View>

          {/* Continue */}
          <TouchableOpacity
            style={s.primaryWrap}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.replace('/' as never); }}
            activeOpacity={0.88}
          >
            <LinearGradient colors={[PURPLE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.primaryBtn}>
              <Text style={s.primaryBtnText}>Continue with this account</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Sign out */}
          <TouchableOpacity
            style={[s.secondaryBtn, signingOut && { opacity: 0.5 }]}
            onPress={handleSignOut}
            disabled={signingOut}
            activeOpacity={0.85}
          >
            {signingOut
              ? <ActivityIndicator color={FG} size="small" />
              : <Text style={s.secondaryBtnText}>Sign out</Text>}
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* Ambient glow */}
      <View style={s.glowTop} />
      <View style={s.glowMid} />

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
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => { Haptics.selectionAsync(); router.back(); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Feather name="arrow-left" size={20} color={MUTED} />
          </TouchableOpacity>

          {/* Logo */}
          <View style={s.logoRow}>
            <BrandthreadLogo size={36} />
            <Text style={s.logoText}>BRANDTHREAD</Text>
          </View>

          {/* Heading */}
          <Text style={s.headline}>Welcome back.</Text>
          <Text style={s.subtitle}>Sign in to continue where you left off.</Text>

          {/* ── OAuth ─────────────────────────────────────────────────────────── */}
          {/* Google — dark surface with Google logo, per Google brand guidelines */}
          <TouchableOpacity
            style={s.oauthBtn}
            onPress={() => handleOAuth('oauth_google', 'Google')}
            activeOpacity={0.85}
            disabled={!!oauthLoading || isFetching}
          >
            {oauthLoading === 'Google' ? (
              <ActivityIndicator color={FG} size="small" />
            ) : (
              <>
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#4285F4', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: 'Inter_700Bold', fontSize: 11, color: '#FFFFFF', lineHeight: 13 }}>G</Text></View>
                <Text style={s.oauthText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Apple — solid black button per Apple HIG, iOS only */}
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[s.oauthBtn, s.appleBtn]}
              onPress={() => handleOAuth('oauth_apple', 'Apple')}
              activeOpacity={0.85}
              disabled={!!oauthLoading || isFetching}
            >
              {oauthLoading === 'Apple' ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: '#FFFFFF', lineHeight: 20 }}></Text>
                  <Text style={[s.oauthText, { color: '#FFFFFF' }]}>Continue with Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Divider */}
          <View style={s.divider}>
            <View style={s.divLine} />
            <Text style={s.divText}>or</Text>
            <View style={s.divLine} />
          </View>

          {/* ── Email ──────────────────────────────────────────────────────────── */}
          <View style={s.fieldWrap}>
            <Text style={s.label}>Email address</Text>
            <TextInput
              style={s.input}
              placeholder="you@yourbrand.com"
              placeholderTextColor={MUTED2}
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
              <TouchableOpacity onPress={() => router.push('/forgot-password' as never)}>
                <Text style={s.forgotLink}>Forgot password?</Text>
              </TouchableOpacity>
            </View>
            <View style={s.pwRow}>
              <TextInput
                style={[s.input, s.pwInput]}
                placeholder="••••••••"
                placeholderTextColor={MUTED2}
                value={password}
                onChangeText={t => { setPassword(t); setError(''); }}
                secureTextEntry={!showPw}
                autoComplete="current-password"
              />
              <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPw(v => !v)}>
                <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={MUTED} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Error ──────────────────────────────────────────────────────────── */}
          {error ? (
            <View style={s.errorBox}>
              <Feather name="alert-circle" size={14} color={ERR} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* ── Sign in ────────────────────────────────────────────────────────── */}
          <TouchableOpacity
            style={[s.primaryWrap, (!canSubmit || isFetching) && { opacity: 0.5 }]}
            onPress={handleSignIn}
            disabled={!canSubmit || isFetching}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={[PURPLE, CYAN]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.primaryBtn}
            >
              {isFetching
                ? <ActivityIndicator color={FG} size="small" />
                : <Text style={s.primaryBtnText}>Sign in</Text>}
            </LinearGradient>
          </TouchableOpacity>

          {/* ── Create account ─────────────────────────────────────────────────── */}
          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={() => { Haptics.selectionAsync(); router.replace('/account-type' as never); }}
            activeOpacity={0.85}
          >
            <Text style={s.secondaryBtnText}>Create an account</Text>
          </TouchableOpacity>

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
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },

  glowTop: {
    position: 'absolute', top: -80, left: '10%',
    width: '80%', height: 220, borderRadius: 150,
    backgroundColor: '#8B5CF612',
  },
  glowMid: {
    position: 'absolute', top: 260, right: -60,
    width: 180, height: 180, borderRadius: 90,
    backgroundColor: '#22D3EE08',
  },

  scroll: { paddingHorizontal: 24, paddingTop: 16 },

  backBtn: { width: 40, height: 40, justifyContent: 'center', marginBottom: 20 },

  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 36 },
  logoText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: 2.5 },

  headline: {
    fontSize: 32, fontFamily: 'Inter_700Bold',
    color: FG, letterSpacing: -0.8, marginBottom: 8,
  },
  subtitle: {
    fontSize: 15, fontFamily: 'Inter_400Regular',
    color: MUTED, lineHeight: 22, marginBottom: 32,
  },

  oauthBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 15, marginBottom: 10,
  },
  // Apple button: solid black per Apple Human Interface Guidelines
  appleBtn: { backgroundColor: '#000000', borderColor: 'rgba(255,255,255,0.15)' },
  oauthText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  divLine: { flex: 1, height: 1, backgroundColor: BORDER },
  divText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },

  fieldWrap: { marginBottom: 16 },
  label:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 6 },
  input: {
    backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: FG,
  },

  pwLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 6,
  },
  forgotLink: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: PURPLE },
  pwRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD, borderRadius: 12,
  },
  pwInput: { flex: 1, borderWidth: 0, backgroundColor: 'transparent' },
  eyeBtn:  { paddingHorizontal: 14 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(248,113,113,0.08)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.25)',
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
  },
  errorText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: ERR, flex: 1 },

  primaryWrap: { marginBottom: 10 },
  primaryBtn:  { borderRadius: 14, paddingVertical: 17, alignItems: 'center' },
  primaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },

  secondaryBtn: {
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  secondaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },

  // Active session screen
  sessionScroll: { justifyContent: 'flex-start' },
  sessionCard: {
    backgroundColor: CARD, borderRadius: 18,
    borderWidth: 1, borderColor: BORDER,
    padding: 18, marginBottom: 24,
  },
  sessionAvatarRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  sessionAvatar: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  sessionAvatarText: { fontSize: 20, fontFamily: 'Inter_700Bold', color: FG },
  sessionName: {
    fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG, marginBottom: 2,
  },
  sessionEmail: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED,
  },
});
