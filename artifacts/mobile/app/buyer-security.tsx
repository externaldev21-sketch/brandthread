import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { loadBuyerSettings, patchBuyerSettings } from '@/lib/buyerSettings';
import { hydrateBuyerSettings, updateBuyerSettings } from '@/lib/buyerSettingsSync';
import { apiErrorMessage } from '@/lib/safety';
import { setSaveLoginInfo } from '@/lib/tokenCache';
import { useApi } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionHeader } from '@/components/BrandthreadUI';
import { Card, ListRow } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';

export default function BuyerSecurity() {
  const colors = useColors();
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const [loginAlerts, setLoginAlerts] = useState(true);
  const [saveLogin, setSaveLogin] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadBuyerSettings().then(local => {
      setLoginAlerts(local.loginAlerts);
      setSaveLogin(local.saveLoginInfo);
      setLoaded(true);
      // The server copy wins for Login alerts (it's what sends the email).
      hydrateBuyerSettings(api).then(remote => setLoginAlerts(remote.loginAlerts)).catch(() => {});
    });
  }, [api]);

  // Login alerts: saved on the server, which emails you when your account
  // signs in on a new device. Rolled back with the real error if it fails.
  async function onToggleLoginAlerts(v: boolean) {
    setLoginAlerts(v);
    try {
      const next = await updateBuyerSettings(api, { loginAlerts: v });
      setLoginAlerts(next.loginAlerts);
    } catch (error) {
      setLoginAlerts(!v);
      Alert.alert('Couldn’t update login alerts', apiErrorMessage(error, 'Check your connection and try again.'));
    }
  }

  // Save login info is about THIS device: off keeps the session in memory
  // only, so closing the app signs you out (lib/tokenCache.ts).
  async function onToggleSaveLogin(v: boolean) {
    setSaveLogin(v);
    try {
      await setSaveLoginInfo(v);
      await patchBuyerSettings({ saveLoginInfo: v });
    } catch {
      setSaveLogin(!v);
      Alert.alert('Couldn’t update this setting', 'Try again.');
    }
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
            subtitle="Email me when my account signs in on a new device"
            toggle={{ value: loginAlerts, onChange: onToggleLoginAlerts }}
          />
          <View style={s.divider} />
          <ListRow
            icon="save"
            title="Save login info"
            subtitle={saveLogin ? 'Stay signed in on this device' : 'You’ll be signed out when you close the app'}
            toggle={{ value: saveLogin, onChange: onToggleSaveLogin }}
          />
        </Card>

        {/* Access */}
        <SectionHeader title="ACCESS" style={s.sectionSpacing} />
        <Card style={s.card}>
          <ListRow
            icon="key"
            title="Change password"
            subtitle="Update your current password"
            chevron
            onPress={() => router.push('/change-password' as never)}
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
