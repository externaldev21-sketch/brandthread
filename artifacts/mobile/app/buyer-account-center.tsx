import React from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { type IconName } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ListRow } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';

type Row = {
  label: string;
  icon: IconName;
  sub?: string;
  route?: string;
  destructive?: boolean;
};

const ROWS: Row[] = [
  { label: 'Personal details', icon: 'user', route: '/buyer-personal-details' },
  { label: 'Password and security', icon: 'shield', route: '/buyer-security' },
  { label: 'Login methods', icon: 'link', route: '/login-methods' },
  { label: 'App Lock', icon: 'unlock', route: '/biometric-unlock' },
  { label: 'Login activity', icon: 'smartphone', route: '/login-activity' },
  { label: 'Download your information', icon: 'download', route: '/buyer-download-data' },
  // Shopping preferences holds the real (server-backed) personalized recommendations switch.
  { label: 'Recommendation preferences', icon: 'sliders', sub: 'Personalization, sizes, and style', route: '/shopping-preferences' },
  { label: 'Account status', icon: 'activity', route: '/account-status' },
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
      <ScreenHeader title="Accounts Center" variant="push" onBack={() => goBackOr(router)} />

      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
        {/* Hero */}
        <LinearGradient colors={[theme.accentDim, theme.secondaryDim]} style={[s.hero, { borderColor: colors.border }]}>
          <View style={[s.logo, { backgroundColor: theme.accent }]}>
            <Text style={[s.logoText, { color: theme.onAccent }]}>B</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.heroTitle, { color: colors.foreground }]}>Manage your Brandthread account</Text>
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
                subtitleNumberOfLines={2}
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
  hero: { flexDirection: 'row', gap: 14, alignItems: 'center', borderRadius: RADII.card, borderWidth: 1, padding: SP.md, marginBottom: SP.md },
  logo: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: FONT.bold, fontSize: FS.xl },
  heroTitle: { fontFamily: FONT.bold, fontSize: FS.base },
  card: { padding: 0, paddingHorizontal: SP.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
