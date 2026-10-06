/**
 * Renders nothing unless the brand has a live giveaway. Slotted into the
 * profile's action area; tapping opens the giveaway entry page.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { PressableScale } from '@/components/BrandthreadUI';
import { FONT, FS } from '@/lib/theme';
import { timeLeft } from '@/lib/sellerEngagement';

export function GiveawayProfileCard({ sellerId, enabled = true }: { sellerId: string; enabled?: boolean }) {
  const api = useApi();
  const router = useRouter();
  const c = useColors();
  const [g, setG] = useState<any>(null);

  useEffect(() => {
    if (!enabled || !sellerId || sellerId.startsWith('u_')) return;
    let cancelled = false;
    // Optional-chained so screens rendered under a partial api mock (tests) never crash on an extra read.
    api.giveaways?.liveForSeller(sellerId).then((r) => { if (!cancelled) setG(r.giveaway); }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, sellerId, enabled]);

  if (!g) return null;
  return (
    <PressableScale onPress={() => router.push(`/giveaway?code=${encodeURIComponent(g.shareCode)}` as never)} accessibilityRole="button" accessibilityLabel={`Giveaway: ${g.title}`}>
      <View style={[styles.card, { borderColor: c.border, backgroundColor: c.card }]}>
        <Feather name="gift" size={20} color={c.foreground} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.foreground }]}>{g.title}</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>{g.prizeText} · {timeLeft(g.endsAt)}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={c.mutedForeground} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 8 },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold },
  sub: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
});
