import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { loadBuyerSettings, patchBuyerSettings } from '@/lib/buyerSettings';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionHeader } from '@/components/BrandthreadUI';
import { Card, ListRow } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';

export default function BuyerSecurity() {
  const colors = useColors();
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loginAlerts, setLoginAlerts] = useState(true);
  const [saveLogin, setSaveLogin] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadBuyerSettings().then(loadedSettings => {
      setLoginAlerts(loadedSettings.loginAlerts);
      setSaveLogin(loadedSettings.saveLoginInfo);
      setLoaded(true);
    });
  }, []);

  async function onToggleLoginAlerts(v: boolean) {
    setLoginAlerts(v);
    await patchBuyerSettings({ loginAlerts: v });
  }

  async function onToggleSaveLogin(v: boolean) {
    setSaveLogin(v);
    await patchBuyerSettings({ saveLoginInfo: v });
  }

  if (!loaded) {
    return (
      <View style={s.page}>
        <ScreenHeader title="Password and security" variant="push" onBack={() => goBackOr(router)} />
      </View>
    );
  }

  return (
    <View style={s.page}>
      <ScreenHeader title="Password and security" variant="push" onBack={() => goBackOr(router)} />

      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
        {/* Protection toggles */}
        <SectionHeader title="PROTECTION" />
        <Card style={s.card}>
          {/* 2FA — enrollment happens in Login methods */}
          <ListRow
            icon="shield"
            title="Two-factor authentication"
            subtitle="Add a second step when you sign in."
            chevron
            onPress={() => router.push('/login-methods' as never)}
          />
          <View style={s.divider} />
          <ListRow
            icon="bell"
            title="Login alerts"
            subtitle="Get notified of new sign-ins"
            toggle={{ value: loginAlerts, onChange: onToggleLoginAlerts }}
          />
          <View style={s.divider} />
          <ListRow
            icon="save"
            title="Save login info"
            subtitle="Stay signed in on this device"
            toggle={{ value: saveLogin, onChange: onToggleSaveLogin }}
          />
        </Card>

        {/* Access */}
        <SectionHeader title="ACCESS" style={s.sectionSpacing} />
        <Card style={s.card}>
          <ListRow
            icon="key"
            title="Change password"
            subtitle="Reset via the sign-in screen"
            chevron
            onPress={() => router.push('/forgot-password' as never)}
          />
          <View style={s.divider} />
          <ListRow
            icon="smartphone"
            title="Where you're logged in"
            subtitle="Review active sessions"
            chevron
            onPress={() => router.push('/buyer-login-activity' as never)}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  sectionSpacing: { marginTop: SP.lg },
  card: { padding: 0, paddingHorizontal: SP.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
