import React from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  ON_DARK,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';

type Row = {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  sub: string;
  route?: string;
};

const ROWS: Row[] = [
  { label: 'Personal details', icon: 'user', sub: 'Name, email, phone and birthday', route: '/buyer-personal-details' },
  { label: 'Password and security', icon: 'shield', sub: 'Password, two-factor authentication and login alerts', route: '/buyer-security' },
  { label: 'Login methods', icon: 'link', sub: 'Apple, Google and email', route: '/login-methods' },
  { label: 'Biometric unlock', icon: 'unlock', sub: 'Face ID, Touch ID or device biometrics', route: '/biometric-unlock' },
  { label: "Where you're logged in", icon: 'smartphone', sub: 'Review active sessions', route: '/buyer-login-activity' },
  { label: 'Download your information', icon: 'download', sub: 'Get a copy of your data', route: '/buyer-download-data' },
  { label: 'Ad and recommendation preferences', icon: 'sliders', sub: 'Control personalisation', route: '/buyer-settings-detail?section=content' },
  { label: 'Account ownership and control', icon: 'settings', sub: 'Deactivation, memorialisation and deletion', route: '/buyer-account-control' },
];

export default function BuyerAccountCenter() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Accounts Center</Text>
        <View style={s.back} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
        {/* Hero */}
        <LinearGradient colors={[theme.accentDim, theme.secondaryDim]} style={s.hero}>
          <View style={[s.logo, { backgroundColor: theme.accent }]}>
            <Text style={s.logoText}>B</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>Manage your Brandthread account</Text>
            <Text style={s.heroSub}>Security, personal details, permissions and account ownership live here.</Text>
          </View>
        </LinearGradient>

        {/* Rows */}
        <View style={s.card}>
          {ROWS.map((row, i) => (
            <TouchableOpacity
              key={row.label}
              style={[s.row, i < ROWS.length - 1 && s.divider]}
              activeOpacity={0.7}
              onPress={() => row.route && router.push(row.route as never)}
            >
              <Feather name={row.icon} size={19} color={theme.accent} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{row.label}</Text>
                <Text style={s.sub}>{row.sub}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={SUBTLE} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  hero: { flexDirection: 'row', gap: 14, alignItems: 'center', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 16 },
  logo: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 24 },
  heroTitle: { color: FG, fontFamily: FONT.bold, fontSize: 15 },
  heroSub: { color: MUTED, fontFamily: FONT.regular, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  card: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.lg, overflow: 'hidden' },
  row: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: BORDER },
  label: { color: FG, fontFamily: FONT.medium, fontSize: 14 },
  sub: { color: MUTED, fontFamily: FONT.regular, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
});
