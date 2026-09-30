/**
 * Referral invite deep link: https://brandthread.app/invite/CODE or
 * brandthread://invite/CODE.
 *
 * - Always counts one link click (public, no-PII endpoint).
 * - Signed out: carries the code into onboarding (`?referralCode=`), which
 *   already survives the Clerk redirect and applies it for new buyers.
 * - Signed in: friendly note only. Existing members can't redeem an invite.
 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { API_BASE_URL } from '@/lib/api';
import { FONT, FS, SP } from '@/lib/theme';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { referralInviteePath } from '@/lib/referralCopy';

export default function InviteDeepLinkScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isSignedIn, isLoaded } = useAuth();
  const { code: rawCode } = useLocalSearchParams<{ code?: string }>();
  const code = (typeof rawCode === 'string' ? rawCode : '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const counted = useRef(false);

  useEffect(() => {
    if (!code || counted.current) return;
    counted.current = true;
    fetch(`${API_BASE_URL}/api/referrals/invite/${encodeURIComponent(code)}`).catch(() => {});
  }, [code]);

  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    router.replace((code ? referralInviteePath(code) : '/onboarding') as never);
  }, [isLoaded, isSignedIn, code, router]);

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
});
