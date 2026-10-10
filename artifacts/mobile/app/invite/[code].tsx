/**
 * Referral invite deep link: https://brandthread.app/invite/CODE or
 * brandthread://invite/CODE.
 *
 * - Always counts one link click (public, no-PII endpoint).
 * - Signed out: carries the code into onboarding (`?referralCode=`), which
 *   already survives the Clerk redirect and applies it for new buyers.
 * - Signed in: friendly note only. Existing members can't redeem an invite.
 * - Mobile web, signed out, with the store listing configured (BT-312): the
 *   Craft "You've been invited" page — Download (copies this invite link so
 *   the app picks it up on first launch, components/DeferredInviteCapture)
 *   or Continue in browser (the onboarding hand-off above).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@clerk/expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { API_BASE_URL } from '@/lib/api';
import { FONT, FS, SP } from '@/lib/theme';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { referralInviteePath } from '@/lib/referralCopy';
import { SecondaryButton } from '@/components/BrandthreadUI';
import { appStoreLinks, storeForUserAgent } from '@/lib/deferredInvite';

/** The store button a signed-out web visitor gets, or null to keep the plain onboarding hand-off. */
function webStoreTarget(): { label: string; url: string } | null {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return null;
  const links = appStoreLinks();
  const store = storeForUserAgent(navigator.userAgent ?? '');
  if (store === 'ios' && links.ios) return { label: 'Download for iOS', url: links.ios };
  if (store === 'android' && links.android) return { label: 'Download for Android', url: links.android };
  return null;
}

export default function InviteDeepLinkScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isSignedIn, isLoaded } = useAuth();
  const { code: rawCode } = useLocalSearchParams<{ code?: string }>();
  const code = (typeof rawCode === 'string' ? rawCode : '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const counted = useRef(false);
  const store = useMemo(webStoreTarget, []);

  useEffect(() => {
    if (!code || counted.current) return;
    counted.current = true;
    fetch(`${API_BASE_URL}/api/referrals/invite/${encodeURIComponent(code)}`).catch(() => {});
  }, [code]);

  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    if (store && code) return; // the download page below
    router.replace((code ? referralInviteePath(code) : '/onboarding') as never);
  }, [isLoaded, isSignedIn, code, router, store]);

  if (isLoaded && !isSignedIn && store && code) {
    const download = async () => {
      try { await Clipboard.setStringAsync(`https://brandthread.app/invite/${code}`); } catch { /* still open the store */ }
      Linking.openURL(store.url).catch(() => {});
    };
    return (
      <View style={[styles.root, { backgroundColor: theme.background, paddingBottom: insets.bottom + SP.lg }]}>
        <Text style={[styles.title, { color: theme.text }]}>You've been invited to Brandthread</Text>
        <Text style={[styles.body, { color: theme.muted }]}>Join with this invite and get $10 Thread Cash.</Text>
        <Text style={[styles.code, { color: theme.text }]} accessibilityLabel={`Invite code ${code.split('').join(' ')}`}>{code}</Text>
        <PrimaryButton label={store.label} onPress={download} style={{ alignSelf: 'stretch', marginTop: SP.lg }} />
        <Text style={[styles.note, { color: theme.muted }]}>Your invite is copied, so it's waiting when you open the app.</Text>
        <SecondaryButton
          label="Continue in browser"
          onPress={() => router.replace(referralInviteePath(code) as never)}
          style={{ alignSelf: 'stretch', marginTop: SP.md }}
        />
      </View>
    );
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.text} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background, paddingBottom: insets.bottom + SP.lg }]}>
      <Text style={[styles.title, { color: theme.text }]}>You are already on Brandthread</Text>
      <Text style={[styles.body, { color: theme.muted }]}>
        Invite links are for new members. Share yours and you both get $10 Thread Cash.
      </Text>
      <PrimaryButton
        label="Share your invite"
        onPress={() => router.replace('/buyer-invite' as never)}
        style={{ alignSelf: 'stretch', marginTop: SP.lg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  title: { fontSize: FS.xl, fontFamily: FONT.bold, textAlign: 'center' },
  body: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', marginTop: SP.sm, lineHeight: 20 },
  code: { fontSize: FS.xxl, fontFamily: FONT.bold, letterSpacing: 0, marginTop: SP.lg, fontVariant: ['tabular-nums'] },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', marginTop: SP.sm },
});
