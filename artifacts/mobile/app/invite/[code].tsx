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
import { REFERRAL_SUBHEAD, referralInviteePath } from '@/lib/referralCopy';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';

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
      <View style={[styles.root, styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.text} accessibilityLabel="Opening invite" />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background, paddingBottom: insets.bottom + SP.lg }]}>
      {/* Signed-in members land here from someone else's link: give them a way out. */}
      <ScreenHeader title="Invite" onBack={() => goBackOr(router, '/')} />
      <View style={[styles.center, styles.content]}>
        <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">You're already on Brandthread</Text>
        <Text style={[styles.body, { color: theme.muted }]}>
          Invite links are for new members. {REFERRAL_SUBHEAD}
        </Text>
        {/* PrimaryButton's outer Pressable ignores alignSelf, so the stretch lives on a wrapper. */}
        <View style={styles.cta}>
          <PrimaryButton
            label="Share your invite"
            onPress={() => router.replace('/buyer-invite' as never)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, paddingHorizontal: SP.xl },
  cta: { alignSelf: 'stretch', marginTop: SP.lg },
  title: { fontSize: FS.xl, fontFamily: FONT.bold, textAlign: 'center' },
  body: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', marginTop: SP.sm, lineHeight: 20 },
});
