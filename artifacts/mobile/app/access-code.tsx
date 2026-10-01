/**
 * Invite-only launch gate. AuthGate sends a signed-in, not-yet-onboarded
 * account here only when the server reports `inviteOnlySignup` is on and the
 * account hasn't redeemed a code (GET /api/access/status). Enter a code to
 * continue to onboarding, or join the waitlist with an email.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Platform } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { apiErrorMessage } from '@/lib/safety';
import { markAccessCleared } from '@/lib/accessGate';

type Mode = 'code' | 'waitlist' | 'joined';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function AccessCodeScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut, userId } = useAuth();

  const [mode, setMode] = useState<Mode>('code');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function show(next: Mode) {
    setError(null);
    setMode(next);
  }

  async function submitCode() {
    const value = code.trim();
    if (busy) return;
    if (!value) { setError('Enter your invite code.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.access.redeem(value);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      markAccessCleared(userId);
      router.replace('/onboarding' as never);
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t check that code. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail() {
    const value = email.trim().toLowerCase();
    if (busy) return;
    if (!EMAIL_RE.test(value)) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.access.joinWaitlist(value);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setMode('joined');
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t add you right now. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    try { await signOut(); } catch { /* the auth gate handles the rest */ }
    router.replace('/sign-in' as never);
  }

  const title = mode === 'code' ? 'Enter your invite code' : mode === 'waitlist' ? 'Join the waitlist' : 'You’re on the list';

  return (
    <View style={s.root}>
      <ScreenHeader
        title="Access"
        hideDivider
        backAccessibilityLabel={mode === 'code' ? 'Sign out' : 'Back'}
        onBack={mode === 'code' ? leave : () => show('code')}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + SP.lg }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.title} accessibilityRole="header">{title}</Text>

          {mode === 'code' && (
            <View style={s.group} testID="access-form">
              <TextInput
                style={s.input}
                value={code}
                onChangeText={(v) => { setCode(v); setError(null); }}
                placeholder="Invite code"
                placeholderTextColor={theme.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                maxLength={24}
                returnKeyType="go"
                onSubmitEditing={submitCode}
                accessibilityLabel="Invite code"
                testID="access-code-input"
              />
              {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
              <PrimaryButton label="Continue" onPress={submitCode} loading={busy} style={s.button} />
              <PressableScale onPress={() => show('waitlist')} style={s.secondary} accessibilityRole="button" accessibilityLabel="Join the waitlist">
                <Text style={s.secondaryText}>Join the waitlist</Text>
              </PressableScale>
            </View>
          )}

          {mode === 'waitlist' && (
            <View style={s.group} testID="access-form">
              <TextInput
                style={s.input}
                value={email}
                onChangeText={(v) => { setEmail(v); setError(null); }}
                placeholder="Email address"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="go"
                onSubmitEditing={submitEmail}
                accessibilityLabel="Email address"
                testID="access-waitlist-input"
              />
              {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
              <PrimaryButton label="Join waitlist" onPress={submitEmail} loading={busy} style={s.button} />
              <PressableScale onPress={() => show('code')} style={s.secondary} accessibilityRole="button" accessibilityLabel="I have a code">
                <Text style={s.secondaryText}>I have a code</Text>
              </PressableScale>
            </View>
          )}

          {mode === 'joined' && (
            <View style={s.group} testID="access-form">
              <Text style={s.body}>We’ll email you when your invite is ready.</Text>
              <PrimaryButton label="Enter a code" onPress={() => show('code')} style={s.button} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  content: { paddingHorizontal: SP.md, paddingTop: SP.xl, gap: SP.md },
  group: { gap: SP.md },
  title: {
    fontSize: FS.xxl, fontFamily: FONT.bold, color: theme.text, textAlign: 'center',
    marginBottom: SP.sm,
  },
  body: { fontSize: FS.base, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center' },
  input: {
    height: COMP.inputH, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.surface, paddingHorizontal: SP.lg,
    fontSize: FS.md, fontFamily: FONT.regular, color: theme.text, textAlign: 'center',
  },
  error: { fontSize: FS.base, fontFamily: FONT.regular, color: theme.error, textAlign: 'center' },
  button: { alignSelf: 'stretch' },
  secondary: {
    height: COMP.buttonH, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md,
  },
  secondaryText: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.text },
});
