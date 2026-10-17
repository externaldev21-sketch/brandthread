/**
 * After the show — X's post-broadcast summary 1:1
 * (https://mobbin.com/screens/00d54bfb-15e5-4790-a97f-59279e0b9449): two big
 * numbers either side of the host's avatar, then plain label / value rows,
 * then Done. Every number is the server's (GET /api/live/:id/summary):
 * peak and total viewers, how long the show ran, comments and how many
 * items were in it. Nothing is estimated; a number the server can't give
 * shows as a dash.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@clerk/expo';
import { CachedImage } from '@/components/CachedImage';
import { useApi } from '@/lib/api';
import { FONT, FS, MEDIA, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { formatShowDuration, type LiveShowSummary } from '@/lib/live/liveAvailability';

export default function SellerLiveSummaryScreen() {
  const { streamId, duration, title } = useLocalSearchParams<{ streamId: string; duration?: string; title?: string }>();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const [summary, setSummary] = useState<LiveShowSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!streamId) { setLoading(false); return undefined; }
    let alive = true;
    (api as any).live.summary(streamId)
      .then((r: { summary: LiveShowSummary }) => { if (alive) setSummary(r.summary); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, streamId]);

  const seconds = summary?.durationSeconds ?? (duration ? Number(duration) : null);
  const n = (v: number | undefined) => (v == null ? '—' : v.toLocaleString());
  const rows: Array<[string, string]> = [
    ['Duration', seconds == null || Number.isNaN(seconds) ? '—' : formatShowDuration(seconds)],
    ['Comments', n(summary?.comments)],
    ['Items in show', n(summary?.productsShown)],
  ];
  const done = () => router.dismissTo('/(tabs)/' as never);
  const showTitle = summary?.title ?? title ?? '';

  return (
    <View style={[styles.root, { paddingTop: topInset + SP.lg, paddingBottom: insets.bottom + SP.sm }]} testID="seller-live-summary">
      <Text style={styles.heading}>Show ended</Text>
      {showTitle ? <Text style={styles.sub} numberOfLines={1}>{showTitle}</Text> : null}

      <View style={styles.bigRow}>
        <View style={styles.bigCol}>
          <Text style={[styles.bigNum, TABULAR_NUMS]} testID="summary-peak">{n(summary?.peakViewers)}</Text>
          <Text style={styles.bigLabel}>PEAK VIEWERS</Text>
        </View>
        <View style={styles.avatar}>
          {user?.imageUrl
            ? <CachedImage source={{ uri: user.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            : <Text style={styles.avatarText}>{(user?.username ?? 'Y').slice(0, 1).toUpperCase()}</Text>}
        </View>
        <View style={styles.bigCol}>
          <Text style={[styles.bigNum, TABULAR_NUMS]} testID="summary-total">{n(summary?.totalViewers)}</Text>
          <Text style={styles.bigLabel}>TOTAL VIEWERS</Text>
        </View>
      </View>

      <View style={styles.rows}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={[styles.rowValue, TABULAR_NUMS]}>{value}</Text>
          </View>
        ))}
        {loading && <ActivityIndicator color={MEDIA.fgMuted} style={{ marginTop: SP.md }} />}
      </View>

      <Pressable onPress={done} style={styles.done} accessibilityRole="button" testID="summary-done">
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MEDIA.backdrop, paddingHorizontal: SP.md },
  heading: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: FS.xl, textAlign: 'center' },
  sub: { color: MEDIA.fgMuted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', marginTop: 4 },
  bigRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.xl },
  bigCol: { flex: 1, alignItems: 'center' },
  bigNum: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: 34 },
  bigLabel: { color: MEDIA.fgMuted, fontFamily: FONT.medium, fontSize: FS.meta, letterSpacing: 0.4, marginTop: 2 },
  avatar: {
    width: 56, height: 56, borderRadius: 28, overflow: 'hidden', backgroundColor: MEDIA.chip,
    alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: MEDIA.hairline,
  },
  avatarText: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: FS.lg },
  rows: { marginTop: SP.xl, flex: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  rowLabel: { color: MEDIA.fg, fontFamily: FONT.semibold, fontSize: FS.base },
  rowValue: { color: MEDIA.fg, fontFamily: FONT.regular, fontSize: FS.base },
  done: { height: 50, borderRadius: 25, backgroundColor: MEDIA.fg, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: MEDIA.onFg, fontFamily: FONT.bold, fontSize: FS.base },
});
