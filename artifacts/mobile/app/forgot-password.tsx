/**
 * Forgot / Reset password — Brandthread premium dark design
 * Steps: email → code + new password → done
 */
import React, { useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';

import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView, StatusBar } from 'react-native';

import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';

import { LinearGradient } from 'expo-linear-gradient';

import { useRouter } from 'expo-router';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';

import { Icon } from '@/components/ui/Icon';

import { haptics } from '@/lib/haptics';

import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { useAppTheme } from '@/contexts/AppThemeContext';

import { Button } from '@/components/ui/Button';

import { IconButton } from '@/components/ui/IconButton';

import { SPACING } from '@/constants/spacing';

import { useApi } from '@/lib/api';

import { ApiError } from '@/lib/networkNotice';

import { FONT } from '@/lib/theme';

type Step = 'email' | 'code' | 'done';

export default function ForgotPasswordScreen() {
  const api     = useApi();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);

  const [step, setStep]         = useState<Step>('email');
  const [email, setEmail]       = useState('');
  const [code, setCode]         = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [notice, setNotice]     = useState('');
  const [loading, setLoading]   = useState(false);

  const isFetching = loading;
  // Matches the "Use at least 8 characters" hint under the field.
  const canReset = code.length === 6 && password.length >= 8;

  // ─── Send reset code ─────────────────────────────────────────────────────────
  async function handleSendCode() {
    if (!email.trim() || isFetching) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await api.auth.requestPasswordReset(email.trim().toLowerCase());
      if (step === 'code') setNotice(`New code sent to ${email.trim()}.`);
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
    setLoading(true);
    setError('');
    try {
      await api.auth.confirmPasswordReset({
        email: email.trim().toLowerCase(),
        code,
        newPassword: password,
      });
      setStep('done');
      haptics.success();
    } catch (e: any) {
      setError(mapError(e));
    } finally {
      setLoading(false);
    }
  }

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
          {/* Back — same control, size and position as Sign in's */}
          {step !== 'done' && (
            <IconButton
              name="arrow-left"
              variant="plain"
              size={20}
              color={theme.muted}
              style={s.backBtn}
              accessibilityLabel="Go back"
              onPress={() => {
                step === 'code' ? setStep('email') : goBackOr(router, '/sign-in');
              }}
            />
          )}

          {/* Logo */}
          <View style={s.logoRow}>
            <BrandthreadLogo size={30} />
            <Text style={s.logoText}>BRANDTHREAD</Text>
          </View>

          {/* ── Step: email ────────────────────────────────────────────────────── */}
          {step === 'email' && (
            <>
              <Text style={s.headline}>Reset your password.</Text>
              <Text style={s.subtitle}>
                Enter your email and we'll send you a reset code.
              </Text>

              <View style={s.fieldWrap}>
                <Text style={s.label}>Email address</Text>
                <TextInput accessibilityLabel="Email"
                  style={s.input}
                  placeholder="you@yourbrand.com"
                   placeholderTextColor={theme.subtle}
                  value={email}
                  onChangeText={t => { setEmail(t); setError(''); }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="go"
                  onSubmitEditing={() => { if (email.trim() && !isFetching) handleSendCode(); }}
                  autoFocus
                />
              </View>

              {error ? (
                <View style={s.errorBox}>
                   <Icon name="alert-circle" size={14} color={theme.error} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}

              <Button
                label="Send reset code"
                onPress={handleSendCode}
                disabled={!email.trim()}
                loading={isFetching}
                fullWidth
                style={s.primaryWrap}
              />

              <Button
                label="Back to sign in"
                variant="secondary"
                onPress={() => { goBackOr(router, '/sign-in'); }}
                fullWidth
              />
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
                <TextInput returnKeyType="done" accessibilityLabel="Reset code"
                  style={[s.input, s.codeInput]}
                  placeholder="000000"
                   placeholderTextColor={theme.subtle}
                  value={code}
                  onChangeText={t => { setCode(t.replace(/[^0-9]/g, '')); setError(''); }}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  autoFocus
                />
              </View>

              <View style={s.fieldWrap}>
                <Text style={s.label}>New password</Text>
                <View style={s.pwRow}>
                  <TextInput accessibilityLabel="New password"
                    style={[s.input, s.pwInput]}
                    placeholder="Minimum 8 characters"
                     placeholderTextColor={theme.subtle}
                    value={password}
                    onChangeText={t => { setPassword(t); setError(''); }}
                    secureTextEntry={!showPw}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    autoCapitalize="none"
                    returnKeyType="done"
                  />
                  <TouchableOpacity accessibilityLabel={showPw ? 'Hide password' : 'Show password'} accessibilityRole="button" style={s.eyeBtn} onPress={() => setShowPw(v => !v)}>
                     <Icon name={showPw ? 'eye-off' : 'eye'} size={18} color={theme.muted} />
                  </TouchableOpacity>
                </View>
                {password.length > 0 && password.length < 8 && (
                  <Text style={s.hint}>Use at least 8 characters</Text>
                )}
              </View>

              {error ? (
                <View style={s.errorBox}>
                   <Icon name="alert-circle" size={14} color={theme.error} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}

              <Button
                label="Reset password"
                onPress={handleReset}
                disabled={!canReset}
                loading={isFetching}
                fullWidth
                style={s.primaryWrap}
              />

              <TouchableOpacity
                style={s.resendBtn}
                onPress={handleSendCode}
                disabled={isFetching}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Resend code"
              >
                <Text style={s.resendText}>
                  {"Didn't get it? "}
                  <Text style={{ color: theme.accent, fontFamily: FONT.semibold }}>Resend code</Text>
                </Text>
              </TouchableOpacity>
              {notice ? <Text style={s.noticeText} accessibilityLiveRegion="polite">{notice}</Text> : null}
            </>
          )}

          {/* ── Step: done ─────────────────────────────────────────────────────── */}
          {step === 'done' && (
            <>
              {/* Success card */}
              <View style={s.successCard}>
                <LinearGradient
                  colors={[theme.card, theme.card]}
                  style={s.successGrad}
                >
                  <View style={s.successIconWrap}>
                    <LinearGradient
                      colors={[theme.text, theme.text]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={s.successIconGrad}
                    >
                       <Icon name="check" size={28} color={theme.onAccent} />
                    </LinearGradient>
                  </View>
                  <Text style={s.successTitle}>Password updated.</Text>
                  <Text style={s.successSub}>
                    Your password has been reset successfully.{'\n'}Sign in with your new password.
                  </Text>
                </LinearGradient>
              </View>

              <Button
                label="Sign in"
                onPress={() => { router.replace('/sign-in' as never); }}
                fullWidth
                style={s.primaryWrap}
              />
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

  if (err instanceof ApiError) {
    switch (err.code) {
      case 'MAIL_NOT_CONFIGURED':
        return "We couldn't send that email right now. Please try again shortly or contact support.";
      case 'INVALID_CODE':
        return "That code isn't right. Check your email and try again.";
      case 'CODE_EXPIRED':
        return 'Code expired. Request a new one.';
      case 'WEAK_PASSWORD':
        return 'Use at least 8 characters.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait a moment.';
      case 'timeout':
        return "Couldn't connect. Check your internet and try again.";
      default:
        return err.message?.replace(/^API \d+: /, '') || 'Something went wrong. Please try again.';
    }
  }

  const inner = err?.errors?.[0] ?? err;
  const code  = (inner?.code ?? '').toLowerCase();
  const msg   = (inner?.message ?? inner?.longMessage ?? err?.message ?? '').toLowerCase();

  if (code === 'network_failure' || code === 'request_timeout')
    return "Couldn't connect. Check your internet and try again.";
  if (msg.includes('network'))
    return "Couldn't connect. Check your internet and try again.";

  // Never surface a raw runtime exception message.
  return 'Something went wrong. Please try again.';
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root:    { flex: 1, backgroundColor: theme.background },

  // Spacing mirrors app/sign-in.tsx so the two screens line up.
  scroll: { paddingHorizontal: SPACING.xl, paddingTop: SPACING.md },

  backBtn: { marginBottom: SPACING.lg, alignSelf: 'flex-start' },

  logoRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xxxl - 4 },
  logoText: { fontSize: 12, fontFamily: FONT.bold, color: theme.text },

  headline: {
    fontSize: 34, fontFamily: FONT.bold,
    color: theme.text, letterSpacing: -0.8, marginBottom: 8,
  },
  subtitle: {
    fontSize: 15, fontFamily: FONT.regular,
    color: theme.muted, lineHeight: 22, marginBottom: 32,
  },

  fieldWrap: { marginBottom: 16 },
  label:     { fontSize: 12, fontFamily: FONT.semibold, color: theme.muted, marginBottom: 6 },
  input: {
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, fontFamily: FONT.regular, color: theme.text,
  },
  codeInput: {
    fontSize: 22, textAlign: 'center',
    fontFamily: FONT.bold,
  },
  pwRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12,
  },
  pwInput: { flex: 1, borderWidth: 0, backgroundColor: 'transparent' },
  eyeBtn:  { paddingHorizontal: 14 },
  hint:    { fontSize: 12, fontFamily: FONT.regular, color: theme.muted, marginTop: 4 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${theme.error}14`, borderRadius: 8,
    borderWidth: 1, borderColor: `${theme.error}40`,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
  },
  errorText: { fontSize: 13, fontFamily: FONT.regular, color: theme.error, flex: 1 },

  primaryWrap: { marginBottom: SPACING.xs + 2 },

  resendBtn:  { paddingVertical: 14, alignItems: 'center' },
  resendText: { fontSize: 15, fontFamily: FONT.regular, color: theme.muted },
  noticeText: { fontSize: 13, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center' },

  // Success card
  successCard: {
    borderRadius: 16, borderWidth: 1,
    borderColor: `${theme.success}40`, overflow: 'hidden', marginBottom: 28,
  },
  successGrad: { padding: 28, alignItems: 'center' },
  successIconWrap: { marginBottom: 20 },
  successIconGrad: {
    width: 64, height: 64, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  successTitle: {
     fontSize: 28, fontFamily: FONT.bold, color: theme.text,
    letterSpacing: -0.5, marginBottom: 8, textAlign: 'center',
  },
  successSub: {
    fontSize: 15, fontFamily: FONT.regular,
     color: theme.muted, lineHeight: 21, textAlign: 'center',
  },

});
