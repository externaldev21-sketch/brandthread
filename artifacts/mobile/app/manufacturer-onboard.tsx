/**
 * Manufacturer signup handoff.
 *
 * Manufacturers sign up and work in the Brandthread Manufacturer Portal (web),
 * where they upload factory photos, price order cards, update production and
 * verify payouts. Older invite links pointed here; this screen forwards the
 * invite token to the portal's join page instead of running a partial,
 * app-only signup.
 */
import React, { useMemo } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Icon } from '@/components/ui/Icon';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ThreadDraw } from '@/components/onboarding/ThreadLine';
import { PillButton, Reveal, StepHeadline } from '@/components/onboarding/OnboardingUI';
import { COMP, FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { showToast } from '@/lib/toast';
import { BRANDTHREAD_ORIGIN } from '@/lib/shareProfile';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';

function portalJoinUrl(token?: string) {
  const origin = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') || BRANDTHREAD_ORIGIN;
  return `${origin}/manufacturers/join${token ? `?invite=${encodeURIComponent(token)}` : ''}`;
}

export default function ManufacturerOnboardScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarInset = useSellerTabBarInset();
  const url = portalJoinUrl(typeof token === 'string' ? token : undefined);
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  async function copyLink() {
    try {
      await Clipboard.setStringAsync(url);
      showToast('Link copied');
    } catch {
      // Clipboard unavailable: the link stays selectable below.
    }
  }

  return (
    <View style={s.screen}>
    <ScreenHeader title="Manufacturer signup" onBack={() => (router.canGoBack() ? goBackOr(router) : router.replace('/' as never))} />
    <View style={[s.root, { paddingTop: SP.md, paddingBottom: (tabBarInset || insets.bottom) + SP.md }]}>
      <View style={s.body}>
        <View style={s.hero}>
          <ThreadDraw height={72} color={theme.text} delay={150} duration={1200} style={s.heroThread} />
          <View style={s.icon}><Icon name="briefcase" size={26} color={theme.text} /></View>
        </View>
        <StepHeadline size="title1">{token ? 'You were invited to work on Brandthread' : 'List your factory on Brandthread'}</StepHeadline>
        <Reveal index={1}>
        <Text style={s.text}>
          Manufacturers use the Brandthread Manufacturer Portal to set up their profile and photos, chat with sellers, send priced sample and bulk cards, update production and get paid through Stripe.
          {token ? ' Your invite is private: only the seller who invited you will see your profile.' : ' Your listing goes live in the directory once your profile is verified.'}
        </Text>
        </Reveal>
        <Reveal index={2}>
        <View style={s.card}>
          {['Free to join. 5% + processing on paid orders.', 'Works in any browser, on phone or computer', 'Paid out to your bank in your currency'].map((line) => (
            <View key={line} style={s.row}><Icon name="check" size={14} color={theme.text} /><Text style={s.rowText}>{line}</Text></View>
          ))}
        </View>
        </Reveal>
      </View>
      <PillButton
        label={token ? 'Accept invite in the portal' : 'Open the manufacturer portal'}
        trailing={<Icon name="external-link" size={16} color={theme.onAccent} />}
        onPress={() => void Linking.openURL(url)}
      />
      {/* The raw URL stays visible and selectable for desktop; the button copies it on a phone. */}
      <TouchableOpacity
        style={s.copyBtn}
        onPress={() => void copyLink()}
        accessibilityRole="button"
        accessibilityLabel="Copy link"
        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
        testID="manufacturer-onboard-copy-link"
      >
        <Icon name="copy" size={14} color={theme.text} />
        <Text style={s.copyText}>Copy link</Text>
      </TouchableOpacity>
      <Text style={s.url} selectable>{url}</Text>
    </View>
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  screen: { flex: 1 },
  root: { flex: 1, paddingHorizontal: SP.lg, gap: SP.md },
  body: { flex: 1, justifyContent: 'center', gap: SP.md },
  hero: { height: 72, justifyContent: 'center' },
  heroThread: { position: 'absolute', left: -SP.lg, right: -SP.lg, top: 0 },
  icon: { width: 60, height: 60, borderRadius: 30, backgroundColor: theme.background, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', marginLeft: SP.lg },
  text: { fontSize: FS.base, fontFamily: FONT.regular, color: theme.muted, lineHeight: 22 },
  card: { backgroundColor: theme.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, padding: SP.md, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs, alignSelf: 'center', minHeight: COMP.minTouchTarget, paddingHorizontal: SP.md },
  copyText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  url: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textAlign: 'center' },
});
