/**
 * Manufacturer signup handoff.
 *
 * Manufacturers sign up and work in the Brandthread Manufacturer Portal (web),
 * where they upload factory photos, price order cards, update production and
 * verify payouts. Older invite links pointed here; this screen forwards the
 * invite token to the portal's join page instead of running a partial,
 * app-only signup.
 */
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { Header } from '@/components/layout';
import { BORDER, CARD, CARD_ELEVATED, FG, FONT, FS, MUTED, RADIUS, SP, SUBTLE } from '@/lib/theme';
import { BRANDTHREAD_ORIGIN } from '@/lib/shareProfile';

function portalJoinUrl(token?: string) {
  const origin = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') || BRANDTHREAD_ORIGIN;
  return `${origin}/manufacturers/join${token ? `?invite=${encodeURIComponent(token)}` : ''}`;
}

export default function ManufacturerOnboardScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const url = portalJoinUrl(typeof token === 'string' ? token : undefined);

  return (
    <View style={s.screen}>
    <Header title="Manufacturer signup" onBack={() => (router.canGoBack() ? router.back() : router.replace('/' as never))} />
    <View style={[s.root, { paddingTop: SP.md, paddingBottom: insets.bottom + SP.md }]}>
      <View style={s.body}>
        <View style={s.icon}><Feather name="briefcase" size={28} color={FG} /></View>
        <Text style={s.title}>{token ? 'You were invited to work on Brandthread' : 'List your factory on Brandthread'}</Text>
        <Text style={s.text}>
          Manufacturers use the Brandthread Manufacturer Portal to set up their profile and photos, chat with sellers, send priced sample and bulk cards, update production and get paid through Stripe.
          {token ? ' Your invite is private: only the seller who invited you will see your profile.' : ' Your listing goes live in the directory as soon as you finish.'}
        </Text>
        <View style={s.card}>
          {['Free for manufacturers', 'Works in any browser, on phone or computer', 'Paid out to your bank in your currency'].map((line) => (
            <View key={line} style={s.row}><Feather name="check" size={14} color={FG} /><Text style={s.rowText}>{line}</Text></View>
          ))}
        </View>
      </View>
      <PrimaryButton label={token ? 'Accept invite in the portal' : 'Open the manufacturer portal'} icon="external-link" onPress={() => void Linking.openURL(url)} />
      <Text style={s.url} selectable>{url}</Text>
    </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  root: { flex: 1, paddingHorizontal: SP.lg, gap: SP.md },
  body: { flex: 1, justifyContent: 'center', gap: SP.md },
  icon: { width: 60, height: 60, borderRadius: 30, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  text: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, lineHeight: 22 },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  url: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center' },
});
