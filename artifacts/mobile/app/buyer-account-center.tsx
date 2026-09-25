import React from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { FONT, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ListRow } from '@/components/ui';

type Row = {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  sub: string;
  route?: string;
  destructive?: boolean;
};

const ROWS: Row[] = [
  { label: 'Personal details', icon: 'user', sub: 'Name, email, phone and birthday', route: '/buyer-personal-details' },
  { label: 'Password and security', icon: 'shield', sub: 'Password, two-factor authentication and login alerts', route: '/buyer-security' },
  { label: 'Login methods', icon: 'link', sub: 'Apple, Google and email', route: '/login-methods' },
  { label: 'Biometric unlock', icon: 'unlock', sub: 'Face ID, Touch ID or device biometrics', route: '/biometric-unlock' },
  { label: "Where you're logged in", icon: 'smartphone', sub: 'Review active sessions', route: '/buyer-login-activity' },
  { label: 'Download your information', icon: 'download', sub: 'Get a copy of your data', route: '/buyer-download-data' },
  { label: 'Ad and recommendation preferences', icon: 'sliders', sub: 'Control personalisation', route: '/buyer-settings-detail?section=content' },
  { label: 'Delete account', icon: 'trash-2', sub: 'Permanently delete your account and data', route: '/delete-account', destructive: true },
];

export default function BuyerAccountCenter() {
  const { theme } = useAppTheme();
  const colors = useColors();
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={s.page}>
      <ScreenHeader title="Accounts Center" variant="push" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
        {/* Hero */}
        <LinearGradient colors={[theme.accentDim, theme.secondaryDim]} style={[s.hero, { borderColor: colors.border }]}>
          <View style={[s.logo, { backgroundColor: theme.accent }]}>
            <Text style={[s.logoText, { color: theme.onAccent }]}>B</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.heroTitle, { color: colors.foreground }]}>Manage your Brandthread account</Text>
            <Text style={[s.heroSub, { color: colors.mutedForeground }]}>Security, personal details, permissions and account ownership live here.</Text>
          </View>
        </LinearGradient>

        {/* Rows */}
        <Card style={s.card}>
          {ROWS.map((row, i) => (
            <React.Fragment key={row.label}>
              <ListRow
                icon={row.icon}
                title={row.label}
                subtitle={row.sub}
                destructive={row.destructive}
                chevron
                onPress={() => row.route && router.push(row.route as never)}
              />
              {i < ROWS.length - 1 && <View style={s.divider} />}
            </React.Fragment>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  hero: { flexDirection: 'row', gap: 14, alignItems: 'center', borderRadius: RADII.card, borderWidth: 1, padding: 16, marginBottom: 16 },
  logo: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: FONT.bold, fontSize: 24 },
  heroTitle: { fontFamily: FONT.bold, fontSize: 15 },
  heroSub: { fontFamily: FONT.regular, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  card: { padding: 0, paddingHorizontal: SP.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
