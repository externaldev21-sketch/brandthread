/**
 * Settings → Notifications → Email & in-app. Per-type switches for the two
 * channels that sit beside push (whose switches stay on the existing
 * notification settings screens).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApi } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListRow } from '@/components/ui/ListRow';
import { QuietHoursRow, type QuietHoursPreset } from '@/components/notifications/QuietHoursRow';
import { quietHoursBody } from '@/lib/deviceTimeZone';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { BrandedLoadingState } from '@/components/BrandthreadUI';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { BUYER_NOTIFICATION_TYPES, SELLER_NOTIFICATION_TYPES } from '@/lib/notificationTypes';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';

type Channel = 'inApp' | 'email';
type ChannelState = Record<Channel, Record<string, boolean>>;

const SECTIONS: { channel: Channel; title: string }[] = [
  { channel: 'inApp', title: 'In-app' },
  { channel: 'email', title: 'Email' },
];

export default function NotificationChannelsScreen() {
  const router = useRouter();
  const api = useApi();
  const colors = useColors();
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [quietHours, setQuietHours] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [channels, setChannels] = useState<ChannelState>({ inApp: {}, email: {} });

  const insets = useSafeAreaInsets();
  // Until the saved preferences arrive the switches would show defaults as if
  // they were the person's choices, so the list waits for a real answer.
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');

  const load = useCallback(() => {
    setLoadState('loading');
    api.notificationPrefs.get()
      .then((data) => {
        setRole(data.role);
        setQuietHours({ start: data.quietHours?.start ?? null, end: data.quietHours?.end ?? null });
        setChannels({ inApp: data.channels?.inApp ?? {}, email: data.channels?.email ?? {} });
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const change = useCallback(async (channel: Channel, key: string, value: boolean) => {
    const prior = channels;
    setChannels({ ...channels, [channel]: { ...channels[channel], [key]: value } });
    try {
      const result = await api.notificationPrefs.update({ channels: { [channel]: { [key]: value } } });
      setChannels({ inApp: result.channels.inApp, email: result.channels.email });
    } catch {
      setChannels(prior);
      Alert.alert('Couldn’t update notifications', 'Check your connection and try again.');
    }
  }, [api, channels]);

  const changeQuietHours = useCallback(async (preset: QuietHoursPreset) => {
    const prior = quietHours;
    setQuietHours({ start: preset.start, end: preset.end });
    try {
      await api.notificationPrefs.update({
        quietHours: quietHoursBody(preset.start, preset.end),
      });
    } catch {
      setQuietHours(prior);
      Alert.alert('Couldn’t update quiet hours', 'Check your connection and try again.');
    }
  }, [api, quietHours]);

  const rows = role === 'seller' ? SELLER_NOTIFICATION_TYPES : BUYER_NOTIFICATION_TYPES;

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Email & in-app" divider={false} onBack={() => goBackOr(router, '/notifications-settings')} />
      {loadState === 'loading' ? <BrandedLoadingState /> : loadState === 'error' ? (
        <ErrorState message="Couldn’t load your notification settings." onRetry={load} />
      ) : (
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.huge }} showsVerticalScrollIndicator={false}>
        {SECTIONS.map(({ channel, title }) => (
          <View key={channel} style={s.section}>
            <Text style={[TYPE_SCALE.footnote, s.sectionTitle, { color: colors.foreground }]}>{title}</Text>
            <Card style={s.listCard}>
              {rows.map((row, i) => (
                <React.Fragment key={row.key}>
                  <ListRow
                    title={row.label}
                    subtitle={row.description}
                    subtitleNumberOfLines={2}
                    toggle={{
                      value: channels[channel][row.key] ?? channel === 'inApp',
                      onChange: (value) => change(channel, row.key, value),
                    }}
                  />
                  {i !== rows.length - 1 && <View style={[s.rowDivider, { backgroundColor: colors.border }]} />}
                </React.Fragment>
              ))}
            </Card>
          </View>
        ))}
        <View style={s.section}>
          <QuietHoursRow start={quietHours.start} end={quietHours.end} onChange={changeQuietHours} />
        </View>
      </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1 },
  section:      { paddingHorizontal: SPACING.md, paddingVertical: SPACING.md },
  sectionTitle: { fontFamily: FONT.semibold, marginBottom: SPACING.sm },
  listCard:     { padding: SPACING.sm },
  rowDivider:   { height: StyleSheet.hairlineWidth },
});
