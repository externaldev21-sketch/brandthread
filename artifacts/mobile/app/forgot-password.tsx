/**
 * Forgot / Reset password — Brandthread premium dark design
 * Steps: email → code + new password → done
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSignIn } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { useAppTheme } from '@/contexts/AppThemeContext';

type Step = 'email' | 'code' | 'done';

// ─── Design tokens (exact match to onboarding / splash / welcome) ────────────
const BG       = '#07070F';
const FG       = '#FFFFFF';
const MUTED    = 'rgba(255,255,255,0.5)';
const MUTED2   = 'rgba(255,255,255,0.28)';
const CARD     = 'rgba(255,255,255,0.04)';
const BORDER   = 'rgba(255,255,255,0.09)';
const INPUT_BG = 'rgba(255,255,255,0.07)';
const INPUT_BD = 'rgba(255,255,255,0.12)';
const ERR      = '#F87171';
const SUCCESS  = '#34D399';

export default function ForgotPasswordScreen() {
  const { signIn, fetchStatus } = useSignIn();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { theme } = useAppTheme();

  const [step, setStep]         = useState<Step>('email');
  const [email, setEmail]       = useState('');
  const [code, setCode]         = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const isFetching = fetchStatus === 'fetching' || loading;

  // ─── Send reset code ─────────────────────────────────────────────────────────
  async function handleSendCode() {
    if (!email.trim() || isFetching) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setError('');
    try {
      await (signIn as any).create({
        identifier: email.trim().toLowerCase(),
        strategy: 'reset_password_email_code',
      });
      setStep('code');
    } catch (e: any) {
      setError(mapError(e));
    } finally {
      setLoading(false);
    }
  }

  // ─── Verify code + set new password ──────────────────────────────────────────
  async function handleReset() {
    if (!code || !password || isFetching) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setError('');
    try {
      await (signIn as any).attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code,
        password,
      });
      setStep('done');
    } catch (e: any) {
      setError(mapError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* Ambient glow */}
      <View style={[s.glowTop, { backgroundColor: theme.accentDim }]} />

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
          {step !== 'done' && (
            <TouchableOpacity
              style={s.backBtn}
              onPress={() => {
                Haptics.selectionAsync();
                step === 'code' ? setStep('email') : router.back();
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather name="arrow-left" size={20} color={MUTED} />
            </TouchableOpacity>
          )}

          {/* Logo */}
          <View style={s.logoRow}>
            <BrandthreadLogo size={36} />
            <Text style={s.logoText}>BRANDTHREAD</Text>
          </View>

          {/* ── Step: email ────────────────────────────────────────────────────── */}
          {step === 'email' && (
            <>
              <Text style={s.headline}>Reset your password.</Text>
              <Text style={s.subtitle}>
                Enter your email and we'll send you a secure reset link.
              </Text>

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
                  autoFocus
                />
              </View>

              {error ? (
                <View style={s.errorBox}>
                  <Feather name="alert-circle" size={14} color={ERR} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[s.primaryWrap, (!email.trim() || isFetching) && { opacity: 0.5 }]}
                onPress={handleSendCode}
                disabled={!email.trim() || isFetching}
                activeOpacity={0.88}
              >
                <LinearGradient
                  colors={[theme.accent, theme.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.primaryBtn}
                >
                  {isFetching
                    ? <ActivityIndicator color={FG} size="small" />
                    : <Text style={s.primaryBtnText}>Send reset code</Text>}
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={() => { Haptics.selectionAsync(); router.back(); }}
                activeOpacity={0.85}
              >
                <Text style={s.secondaryBtnText}>Back to sign in</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Step: code + new password ──────────────────────────────────────── */}
          {step === 'code' && (
            <>
              <Text style={s.headline}>Check your inbox.</Text>
              <Text style={s.subtitle}>
                We sent a reset code to {email}.{'\n'}Enter it below with your new password.
              </Text>

              <View style={s.fieldWrap}>
                <Text style={s.label}>Reset code</Text>
                <TextInput
                  style={[s.input, s.codeInput]}
                  placeholder="000000"
                  placeholderTextColor={MUTED2}
                  value={code}
                  onChangeText={t => { setCode(t); setError(''); }}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
              </View>

              <View style={s.fieldWrap}>
                <Text style={s.label}>New password</Text>
                <View style={s.pwRow}>
                  <TextInput
                    style={[s.input, s.pwInput]}
                    placeholder="Minimum 8 characters"
                    placeholderTextColor={MUTED2}
                    value={password}
                    onChangeText={t => { setPassword(t); setError(''); }}
                    secureTextEntry={!showPw}
                    autoComplete="new-password"
                  />
                  <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPw(v => !v)}>
                    <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={MUTED} />
                  </TouchableOpacity>
                </View>
                {password.length > 0 && password.length < 8 && (
                  <Text style={s.hint}>Use at least 8 characters</Text>
                )}
              </View>

              {error ? (
                <View style={s.errorBox}>
                  <Feather name="alert-circle" size={14} color={ERR} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[s.primaryWrap, (!code || !password || isFetching) && { opacity: 0.5 }]}
                onPress={handleReset}
                disabled={!code || !password || isFetching}
                activeOpacity={0.88}
              >
                <LinearGradient
                  colors={[theme.accent, theme.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.primaryBtn}
                >
                  {isFetching
                    ? <ActivityIndicator color={FG} size="small" />
                    : <Text style={s.primaryBtnText}>Reset password</Text>}
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.resendBtn}
                onPress={handleSendCode}
                disabled={isFetching}
                activeOpacity={0.8}
              >
                <Text style={s.resendText}>
                  {"Didn't get it? "}
                  <Text style={{ color: theme.accent, fontFamily: 'Inter_600SemiBold' }}>Resend code</Text>
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Step: done ─────────────────────────────────────────────────────── */}
          {step === 'done' && (
            <>
              {/* Success card */}
              <View style={s.successCard}>
                <LinearGradient
                  colors={['rgba(52,211,153,0.12)', 'rgba(52,211,153,0.04)']}
                  style={s.successGrad}
                >
                  <View style={s.successIconWrap}>
                    <LinearGradient
                      colors={[SUCCESS, '#059669']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={s.successIconGrad}
                    >
                      <Feather name="check" size={28} color={FG} />
                    </LinearGradient>
                  </View>
                  <Text style={s.successTitle}>Password updated.</Text>
                  <Text style={s.successSub}>
                    Your password has been reset successfully.{'\n'}Sign in with your new password.
                  </Text>
                </LinearGradient>
              </View>

              <TouchableOpacity
                style={s.primaryWrap}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.replace('/sign-in' as never); }}
                activeOpacity={0.88}
              >
                <LinearGradient
                  colors={[theme.accent, theme.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.primaryBtn}
                >
                  <Text style={s.primaryBtnText}>Sign in</Text>
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}
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

  if (code === 'form_identifier_not_found')
    return 'No account found with that email address.';
  if (code === 'form_code_incorrect')
    return 'Invalid code. Please check and try again.';
  if (code === 'verification_expired')
    return 'Code expired. Request a new one.';
  if (code === 'form_password_pwned' || code === 'form_password_strength_insufficient')
    return 'This password is too common. Choose a stronger one.';
  if (code === 'form_password_length_too_short')
    return 'Use at least 8 characters.';
  if (code === 'request_rate_limited')
    return 'Too many attempts. Please wait a moment.';
  if (code === 'network_failure' || code === 'request_timeout')
    return "Couldn't connect. Check your internet and try again.";

  if (msg.includes('no user') || msg.includes('not found'))
    return 'No account found with that email address.';
  if (msg.includes('incorrect') || (msg.includes('code') && msg.includes('invalid')))
    return 'Invalid code. Please check and try again.';
  if (msg.includes('expired'))
    return 'Code expired. Request a new one.';
  if (msg.includes('weak') || msg.includes('pwned'))
    return 'Choose a stronger password.';

  return inner?.message || err?.message || 'Something went wrong. Please try again.';
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },

  glowTop: {
    position: 'absolute', top: -80, left: '10%',
    width: '80%', height: 220, borderRadius: 150,
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

  fieldWrap: { marginBottom: 16 },
  label:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 6 },
  input: {
    backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: FG,
  },
  codeInput: {
    letterSpacing: 8, fontSize: 22, textAlign: 'center',
    fontFamily: 'Inter_700Bold',
  },
  pwRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD, borderRadius: 12,
  },
  pwInput: { flex: 1, borderWidth: 0, backgroundColor: 'transparent' },
  eyeBtn:  { paddingHorizontal: 14 },
  hint:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 4 },

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

  resendBtn:  { paddingVertical: 14, alignItems: 'center' },
  resendText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED },

  // Success card
  successCard: {
    borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.25)', overflow: 'hidden', marginBottom: 28,
  },
  successGrad: { padding: 28, alignItems: 'center' },
  successIconWrap: { marginBottom: 20 },
  successIconGrad: {
    width: 64, height: 64, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: SUCCESS, shadowOpacity: 0.5,
    shadowRadius: 16, shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  successTitle: {
    fontSize: 26, fontFamily: 'Inter_700Bold', color: FG,
    letterSpacing: -0.5, marginBottom: 8, textAlign: 'center',
  },
  successSub: {
    fontSize: 14, fontFamily: 'Inter_400Regular',
    color: MUTED, lineHeight: 21, textAlign: 'center',
  },

  // Generic card (CARD token)
  _card: { backgroundColor: CARD },
});
