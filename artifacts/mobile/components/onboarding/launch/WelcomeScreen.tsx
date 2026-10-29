/**
 * Welcome — TikTok "Sign up for TikTok" / "Log in to TikTok", 1:1:
 * big left-aligned title, stacked hairline option rows (icon left, label
 * centred; Continue with Apple first, as Depop does), the legal line near the bottom, and a grey footer band with
 * "Already have an account? Log in" (toggles to the log-in variant).
 * Mobbin: https://mobbin.com/screens/46bf3222-f4bb-4584-9906-e4df964b3fe0
 *         https://mobbin.com/screens/29a6cf9e-6c19-46f8-8b27-f387df675e40
 */
import React from 'react';
import { MEDIA, FONT, FS } from '@/lib/theme';
import { StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GoogleGlyph from '@/components/branding/GoogleGlyph';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FieldError, GUTTER, OutlineOption, ScalePressable } from './kit';

export type WelcomeMode = 'signup' | 'login';

export function WelcomeScreen({
  mode,
  onToggleMode,
  onEmail,
  onApple,
  onGoogle,
  onClose,
  busy,
  error,
  inviteApplied,
  devBanner,
}: {
  mode: WelcomeMode;
  onToggleMode: () => void;
  onEmail: () => void;
  /** Omitted when the provider is off (feature flag / platform). */
  onApple?: () => void;
  onGoogle?: () => void;
  /** TikTok's ✕: leave without an account (guest browsing). */
  onClose?: () => void;
  busy?: 'apple' | 'google' | null;
  error?: string;
  /** Arrived from an invite link (/invite/CODE): show that it was recognised. */
  inviteApplied?: boolean;
  devBanner?: React.ReactNode;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const signup = mode === 'signup';
  const band = theme.text.toUpperCase() === MEDIA.foreground ? '#141414' : '#F2F2F2';
  const link = (label: string, route: string) => (
    <Text style={[s.legalLink, { color: theme.text }]} onPress={() => router.push(route as never)} accessibilityRole="link" suppressHighlighting>
      {label}
    </Text>
  );

  return (
    <View testID="onboarding-welcome" style={[s.root, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <View style={s.topBar}>
        <View />
        {onClose ? (
          <ScalePressable testID="onboarding-welcome-close" onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={24} color={theme.text} />
          </ScalePressable>
        ) : null}
      </View>
      {devBanner}
      <View style={s.body}>
        <Text accessibilityRole="header" style={[s.title, !signup && s.titleLogin, { color: theme.text }]}>
          {signup ? 'Sign up\nfor Brandthread' : 'Log in to Brandthread'}
        </Text>
        {inviteApplied ? (
          <View testID="onboarding-invite-applied" style={[s.invite, !signup && s.inviteLogin, { borderColor: theme.border }]} accessible accessibilityLabel="Invite applied">
            <Feather name="check" size={14} color={theme.text} />
            <Text style={[s.inviteText, { color: theme.text }]}>Invite applied</Text>
          </View>
        ) : null}
        <View style={s.options}>
          {onApple ? (
            <OutlineOption
              testID="onboarding-apple"
              label="Continue with Apple"
              icon={<Ionicons name="logo-apple" size={21} color={theme.text} />}
              onPress={onApple}
              loading={busy === 'apple'}
              disabled={!!busy && busy !== 'apple'}
            />
          ) : null}
          <OutlineOption
            testID="onboarding-use-email"
            label={signup ? 'Use email' : 'Use phone or email'}
            icon={<Feather name="user" size={20} color={theme.text} />}
            onPress={onEmail}
            disabled={!!busy}
          />
          {onGoogle ? (
            <OutlineOption
              testID="onboarding-google"
              label="Continue with Google"
              icon={<GoogleGlyph size={18} />}
              onPress={onGoogle}
              loading={busy === 'google'}
              disabled={!!busy && busy !== 'google'}
            />
          ) : null}
          <FieldError testID="onboarding-welcome-error" message={error} />
        </View>
      </View>
      <Text testID="legal-consent-line" style={[s.legal, { color: theme.muted }]}>
        By continuing, you agree to our {link('Terms of Service', '/terms')} and {link('Community Guidelines', '/community-guidelines')}, and acknowledge that you have read our {link('Privacy Policy', '/privacy')}.
      </Text>
      <View style={[s.band, { backgroundColor: band, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Text style={[s.bandText, { color: theme.text }]}>
          {signup ? 'Already have an account? ' : 'Don’t have an account? '}
          <Text testID="onboarding-toggle-mode" style={s.bandLink} onPress={onToggleMode} accessibilityRole="button" suppressHighlighting>
            {signup ? 'Log in' : 'Sign up'}
          </Text>
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  topBar: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER },
  body: { flex: 1, paddingHorizontal: GUTTER + 8 },
  title: { fontSize: FS.h1, lineHeight: 41, fontFamily: FONT.bold, letterSpacing: -0.4, marginTop: 24 },
  titleLogin: { fontSize: FS.xxl, lineHeight: 34, textAlign: 'center' },
  invite: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 16, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  inviteLogin: { alignSelf: 'center' },
  inviteText: { fontSize: 13, fontFamily: FONT.semibold },
  options: { marginTop: 36, gap: 12 },
  legal: { fontSize: 12, lineHeight: 16, textAlign: 'center', paddingHorizontal: GUTTER + 12, marginBottom: 20 },
  legalLink: { fontFamily: FONT.semibold },
  band: { paddingTop: 20, alignItems: 'center' },
  bandText: { fontSize: 15 },
  bandLink: { fontFamily: FONT.bold, textDecorationLine: 'underline' },
});
