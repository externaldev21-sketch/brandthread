/** Seller email audience: counts, recent signups, CSV export, remove. Route: /email-audience */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useColors } from '@/hooks/useColors';
import { useApi, type EmailAudienceResponse } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/BrandthreadUI';
import { RetryRow } from '@/components/ui/RetryRow';
import { Hairline, Heading, SolidButton } from '@/components/email/EmailUI';
import { DEMO_AUDIENCE, EMPTY_AUDIENCE, emailMode, formatWhen } from '@/lib/emailMarketing';
import { FONT, FS, ICON } from '@/lib/theme';

export default function EmailAudienceScreen() {
  const c = useColors();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<EmailAudienceResponse | null>(null);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const mode = emailMode();

  const load = useCallback(() => {
    if (mode !== 'live') { setData(mode === 'demo' ? DEMO_AUDIENCE : EMPTY_AUDIENCE); return; }
    api.emailMarketing.audience().then((r) => { setData(r); setError(false); }).catch(() => setError(true));
  }, [api, mode]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const exportCsv = async () => {
    if (mode !== 'live') return;
    setExporting(true);
    try {
      const csv = await api.emailMarketing.exportCsv();
      const file = new File(Paths.cache, `email-subscribers-${Date.now()}.csv`);
      file.write(csv);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export subscribers' });
    } catch {
      Alert.alert('Export failed', "Couldn't export your subscribers. Try again.");
    } finally { setExporting(false); }
  };

  const remove = (id: string, email: string) => {
    Alert.alert('Remove subscriber', `Remove ${email} from your list?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          if (mode !== 'live') { setData((d) => d && { ...d, subscribers: d.subscribers.filter((s) => s.id !== id) }); return; }
          try { await api.emailMarketing.removeSubscriber(id); load(); }
          catch { Alert.alert('Not removed', 'This address may have unsubscribed, which keeps it on the suppression list.'); }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Audience" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 140 }} showsVerticalScrollIndicator={false}>
        {error ? <RetryRow label="Couldn't load your audience" onRetry={load} /> : !data ? (
          <ActivityIndicator color={c.foreground} style={{ marginTop: 32 }} />
        ) : (
          <>
            <Text style={[st.big, { color: c.foreground }]}>{data.counts.subscribers}</Text>
            <Text style={[st.sub, { color: c.mutedForeground }]}>
              {data.counts.subscribers === 1 ? 'subscriber can receive email' : 'subscribers can receive email'}
            </Text>
            <View style={st.segRow}>
              {(['customers', 'followers'] as const).map((k) => (
                <View key={k} style={{ flex: 1 }}>
                  <Text style={[st.segNum, { color: c.foreground }]}>{data.counts[k]}</Text>
                  <Text style={[st.sub, { color: c.mutedForeground }]}>{k === 'customers' ? 'Also ordered' : 'Also follow you'}</Text>
                </View>
              ))}
            </View>
            {(data.byStatus.unsubscribed || data.byStatus.bounced) ? (
              <Text style={[st.sub, { color: c.mutedForeground, marginTop: 12 }]}>
                {data.byStatus.unsubscribed ?? 0} unsubscribed · {data.byStatus.bounced ?? 0} bounced (never emailed again)
              </Text>
            ) : null}

            <Heading>Recent signups</Heading>
            {data.subscribers.length === 0 ? (
              <Text style={[st.sub, { color: c.mutedForeground }]}>
                No signups yet. The email signup on your published store adds people here.
              </Text>
            ) : data.subscribers.map((s, i) => (
              <View key={s.id}>
                {i > 0 && <Hairline />}
                <View style={st.row}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={[st.email, { color: c.foreground }]}>{s.email}</Text>
                    <Text style={[st.sub, { color: c.mutedForeground }]}>
                      {s.status === 'subscribed' ? 'Subscribed' : s.status === 'pending' ? 'Awaiting confirmation' : s.status === 'unsubscribed' ? 'Unsubscribed' : s.status === 'bounced' ? 'Bounced' : 'Marked as spam'} · {formatWhen(s.createdAt)}
                    </Text>
                  </View>
                  {(s.status === 'subscribed' || s.status === 'pending') && (
                    <PressableScale onPress={() => remove(s.id, s.email)} accessibilityRole="button" accessibilityLabel={`Remove ${s.email}`} style={st.iconBtn}>
                      <Feather name="trash-2" size={ICON.sm} color={c.mutedForeground} />
                    </PressableScale>
                  )}
                </View>
              </View>
            ))}
            <View style={{ marginTop: 24 }}>
              <SolidButton label="Export CSV" outline loading={exporting} disabled={mode !== 'live' || data.subscribers.length === 0} onPress={exportCsv} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  big: { fontFamily: FONT.bold, fontSize: 44, marginTop: 8 },
  sub: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18 },
  segRow: { flexDirection: 'row', gap: 16, marginTop: 20 },
  segNum: { fontFamily: FONT.bold, fontSize: FS.xl },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingVertical: 8, gap: 8 },
  email: { fontFamily: FONT.semibold, fontSize: FS.md },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
