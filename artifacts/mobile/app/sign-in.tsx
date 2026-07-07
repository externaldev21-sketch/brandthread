/**
 * Sign-in / Sign-up screen — follows canonical Clerk Core v3 Signals API
 * Reference: .local/skills/clerk-auth/references/custom-ui/expo-sdk-email-password.md
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, useColorScheme, ScrollView,
} from 'react-native';
import { useSignIn, useSignUp } from '@clerk/expo';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  // Clerk v3 Signals API — destructure signIn/signUp directly (no isLoaded/setActive)
  const { signIn, errors: signInErrors, fetchStatus: signInFetch } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpFetch } = useSignUp();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';

  const [mode, setMode]         = useState<Mode>('sign-in');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [code, setCode]         = useState('');

  const bg      = isDark ? '#08080F' : '#F8F7FF';
  const card    = isDark ? '#111118' : '#FFFFFF';
  const border  = isDark ? '#252535' : '#DDD6FE';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const inputBg = isDark ? '#1C1C2E' : '#F0EEFF';

  // ─── Sign-in ───────────────────────────────────────────────────────────────

  const handleSignIn = async () => {
    const { error } = await signIn.password({ emailAddress: email, password });
    if (error) {
      console.error('[sign-in] password error:', JSON.stringify(error, null, 2));
      return; // errors.fields.* will render below the inputs automatically
    }

    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl('/');
          if (url.startsWith('http')) {
            // web path
            if (typeof window !== 'undefined') window.location.href = url;
          } else {
            router.replace(url as Href);
          }
        },
      });
    } else {
      // needs_second_factor / needs_client_trust — uncommon for simple setups
      console.warn('[sign-in] status after password():', signIn.status);
    }
  };

  // ─── Sign-up step 1: create account ───────────────────────────────────────

  const handleSignUp = async () => {
    const nameParts = name.trim().split(/\s+/);
    const { error } = await signUp.password({
      emailAddress: email,
      password,
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(' ') || undefined,
    });
    if (error) {
      console.error('[sign-up] password error:', JSON.stringify(error, null, 2));
      return;
    }
    // Send verification code
    if (!error) await signUp.verifications.sendEmailCode();
  };

  // ─── Sign-up step 2: verify email code ────────────────────────────────────

  const handleVerify = async () => {
    await signUp.verifications.verifyEmailCode({ code });

    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl('/onboarding');
          if (url.startsWith('http')) {
            if (typeof window !== 'undefined') window.location.href = url;
          } else {
            router.replace(url as Href);
          }
        },
      });
    } else {
      console.warn('[sign-up] status after verify:', signUp.status, signUp);
    }
  };

  const inputStyle  = [styles.input, { backgroundColor: inputBg, borderColor: border, color: fg }];
  const labelStyle  = [styles.label, { color: muted }];
  const isSigningIn = signInFetch === 'fetching';
  const isSigningUp = signUpFetch === 'fetching';

  // ─── Sign-up verification screen ──────────────────────────────────────────

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
        <View style={[styles.card, { backgroundColor: card, borderColor: border, marginTop: insets.top + 40, marginBottom: insets.bottom + 24 }]}>
          <BrandRow primary={primary} fg={fg} />
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
              autoFocus
            />
            {signUpErrors.fields.code && (
              <Text style={styles.error}>{signUpErrors.fields.code.message}</Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: primary }]}
            onPress={handleVerify}
            disabled={isSigningUp || code.length < 6}
            activeOpacity={0.85}
          >
            {isSigningUp
              ? <ActivityIndicator color="#FFF" />
              : <Text style={styles.btnText}>Verify email</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchRow}
            onPress={() => signUp.verifications.sendEmailCode()}
          >
            <Text style={[styles.switchText, { color: muted }]}>
              {'Didn\'t get it? '}
              <Text style={{ color: primary, fontFamily: 'Inter_600SemiBold' }}>Resend code</Text>
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.switchRow} onPress={() => setCode('')}>
            <Text style={[styles.switchText, { color: muted }]}>
              {'← '}
              <Text style={{ color: primary, fontFamily: 'Inter_600SemiBold' }}>Go back</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── Main sign-in / sign-up form ──────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: card, borderColor: border, marginTop: insets.top + 40, marginBottom: insets.bottom + 24 }]}>

          <BrandRow primary={primary} fg={fg} />

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
            {mode === 'sign-in' && signInErrors.fields.identifier && (
              <Text style={styles.error}>{signInErrors.fields.identifier.message}</Text>
            )}
            {mode === 'sign-up' && signUpErrors.fields.emailAddress && (
              <Text style={styles.error}>{signUpErrors.fields.emailAddress.message}</Text>
            )}
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
            {mode === 'sign-in' && signInErrors.fields.password && (
              <Text style={styles.error}>{signInErrors.fields.password.message}</Text>
            )}
            {mode === 'sign-up' && signUpErrors.fields.password && (
              <Text style={styles.error}>{signUpErrors.fields.password.message}</Text>
            )}
          </View>

          <TouchableOpacity
            style={[
              styles.btn,
              { backgroundColor: primary },
              (isSigningIn || isSigningUp) && { opacity: 0.7 },
            ]}
            onPress={mode === 'sign-in' ? handleSignIn : handleSignUp}
            disabled={!email || !password || isSigningIn || isSigningUp}
            activeOpacity={0.85}
          >
            {(isSigningIn || isSigningUp)
              ? <ActivityIndicator color="#FFF" />
              : <Text style={styles.btnText}>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchRow}
            onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
          >
            <Text style={[styles.switchText, { color: muted }]}>
              {mode === 'sign-in' ? "Don't have an account? " : 'Already have an account? '}
              <Text style={{ color: primary, fontFamily: 'Inter_600SemiBold' }}>
                {mode === 'sign-in' ? 'Sign up' : 'Sign in'}
              </Text>
            </Text>
          </TouchableOpacity>

          {/* Required: Clerk bot-protection captcha anchor (sign-up flows) */}
          <View nativeID="clerk-captcha" />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function BrandRow({ primary, fg }: { primary: string; fg: string }) {
  return (
    <View style={styles.brandRow}>
      <View style={[styles.logoCircle, { backgroundColor: primary }]}>
        <Feather name="scissors" size={22} color="#FFF" />
      </View>
      <Text style={[styles.brandName, { color: fg }]}>Brandthread</Text>
    </View>
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
  error:      { color: '#EF4444', fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 4 },
  btn:        { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  btnText:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  switchRow:  { marginTop: 16, alignItems: 'center' },
  switchText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
});
