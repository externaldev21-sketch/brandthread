import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import { SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { loadBuyerSettings, patchBuyerSettings } from '@/lib/buyerSettings';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionHeader } from '@/components/BrandthreadUI';
import { Card, ListRow } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useApi } from '@/lib/api';
import { showAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';

export default function BuyerSecurity() {
  const colors = useColors();
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();
  // Clerk is the source of truth for 2FA; the local twoFactor setting is never read here.
  const twoFactorOn = user?.twoFactorEnabled ?? false;
  const [loginAlerts, setLoginAlerts] = useState(true);
  const [saveLogin, setSaveLogin] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBuyerSettings()
      .then(loadedSettings => {
        if (cancelled) return;
        setLoginAlerts(loadedSettings.loginAlerts);
        setSaveLogin(loadedSettings.saveLoginInfo);
      })
      // A failed local read keeps the defaults rather than a blank screen forever.
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setLoaded(true);
        // The server sends the alerts (lib/security/signInAlerts.ts), so its value wins —
        // fetched after the local read so a slower local read can't overwrite it.
        api.notificationPrefs.get()
          .then((prefs) => { if (!cancelled && typeof prefs.categories?.login_alerts === 'boolean') setLoginAlerts(prefs.categories.login_alerts); })
          .catch(() => {});
      });
    return () => { cancelled = true; };
  }, [api]);

  async function onToggleLoginAlerts(v: boolean) {
    setLoginAlerts(v);
    await patchBuyerSettings({ loginAlerts: v });
    api.notificationPrefs.update({ categories: { login_alerts: v } }).catch((err) => {
      setLoginAlerts(!v);
      void patchBuyerSettings({ loginAlerts: !v });
      showAlert("Couldn’t update login alerts", friendlyError(err, 'Try again.'));
    });
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
            value={twoFactorOn ? 'On' : 'Off'}
            chevron
            onPress={() => router.push('/login-methods' as never)}
          />
          <View style={s.divider} />
          <ListRow
            icon="bell"
            title="Login alerts"
            toggle={{ value: loginAlerts, onChange: onToggleLoginAlerts }}
          />
          <View style={s.divider} />
          <ListRow
            icon="save"
            title="Save login info"
            toggle={{ value: saveLogin, onChange: onToggleSaveLogin }}
          />
        </Card>

        {/* Access */}
        <SectionHeader title="ACCESS" style={s.sectionSpacing} />
        <Card style={s.card}>
          <ListRow
            icon="key"
            title="Change password"
            chevron
            onPress={() => router.push('/change-password' as never)}
          />
          <View style={s.divider} />
          <ListRow
            icon="smartphone"
            title="Login activity"
            chevron
            onPress={() => router.push('/login-activity' as never)}
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
