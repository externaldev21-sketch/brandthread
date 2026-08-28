import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE, ON_DARK,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { loadBuyerSettings, patchBuyerSettings } from '@/lib/buyerSettings';

export default function BuyerSecurity() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const s = makeStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loginAlerts, setLoginAlerts] = useState(true);
  const [saveLogin, setSaveLogin] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadBuyerSettings().then(s => {
      setLoginAlerts(s.loginAlerts);
      setSaveLogin(s.saveLoginInfo);
      setLoaded(true);
    });
  }, []);

  async function onToggleLoginAlerts(v: boolean) {
    Haptics.selectionAsync();
    setLoginAlerts(v);
    await patchBuyerSettings({ loginAlerts: v });
  }

  async function onToggleSaveLogin(v: boolean) {
    Haptics.selectionAsync();
    setSaveLogin(v);
    await patchBuyerSettings({ saveLoginInfo: v });
  }

  if (!loaded) return <View style={[s.page, { paddingTop: insets.top }]} />;

  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Password & Security</Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
        {/* Protection toggles */}
        <Text style={s.groupLabel}>Protection</Text>
        <View style={s.card}>
          {/* 2FA — informational only; actual enrollment is managed by Clerk */}
          <View style={s.rowInfo}>
            <View style={s.iconWrap}>
              <Feather name="shield" size={18} color={PURPLE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Two-factor authentication</Text>
              <Text style={s.sub}>Managed by your sign-in provider. Set up in Clerk account settings.</Text>
            </View>
            <Feather name="external-link" size={16} color={SUBTLE} />
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.iconWrap}>
              <Feather name="bell" size={18} color={PURPLE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Login alerts</Text>
              <Text style={s.sub}>Get notified of new sign-ins</Text>
            </View>
            <Switch
              value={loginAlerts}
              onValueChange={onToggleLoginAlerts}
              trackColor={{ false: CARD_ELEVATED, true: PURPLE }}
              thumbColor={ON_DARK}
            />
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.iconWrap}>
              <Feather name="save" size={18} color={PURPLE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Save login info</Text>
              <Text style={s.sub}>Stay signed in on this device</Text>
            </View>
            <Switch
              value={saveLogin}
              onValueChange={onToggleSaveLogin}
              trackColor={{ false: CARD_ELEVATED, true: PURPLE }}
              thumbColor={ON_DARK}
            />
          </View>
        </View>

        {/* Access */}
        <Text style={s.groupLabel}>Access</Text>
        <View style={s.card}>
          <TouchableOpacity
            style={s.row}
            onPress={() => { Haptics.selectionAsync(); router.push('/forgot-password' as never); }}
            activeOpacity={0.7}
          >
            <View style={s.iconWrap}>
              <Feather name="key" size={18} color={PURPLE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Change password</Text>
              <Text style={s.sub}>Reset via the sign-in screen</Text>
            </View>
            <Feather name="chevron-right" size={18} color={SUBTLE} />
          </TouchableOpacity>
          <View style={s.divider} />
          <TouchableOpacity
            style={s.row}
            onPress={() => { Haptics.selectionAsync(); router.push('/buyer-login-activity' as never); }}
            activeOpacity={0.7}
          >
            <View style={s.iconWrap}>
              <Feather name="smartphone" size={18} color={PURPLE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Where you're logged in</Text>
              <Text style={s.sub}>Review active sessions</Text>
            </View>
            <Feather name="chevron-right" size={18} color={SUBTLE} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  groupLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm, marginTop: SP.md },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginBottom: SP.sm },
  row: { minHeight: 60, paddingHorizontal: SP.md, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowInfo: { minHeight: 60, paddingHorizontal: SP.md, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { height: 1, backgroundColor: BORDER, marginLeft: SP.md },
  iconWrap: { width: 28, alignItems: 'center' },
  label: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  sub: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
});
