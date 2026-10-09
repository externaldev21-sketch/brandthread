/**
 * Blocking "Update Brandthread" screen, shown only when this native build is
 * older than the server's minimum supported version (GET /api/v1/app/config,
 * env MIN_APP_VERSION_IOS / MIN_APP_VERSION_ANDROID). With nothing configured,
 * on web, in development, or when the endpoint fails, it renders nothing.
 *
 * Checks on launch and again when the app returns to the foreground (the
 * config loader throttles network requests to one per 15 minutes). Works
 * signed out: the endpoint is public. Rendered once at the root, after the
 * other gates so it sits on top of them.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_THEME } from '@/contexts/AppThemeContext';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { FONT, FS, SP } from '@/lib/theme';
import { loadAppConfig } from '@/lib/appConfig';
import { hydrateFeatureFlags, useFeatureFlag } from '@/lib/featureFlags';
import { requiredUpdateUrl } from '@/lib/forceUpdate';
import { addMonitoringBreadcrumb } from '@/lib/monitoring';

// Always black / white / silver, whatever Appearance theme is picked.
const GATE_COLORS = DEFAULT_THEME;

export default function ForceUpdateGate() {
  const insets = useSafeAreaInsets();
  const gateEnabled = useFeatureFlag('force_update_gate');
  const [storeUrl, setStoreUrl] = useState<string | null>(null);

  const check = useCallback(async (force: boolean) => {
    await hydrateFeatureFlags();
    const config = await loadAppConfig({ force });
    const url = requiredUpdateUrl({
      platform: Platform.OS,
      isDev: __DEV__,
      // The `force_update_gate` kill switch is applied at render (useFeatureFlag)
      // so a remote override in this same response takes effect immediately.
      gateEnabled: true,
      currentVersion: Constants.expoConfig?.version,
      config,
      iosAppStoreId: process.env.EXPO_PUBLIC_IOS_APP_STORE_ID,
      androidPackage: Constants.expoConfig?.android?.package,
    });
    setStoreUrl(url);
    if (url) addMonitoringBreadcrumb('updates', 'Force-update gate shown');
  }, []);

  useEffect(() => {
    void check(true);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void check(false);
    });
    return () => subscription.remove();
  }, [check]);

  if (Platform.OS === 'web' || __DEV__ || !gateEnabled || !storeUrl) return null;

  const openStore = () => {
    Linking.openURL(storeUrl).catch(() => {});
  };

  return (
    <Modal visible animationType="fade" transparent={false} statusBarTranslucent onRequestClose={() => {}}>
      <View
        style={[styles.root, { backgroundColor: GATE_COLORS.background, paddingTop: insets.top, paddingBottom: insets.bottom + SP.lg }]}
        testID="force-update-gate"
      >
        <View style={styles.center}>
          <Text style={[styles.title, { color: GATE_COLORS.text }]} accessibilityRole="header">Update Brandthread</Text>
          <Text style={[styles.body, { color: GATE_COLORS.muted }]}>
            This version is no longer supported. Update to keep using Brandthread.
          </Text>
        </View>
        <PrimaryButton label="Update" onPress={openStore} colors={GATE_COLORS.primaryGradient} testID="force-update-open-store" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: SP.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FONT.bold, fontSize: FS.xl, letterSpacing: -0.4, textAlign: 'center' },
  body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, textAlign: 'center', marginTop: SP.sm, maxWidth: 300 },
});
