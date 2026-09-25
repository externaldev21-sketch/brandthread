/**
 * App Lock settings. Turning it on (or off) requires a successful Face ID /
 * Touch ID / fingerprint or device-passcode check. The lock itself is
 * enforced by AppLockGate on launch and on return from the background.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Linking, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { HapticSwitch, PressableScale } from '@/components/BrandthreadUI';
import { Header } from '@/components/layout';
import {
  GRACE_OPTIONS, authenticateForAppLock, getDeviceSecurity, loadAppLockSettings, saveAppLockSettings,
  type AppLockSettings, type DeviceSecurity, type GraceSeconds,
} from '@/lib/appLock';

export default function AppLockSettingsScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const [device, setDevice] = useState<DeviceSecurity | null>(null);
  const [settings, setSettings] = useState<AppLockSettings>({ enabled: false, graceSeconds: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextDevice, nextSettings] = await Promise.all([getDeviceSecurity(), loadAppLockSettings()]);
    setDevice(nextDevice);
    setSettings(nextSettings);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const label = device?.label ?? 'Face ID';
  const available = !!device?.supported && !!device?.hasDeviceSecurity;

  async function toggle(nextEnabled: boolean) {
    if (!available || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await authenticateForAppLock({
      reason: nextEnabled ? `Turn on App Lock with ${label}` : 'Turn off App Lock',
    });
    if (!result.success) {
      setBusy(false);
      if (!result.cancelled) setMessage('We couldn’t verify it’s you, so nothing changed.');
      return;
    }
    const next = { ...settings, enabled: nextEnabled };
    await saveAppLockSettings(next);
    setSettings(next);
    setBusy(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function chooseGrace(graceSeconds: GraceSeconds) {
    Haptics.selectionAsync();
    const next = { ...settings, graceSeconds };
    setSettings(next);
    await saveAppLockSettings(next);
  }

  return (
    <View style={s.root}>
      <Header title="App Lock" />

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.text} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl }}>
          <View style={s.hero}>
            <View style={s.heroIcon}>
              <Feather name={label === 'Passcode' ? 'hash' : 'lock'} size={24} color={theme.text} />
            </View>
            <Text style={s.heroTitle}>Lock Brandthread with {label}</Text>
            <Text style={s.heroBody}>
              Keep your orders, messages and payouts private. When App Lock is on, Brandthread asks for {label} every time it opens.
              {label !== 'Passcode' ? ' Your device passcode always works as a backup.' : ''}
            </Text>
          </View>

          {!device?.supported ? (
            <View style={s.notice}>
              <Feather name="smartphone" size={16} color={theme.text} />
              <Text style={s.noticeText}>App Lock is available in the Brandthread iOS and Android apps.</Text>
            </View>
          ) : !device.hasDeviceSecurity ? (
            <View style={s.notice}>
              <Feather name="alert-triangle" size={16} color={theme.warning} />
              <View style={{ flex: 1 }}>
                <Text style={s.noticeText}>
                  Set up a device passcode{Platform.OS === 'ios' ? ', Face ID or Touch ID' : ' or fingerprint'} first, then come back to turn on App Lock.
                </Text>
                <PressableScale onPress={() => Linking.openSettings()} accessibilityRole="button" style={{ marginTop: 8 }}>
                  <Text style={s.link}>Open Settings</Text>
                </PressableScale>
              </View>
            </View>
          ) : null}

          <View style={[s.card, !available && { opacity: 0.5 }]}>
            <View style={s.row}>
              <View style={{ flex: 1, paddingRight: SP.md }}>
                <Text style={s.rowTitle}>Require {label}</Text>
                <Text style={s.rowSub}>{settings.enabled ? 'On — required to open the app' : 'Off'}</Text>
              </View>
              {busy ? <ActivityIndicator color={theme.text} /> : (
                <HapticSwitch
                  value={settings.enabled}
                  onValueChange={toggle}
                  disabled={!available}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor={settings.enabled ? theme.onAccent : theme.text}
                  {...({ activeThumbColor: theme.onAccent } as object)}
                  accessibilityLabel={`Require ${label}`}
                />
              )}
            </View>
          </View>

          {message ? (
            <View style={[s.notice, { borderColor: theme.error + '55' }]}>
              <Feather name="alert-circle" size={16} color={theme.error} />
              <Text style={s.noticeText}>{message}</Text>
            </View>
          ) : null}

          {settings.enabled ? (
            <>
              <Text style={s.sectionLabel}>REQUIRE AFTER LEAVING THE APP</Text>
              <View style={s.card}>
                {GRACE_OPTIONS.map((option, index) => {
                  const selected = settings.graceSeconds === option.seconds;
                  return (
                    <PressableScale
                      key={option.seconds}
                      onPress={() => chooseGrace(option.seconds)}
                      style={[s.row, index > 0 && s.rowDivider]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[s.rowTitle, { flex: 1 }]}>{option.label}</Text>
                      <View style={[s.radio, selected && s.radioOn]}>
                        {selected ? <View style={s.radioDot} /> : null}
                      </View>
                    </PressableScale>
                  );
                })}
              </View>
              <Text style={s.footnote}>
                Brandthread always locks when it’s opened fresh. Apps in the background for less than the time you choose open without asking.
              </Text>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', paddingVertical: SP.lg },
  heroIcon: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, marginBottom: SP.md,
  },
  heroTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.xl, letterSpacing: -0.4, textAlign: 'center' },
  heroBody: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, textAlign: 'center', marginTop: SP.sm, maxWidth: 340 },
  notice: {
    flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', padding: SP.md, marginBottom: SP.md,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  noticeText: { flex: 1, color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
  link: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
  card: { backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, minHeight: 60 },
  rowDivider: { borderTopWidth: 1, borderTopColor: theme.borderSubtle },
  rowTitle: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  rowSub: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs + 1, marginTop: 2 },
  sectionLabel: { color: theme.subtle, fontFamily: FONT.semibold, fontSize: 11, letterSpacing: 1, marginTop: SP.lg, marginBottom: SP.sm },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.muted, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: theme.text },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.text },
  footnote: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 17, marginTop: SP.sm },
});
