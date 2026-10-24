/** Results for one follower push: recipients, sent, opened. */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { FONT, FS, SP } from '@/lib/theme';
import { formatDay } from '@/lib/sellerEngagement';
import { RetryRow } from '@/components/ui/RetryRow';

export default function SellerPushBroadcastResults() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const c = useColors();
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    // No id means nothing to load: show the failure row instead of spinning.
    if (!id) { setFailed(true); return; }
    setFailed(false);
    api.sellerPush.results(String(id)).then(setData).catch(() => setFailed(true));
  }, [api, id]);
  useEffect(() => { load(); }, [load]);

  const stats = data ? [
    { label: 'Recipients', value: data.recipientCount },
    { label: 'Sent', value: data.sentCount },
    { label: 'Opened', value: data.opened ?? 0 },
    { label: 'Skipped', value: data.skippedCount },
  ] : [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Push results" />
      <ScrollView contentContainerStyle={{ padding: SP.md }}>
        {failed ? <RetryRow label="Couldn't load these results" onRetry={load} />
          : !data ? <ActivityIndicator color={c.foreground} style={{ marginTop: 40 }} /> : (
            <>
              <Text style={[styles.title, { color: c.foreground }]}>{data.title}</Text>
              <Text style={[styles.note, { color: c.mutedForeground }]}>{data.body}</Text>
              <Text style={[styles.meta, { color: c.mutedForeground }]}>Sent {formatDay(data.createdAt)}</Text>
              <View style={[styles.grid, { borderColor: c.border }]}>
                {stats.map((s, i) => (
                  <View key={s.label} style={[styles.cell, i % 2 === 1 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.border }, i > 1 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}>
                    <Text style={[styles.value, { color: c.foreground }]}>{s.value}</Text>
                    <Text style={[styles.label, { color: c.mutedForeground }]}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FS.lg, fontFamily: FONT.bold, marginBottom: 6 },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  meta: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 8, marginBottom: SP.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  cell: { width: '50%', paddingVertical: 20, alignItems: 'center', gap: 4 },
  value: { fontSize: FS.xl, fontFamily: FONT.bold },
  label: { fontSize: FS.xs, fontFamily: FONT.regular },
});
