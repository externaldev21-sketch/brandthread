import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, useColorScheme, ScrollView,
} from 'react-native';
import { useSignIn } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

type Step = 'email' | 'code' | 'done';

export default function ForgotPasswordScreen() {
  const { signIn, fetchStatus } = useSignIn();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';

  const [step, setStep]         = useState<Step>('email');
  const [email, setEmail]       = useState('');
  const [code, setCode]         = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const bg      = isDark ? '#0E0E0E' : '#F5F5F5';
  const card    = isDark ? '#1A1A1A' : '#FFFFFF';
  const border  = isDark ? '#2A2A2A' : '#E0E0E0';
  const fg      = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted   = isDark ? '#888' : '#666';
  const primary = '#00C853';
  const inputBg = isDark ? '#252525' : '#F0F0F0';

  const inputStyle = [styles.input, { backgroundColor: inputBg, borderColor: border, color: fg }];

  const handleSendCode = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      await (signIn as any).create({
        identifier: email.trim().toLowerCase(),
        strategy: 'reset_password_email_code',
      });
      setStep('code');
    } catch (e: any) {
      const msg = e?.errors?.[0]?.longMessage ?? e?.message ?? 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!code || !password) return;
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
      const msg = e?.errors?.[0]?.longMessage ?? e?.message ?? 'Invalid code or password too weak.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const isFetching = fetchStatus === 'fetching' || loading;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: card, borderColor: border, marginTop: insets.top + 32, marginHorizontal: 20 }]}>

          {/* Back */}
          {step !== 'done' && (
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Feather name="arrow-left" size={20} color={muted} />
            </TouchableOpacity>
          )}

          {step === 'email' && (
            <>
              <Text style={[styles.title, { color: fg }]}>Reset password</Text>
              <Text style={[styles.sub, { color: muted }]}>
                Enter your email and we'll send a reset code.
              </Text>

              <View style={styles.field}>
                <Text style={[styles.label, { color: muted }]}>Email</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="you@yourbrand.com"
                  placeholderTextColor={muted}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoFocus
                />
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.btn, { backgroundColor: primary }, (!email || isFetching) && { opacity: 0.6 }]}
                onPress={handleSendCode}
                disabled={!email || isFetching}
                activeOpacity={0.85}
              >
                {isFetching
                  ? <ActivityIndicator color="#021208" />
                  : <Text style={styles.btnText}>Send reset code</Text>}
              </TouchableOpacity>
            </>
          )}

          {step === 'code' && (
            <>
              <Text style={[styles.title, { color: fg }]}>Check your inbox</Text>
              <Text style={[styles.sub, { color: muted }]}>
                We sent a reset code to {email}. Enter it below along with your new password.
              </Text>

              <View style={styles.field}>
                <Text style={[styles.label, { color: muted }]}>Reset code</Text>
                <TextInput
                  style={[inputStyle, { letterSpacing: 4, textAlign: 'center', fontSize: 20 }]}
                  placeholder="000000"
                  placeholderTextColor={muted}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: muted }]}>New password</Text>
                <View style={styles.pwWrap}>
                  <TextInput
                    style={[inputStyle, { flex: 1, borderWidth: 0, paddingRight: 44 }]}
                    placeholder="Min. 8 characters"
                    placeholderTextColor={muted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPw}
                  />
                  <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPw(v => !v)}>
                    <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={muted} />
                  </TouchableOpacity>
                </View>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.btn, { backgroundColor: primary }, (!code || !password || isFetching) && { opacity: 0.6 }]}
                onPress={handleReset}
                disabled={!code || !password || isFetching}
                activeOpacity={0.85}
              >
                {isFetching
                  ? <ActivityIndicator color="#021208" />
                  : <Text style={styles.btnText}>Reset password</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={styles.resendRow} onPress={handleSendCode}>
                <Text style={[styles.resendText, { color: muted }]}>
                  {"Didn't get it? "}<Text style={{ color: primary }}>Resend code</Text>
                </Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'done' && (
            <>
              <View style={styles.doneIcon}>
                <Feather name="check-circle" size={48} color={primary} />
              </View>
              <Text style={[styles.title, { color: fg, textAlign: 'center' }]}>Password updated</Text>
              <Text style={[styles.sub, { color: muted, textAlign: 'center' }]}>
                Your password has been reset. Sign in with your new password.
              </Text>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: primary }]}
                onPress={() => router.replace('/sign-in' as never)}
                activeOpacity={0.85}
              >
                <Text style={styles.btnText}>Back to sign in</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:     { flex: 1 },
  card:     { borderRadius: 24, padding: 28, borderWidth: 1, marginBottom: 24 },
  backBtn:  { marginBottom: 20 },
  title:    { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, marginBottom: 8 },
  sub:      { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 24, color: '#666' },
  field:    { marginBottom: 16 },
  label:    { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  input:    { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: 'Inter_400Regular' },
  pwWrap:   { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  eyeBtn:   { position: 'absolute', right: 14 },
  error:    { color: '#EF4444', fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 12 },
  btn:      { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  btnText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#021208' },
  resendRow: { marginTop: 16, alignItems: 'center' },
  resendText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  doneIcon:  { alignItems: 'center', marginBottom: 20 },
});
