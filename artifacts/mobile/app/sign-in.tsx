import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, useColorScheme,
} from 'react-native';
import { useSignIn, useSignUp } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  // Clerk v3 Signals API — no isLoaded/setActive on these hooks
  const signInCtx  = useSignIn();
  const signUpCtx  = useSignUp();
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const scheme     = useColorScheme();
  const isDark     = scheme !== 'light';

  const [mode, setMode]           = useState<Mode>('sign-in');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [name, setName]           = useState('');
  const [code, setCode]           = useState('');
  const [pendingVerify, setPendingVerify] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  const bg      = isDark ? '#08080F' : '#F8F7FF';
  const card    = isDark ? '#111118' : '#FFFFFF';
  const border  = isDark ? '#252535' : '#DDD6FE';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const inputBg = isDark ? '#1C1C2E' : '#F0EEFF';

  function clerkMsg(e: any): string {
    return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? e?.message ?? 'Something went wrong';
  }

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      if (mode === 'sign-in') {
        const { error: signInError } = await signInCtx.signIn.password({
          identifier: email,
          password,
        });
        if (signInError) { setError(signInError.longMessage ?? signInError.message ?? 'Sign-in failed'); return; }
        const { error: finalizeError } = await signInCtx.signIn.finalize();
        if (finalizeError) { setError(finalizeError.longMessage ?? finalizeError.message ?? 'Could not activate session'); return; }
        router.replace('/');
      } else {
        const nameParts = name.trim().split(/\s+/);
        const { error: signUpError } = await signUpCtx.signUp.password({
          emailAddress: email,
          password,
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(' ') || undefined,
        });
        if (signUpError) { setError(signUpError.longMessage ?? signUpError.message ?? 'Sign-up failed'); return; }
        // Send email verification code
        const { error: sendError } = await signUpCtx.signUp.verifications.sendEmailCode();
        if (sendError) { setError(sendError.longMessage ?? sendError.message ?? 'Could not send code'); return; }
        setPendingVerify(true);
      }
    } catch (e: any) {
      setError(clerkMsg(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    setError('');
    setLoading(true);
    try {
      const { error: verifyError } = await signUpCtx.signUp.verifications.verifyEmailCode({ code });
      if (verifyError) { setError(verifyError.longMessage ?? verifyError.message ?? 'Invalid code'); return; }
      const { error: finalizeError } = await signUpCtx.signUp.finalize();
      if (finalizeError) { setError(finalizeError.longMessage ?? finalizeError.message ?? 'Could not activate account'); return; }
      router.replace('/onboarding');
    } catch (e: any) {
      setError(clerkMsg(e));
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = [styles.input, { backgroundColor: inputBg, borderColor: border, color: fg }];
  const labelStyle = [styles.label, { color: muted }];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.card, { backgroundColor: card, borderColor: border, marginTop: insets.top + 40, marginBottom: insets.bottom + 24 }]}>

        {/* Logo */}
        <View style={styles.brandRow}>
          <View style={[styles.logoCircle, { backgroundColor: primary }]}>
            <Feather name="scissors" size={22} color="#FFF" />
          </View>
          <Text style={[styles.brandName, { color: fg }]}>Brandthread</Text>
        </View>

        {!pendingVerify ? (
          <>
            <Text style={[styles.title, { color: fg }]}>
              {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
            </Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              {mode === 'sign-in'
                ? 'Sign in to manage your brand'
                : 'Start building your clothing brand'}
            </Text>

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

            <View style={styles.field}>
              <Text style={labelStyle}>Email</Text>
              <TextInput
                style={inputStyle}
                placeholder="you@yourbrand.com"
                placeholderTextColor={muted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <View style={styles.field}>
              <Text style={labelStyle}>Password</Text>
              <TextInput
                style={inputStyle}
                placeholder="••••••••"
                placeholderTextColor={muted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: primary }]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.btnText}>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchRow}
              onPress={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(''); }}
            >
              <Text style={[styles.switchText, { color: muted }]}>
                {mode === 'sign-in' ? "Don't have an account? " : 'Already have an account? '}
                <Text style={{ color: primary, fontFamily: 'Inter_600SemiBold' }}>
                  {mode === 'sign-in' ? 'Sign up' : 'Sign in'}
                </Text>
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: fg }]}>Check your email</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              We sent a 6-digit code to {email}
            </Text>

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
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: primary }]}
              onPress={handleVerify}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.btnText}>Verify email</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchRow}
              onPress={() => { setPendingVerify(false); setCode(''); setError(''); }}
            >
              <Text style={[styles.switchText, { color: muted }]}>
                {'← '}
                <Text style={{ color: primary, fontFamily: 'Inter_600SemiBold' }}>Go back</Text>
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, paddingHorizontal: 20 },
  card:       { borderRadius: 24, padding: 28, borderWidth: 1 },
  brandRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 28 },
  logoCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  brandName:  { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  title:      { fontSize: 24, fontFamily: 'Inter_700Bold', marginBottom: 6, letterSpacing: -0.4 },
  subtitle:   { fontSize: 14, fontFamily: 'Inter_400Regular', marginBottom: 24, lineHeight: 20 },
  field:      { marginBottom: 16 },
  label:      { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  input:      { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: 'Inter_400Regular' },
  error:      { color: '#EF4444', fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 12 },
  btn:        { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  btnText:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  switchRow:  { marginTop: 20, alignItems: 'center' },
  switchText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
});
