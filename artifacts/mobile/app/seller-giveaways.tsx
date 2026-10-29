/** Seller giveaways: list with a New entry. */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { RetryRow } from '@/components/ui/RetryRow';
import { FONT, FS, SP } from '@/lib/theme';
import { formatDay, phaseLabel } from '@/lib/sellerEngagement';

export default function SellerGiveaways() {
  const api = useApi();
  const router = useRouter();
  const c = useColors();
  const [rows, setRows] = useState<any[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback((isCancelled: () => boolean = () => false) => {
    api.sellerGiveaways.list()
      .then((r) => { if (!isCancelled()) { setRows(r.giveaways ?? []); setFailed(false); } })
      // The signed-out seller preview has no account to read from: show the
      // fresh-account empty state there instead of a load error.
      .catch((e: any) => { if (isCancelled()) return; if (e?.code === 'dev_preview_offline') { setRows([]); setFailed(false); } else setFailed(true); });
  }, [api]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Giveaways" />
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: SP.xl }}>
        <Button label="New giveaway" icon="plus" fullWidth onPress={() => router.push('/seller-giveaway-create' as never)} />
        <View style={{ height: SP.md }} />
        {failed ? <RetryRow label="Couldn't load your giveaways" onRetry={() => { setFailed(false); setRows(null); load(); }} />
          : rows === null ? <ActivityIndicator color={c.foreground} style={{ marginTop: 40 }} />
          : rows.length === 0 ? (
            <View style={{ alignItems: 'center', gap: 8, marginTop: 40 }}>
              <Text style={[styles.title, { color: c.foreground }]}>No giveaways yet</Text>
              <Text style={[styles.note, { color: c.mutedForeground, textAlign: 'center' }]}>
                Run a giveaway where people follow you and comment on a post. You draw the winners when it ends.
              </Text>
            </View>
          ) : rows.map((g) => (
            <ListRow key={g.id} title={g.title}
              subtitle={`${phaseLabel(g.phase)} · ${g.entryCount === 1 ? '1 entry' : `${g.entryCount} entries`} · ${g.phase === 'live' ? `ends ${formatDay(g.endsAt)}` : g.phase === 'upcoming' ? `starts ${formatDay(g.startsAt)}` : `ended ${formatDay(g.endsAt)}`}`}
              chevron subtitleNumberOfLines={2} onPress={() => router.push(`/seller-giveaway-detail?id=${encodeURIComponent(g.id)}` as never)} />
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FS.lg, fontFamily: FONT.bold },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
});
