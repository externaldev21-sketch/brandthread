/** Seller giveaways: list with a New entry. */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { FONT, FS, SP } from '@/lib/theme';
import { formatDay, phaseLabel } from '@/lib/sellerEngagement';

export default function SellerGiveaways() {
  const api = useApi();
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<any[] | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    api.sellerGiveaways.list()
      .then((r) => { if (!cancelled) { setRows(r.giveaways ?? []); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [api]));

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Giveaways" />
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 140 }}>
        <Button label="New giveaway" icon="plus" fullWidth onPress={() => router.push('/seller-giveaway-create' as never)} />
        <View style={{ height: SP.md }} />
        {failed ? <Text style={[styles.note, { color: c.mutedForeground }]}>Couldn't load your giveaways.</Text>
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
              subtitle={`${phaseLabel(g.phase)} · ${g.entryCount} entries · ends ${formatDay(g.endsAt)}`}
              chevron subtitleNumberOfLines={2} onPress={() => router.push(`/seller-giveaway-detail?id=${encodeURIComponent(g.id)}` as never)} />
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FS.lg, fontFamily: FONT.bold },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
});
