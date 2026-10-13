/**
 * Internal-only dev menu: build/device details and live feature flags, plus
 * "Copy diagnostics" for bug reports. Reached by tapping About → App version
 * 7 times; only development builds and server-confirmed moderators get in
 * (see lib/internalDevMenu.ts). Anyone else who deep-links here is sent back.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import * as Clipboard from 'expo-clipboard';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { SP } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionHeader } from '@/components/BrandthreadUI';
import { Card, ListRow } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useFeatureFlags } from '@/contexts/FeatureFlagContext';
import { collectAppDiagnostics, formatAppVersion } from '@/lib/appDiagnostics';
import { canOpenInternalDevMenu } from '@/lib/internalDevMenu';

export default function InternalDevMenuScreen() {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const { flags, refresh } = useFeatureFlags();
  const [allowed, setAllowed] = useState(__DEV__);
  const [copied, setCopied] = useState(false);
  const diagnostics = useMemo(() => collectAppDiagnostics(), []);

  useEffect(() => {
    if (__DEV__) return;
    let active = true;
    void canOpenInternalDevMenu({
      isDev: false,
      isSignedIn: Boolean(isSignedIn),
      checkModerator: () => api.moderation.me(),
    }).then((ok) => {
      if (!active) return;
      if (ok) setAllowed(true);
      else goBackOr(router, '/');
    });
    return () => { active = false; };
  }, [api, isSignedIn, router]);

  if (!allowed) return <View style={s.page} />;

  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || 'Same origin';
  const buildRows: { label: string; value?: string }[] = [
    { label: 'Version', value: formatAppVersion(diagnostics) },
    { label: 'Platform', value: [diagnostics.platform, diagnostics.osVersion].filter(Boolean).join(' ') },
    { label: 'Device', value: diagnostics.deviceModel },
    { label: 'Update channel', value: diagnostics.updateChannel },
    { label: 'Update ID', value: diagnostics.updateId },
    { label: 'Locale', value: diagnostics.locale },
    { label: 'API', value: apiBase },
  ];
  const flagRows = Object.keys(flags).sort();

  async function copyDiagnostics() {
    const text = JSON.stringify({ ...diagnostics, apiBase, flags }, null, 2);
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <View style={s.page}>
      <ScreenHeader title="Developer" variant="push" onBack={() => goBackOr(router, '/')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: insets.bottom + 48 }}>
        <View style={s.group}>
          <SectionHeader title="BUILD" />
          <Card style={s.card}>
            {buildRows.map((row, i) => (
              <React.Fragment key={row.label}>
                <ListRow title={row.label} value={row.value || '—'} />
                {i < buildRows.length - 1 && <View style={s.divider} />}
              </React.Fragment>
            ))}
          </Card>
        </View>

        <View style={s.group}>
          <SectionHeader title="FEATURE FLAGS" />
          <Card style={s.card}>
            {flagRows.map((key, i) => (
              <React.Fragment key={key}>
                <ListRow title={key} value={flags[key] ? 'On' : 'Off'} />
                {i < flagRows.length - 1 && <View style={s.divider} />}
              </React.Fragment>
            ))}
          </Card>
        </View>

        <Card style={s.card}>
          <ListRow icon="copy" title={copied ? 'Copied' : 'Copy diagnostics'} onPress={copyDiagnostics} />
          <View style={s.divider} />
          <ListRow icon="refresh-cw" title="Refresh feature flags" onPress={() => { void refresh(); }} />
        </Card>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    group: { marginBottom: SP.lg },
    card: { padding: 0, paddingHorizontal: SP.md },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  });
}
