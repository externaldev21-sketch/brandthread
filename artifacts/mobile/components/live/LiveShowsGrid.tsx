/**
 * What the LIVE tab shows: every show that is live right now as a two-up
 * grid, 1:1 with Whatnot's home feed
 * (https://mobbin.com/flows/ed55f754-472f-46f8-914b-ce7cb7345c7b): the
 * host's avatar and name above each card, the cover with a "Live · N"
 * badge in its top-left corner, the show title in bold under it and one
 * muted line. Tapping a card joins that show (app/live.tsx, opened at it).
 *
 * Real data only — `listLive()` of the live provider. Without an Agora key
 * on the server (GET /api/live/status → LIVE_NOT_CONFIGURED) the grid is
 * replaced by "LIVE isn't available yet"; never placeholder shows.
 *
 * Exported for the feed header's LIVE tab to mount in place of the feed,
 * and also served full-screen at /live-feed.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { ThemedRefreshControl } from '@/components/ui/ThemedRefreshControl';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, MEDIA, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { hapticLight } from '@/lib/haptics';
import { formatUpcomingTime, formatViewerCount } from '@/lib/live/liveOrdering';
import { getLiveStreamProvider } from '@/lib/live/liveProvider';
import { useLiveAvailability } from '@/lib/live/useLiveAvailability';
import { LIVE_NOT_CONFIGURED_BUYER_BODY, LIVE_NOT_CONFIGURED_TITLE } from '@/lib/live/liveAvailability';
import type { LiveStream, UpcomingLive } from '@/lib/live/types';
import { LiveHostAvatar } from './LiveOverlays';
import { LiveNotice } from './LiveNotice';
import { LIVE_RED } from './LiveAvatarRing';

const H_PAD = 12;
const GAP = 10;
const REFRESH_MS = 20_000;

function coverOf(stream: LiveStream) {
  const v = stream.video;
  if (v.kind === 'video') return v.posterSource ?? (v.posterUri ? { uri: v.posterUri } : null);
  return v.posterUri ? { uri: v.posterUri } : null;
}

function ShowCard({ stream, width, onPress }: { stream: LiveStream; width: number; onPress: () => void }) {
  const { theme } = useAppTheme();
  const cover = coverOf(stream);
  const items = stream.products.length;
  return (
    <Pressable
      onPress={onPress}
      style={{ width }}
      accessibilityRole="button"
      accessibilityLabel={`${stream.host.name} is live: ${stream.title}. ${formatViewerCount(stream.viewerCount)} watching`}
      testID={`live-show-${stream.id}`}
    >
      <View style={styles.hostRow}>
        <LiveHostAvatar host={stream.host} size={20} />
        <Text style={[styles.hostName, { color: theme.text }]} numberOfLines={1}>{stream.host.handle.replace(/^@/, '') || stream.host.name}</Text>
      </View>
      <View style={[styles.cover, { height: Math.round(width * 1.38), backgroundColor: theme.cardElevated }]}>
        {cover ? (
          <CachedImage source={cover as never} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.coverFallback]}>
            <LiveHostAvatar host={stream.host} size={56} />
          </View>
        )}
        <View style={styles.badge}>
          <Text style={[styles.badgeText, TABULAR_NUMS]}>Live · {formatViewerCount(stream.viewerCount)}</Text>
        </View>
      </View>
      <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>{stream.title}</Text>
      <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>
        {items > 0 ? `${items} ${items === 1 ? 'item' : 'items'} · ${stream.host.name}` : stream.host.name}
      </Text>
    </Pressable>
  );
}

function UpcomingRow({ item, onRemind }: { item: UpcomingLive; onRemind: (on: boolean) => void }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.upRow, { borderColor: theme.borderSubtle }]} testID={`live-upcoming-${item.id}`}>
      <LiveHostAvatar host={item.host} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.upTitle, { color: theme.text }]} numberOfLines={1}>{item.title}</Text>
        <Text style={[styles.meta, { color: theme.muted, marginTop: 2 }]} numberOfLines={1}>
          {item.host.name} · {formatUpcomingTime(item.startsAt, Date.now())}
        </Text>
      </View>
      <Pressable
        onPress={() => { hapticLight(); onRemind(!item.reminderSet); }}
        style={[styles.remind, item.reminderSet ? { borderColor: theme.border, borderWidth: 1 } : { backgroundColor: theme.text }]}
        accessibilityRole="button"
        accessibilityState={{ selected: item.reminderSet }}
        accessibilityLabel={item.reminderSet ? `Reminder set for ${item.title}` : `Remind me about ${item.title}`}
      >
        <Text style={[styles.remindText, { color: item.reminderSet ? theme.text : theme.background }]}>
          {item.reminderSet ? 'Reminder set' : 'Remind me'}
        </Text>
      </Pressable>
    </View>
  );
}

export function LiveShowsGrid({
  onOpenShow, topInset = 0, bottomInset = 0,
}: {
  onOpenShow: (stream: LiveStream) => void;
  /** Space the parent's header/tab bar covers. */
  topInset?: number;
  bottomInset?: number;
}) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const availability = useLiveAvailability();
  const provider = useMemo(() => getLiveStreamProvider(), []);
  const [streams, setStreams] = useState<LiveStream[] | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingLive[]>([]);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [live, next] = await Promise.all([provider.listLive(), provider.listUpcoming().catch(() => [])]);
      setStreams(live);
      setUpcoming(next);
      setError(false);
    } catch {
      setError(true);
      setStreams(prev => prev ?? []);
    }
  }, [provider]);

  const enabled = availability === 'available' || availability === 'unknown';
  useEffect(() => {
    if (!enabled) return undefined;
    void load();
    const t = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const remind = useCallback(async (id: string, on: boolean) => {
    setUpcoming(prev => prev.map(u => (u.id === id ? { ...u, reminderSet: on } : u)));
    try { await provider.setReminder(id, on); } catch {
      setUpcoming(prev => prev.map(u => (u.id === id ? { ...u, reminderSet: !on } : u)));
    }
  }, [provider]);

  const cardWidth = Math.floor((width - H_PAD * 2 - GAP) / 2);
  const containerPad = { paddingTop: topInset + SP.sm, paddingBottom: bottomInset + SP.lg };

  if (availability === 'unavailable') {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }, containerPad]} testID="live-grid-unavailable">
        <LiveNotice title={LIVE_NOT_CONFIGURED_TITLE} body={LIVE_NOT_CONFIGURED_BUYER_BODY} />
      </View>
    );
  }
  if (availability === 'loading' || streams === null) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }, containerPad]} testID="live-grid-loading">
        <ActivityIndicator color={theme.muted} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.background }}
      data={streams}
      keyExtractor={s => s.id}
      numColumns={2}
      columnWrapperStyle={{ gap: GAP, paddingHorizontal: H_PAD }}
      contentContainerStyle={[{ gap: SP.md + 2, flexGrow: 1 }, containerPad]}
      testID="live-grid"
      refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      renderItem={({ item }) => (
        <ShowCard stream={item} width={cardWidth} onPress={() => { hapticLight(); onOpenShow(item); }} />
      )}
      ListEmptyComponent={(
        <View style={styles.emptyWrap} testID="live-grid-empty">
          <LiveNotice
            title={error ? "Couldn't load live shows" : "No one's live right now"}
            body={error ? 'Check your connection and try again.' : 'Shows from brands you follow appear here the moment they go live.'}
            actionLabel={error ? 'Try again' : undefined}
            onAction={error ? () => { void load(); } : undefined}
          />
          {upcoming.length > 0 && (
            <View style={styles.upList}>
              <Text style={[styles.upHeader, { color: theme.text }]}>Upcoming</Text>
              {upcoming.map(u => <UpcomingRow key={u.id} item={u} onRemind={on => { void remind(u.id, on); }} />)}
            </View>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, paddingTop: 120 },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  hostName: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.sm },
  cover: { borderRadius: 8, overflow: 'hidden' },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: 8, left: 8, backgroundColor: LIVE_RED,
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3,
  },
  badgeText: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: FS.meta },
  title: { fontFamily: FONT.bold, fontSize: FS.sm, lineHeight: 17, marginTop: 6 },
  meta: { fontFamily: FONT.regular, fontSize: FS.meta, marginTop: 1 },
  upList: { marginTop: SP.xl, paddingHorizontal: H_PAD + 4 },
  upHeader: { fontFamily: FONT.bold, fontSize: FS.base, marginBottom: SP.xs },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4, paddingVertical: SP.sm + 4, borderBottomWidth: StyleSheet.hairlineWidth },
  upTitle: { fontFamily: FONT.semibold, fontSize: FS.sm },
  remind: { height: 32, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  remindText: { fontFamily: FONT.semibold, fontSize: FS.meta },
});
