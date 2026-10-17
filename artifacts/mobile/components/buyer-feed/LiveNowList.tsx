/**
 * Buyer Threads Home — the LIVE tab's body (header: LIVE · Following ·
 * Threads). A two-column grid of who is live right now, straight from the
 * shared live provider (lib/live/liveProvider.ts): the real /api/live
 * backend, or the local preview provider in dev web preview, which only has
 * streams with `&demo=1`. Tapping a card opens that stream in the existing
 * LIVE pager (app/live.tsx) via useOpenLive.
 *
 * Nobody live (or the list failed to load) is one quiet line, never sample
 * cards. Refreshes while the tab is showing so new streams appear and ended
 * ones drop off.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { LiveHostAvatar } from '@/components/live/LiveOverlays';
import { getLiveStreamProvider } from '@/lib/live/liveProvider';
import { formatViewerCount } from '@/lib/live/liveOrdering';
import { useOpenLive } from '@/lib/live/useLiveDirectory';
import type { LiveStream } from '@/lib/live/types';
import { useHomeFeedTab } from './HomeFeedTabs';
import { hapticLight } from '@/lib/haptics';
import { FONT, FS, ON_DARK, ON_DARK_MUTED } from '@/lib/theme';
import { radius } from '@/constants/radii';

const REFRESH_MS = 20_000;
const GUTTER = 12;
const GAP = 8;

// Last list seen this session, so re-opening the tab paints at once instead
// of a blank frame while the refresh is in flight.
let lastStreams: LiveStream[] | null = null;

function posterOf(stream: LiveStream) {
  const v = stream.video;
  if (v.kind === 'video' && v.posterSource) return v.posterSource;
  return v.posterUri ? { uri: v.posterUri } : null;
}

/** Renders only while the header's LIVE tab is selected (read straight from
 * HomeFeedTabs, so it appears/disappears in the tap's own frame). */
export function LiveNowList(props: {
  /** Screen is focused — refresh only then. */
  active: boolean;
  topInset: number;
  bottomInset: number;
  pageWidth: number;
}) {
  return useHomeFeedTab() === 'live' ? <LiveNowGrid {...props} /> : null;
}

function LiveNowGrid({
  active, topInset, bottomInset, pageWidth,
}: {
  active: boolean;
  /** Clears the floating header row. */
  topInset: number;
  /** Clears the floating tab bar. */
  bottomInset: number;
  pageWidth: number;
}) {
  const openLive = useOpenLive();
  const [streams, setStreams] = useState<LiveStream[] | null>(lastStreams);

  const load = useCallback(async () => {
    try {
      const next = await getLiveStreamProvider().listLive();
      lastStreams = next;
      setStreams(next);
    } catch {
      setStreams(prev => prev ?? []);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    void load();
    const t = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [active, load]);

  const cardWidth = Math.floor((pageWidth - GUTTER * 2 - GAP) / 2);

  if (streams && streams.length === 0) {
    return (
      <View style={[styles.root, styles.empty, { paddingTop: topInset, paddingBottom: bottomInset }]} testID="buyer-home-live-empty">
        <Text style={styles.emptyText}>No one&apos;s live right now</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.root}
      data={streams ?? []}
      keyExtractor={s => s.id}
      numColumns={2}
      columnWrapperStyle={{ gap: GAP }}
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset, paddingHorizontal: GUTTER, gap: GAP }}
      showsVerticalScrollIndicator={false}
      testID="buyer-home-live-list"
      renderItem={({ item }) => {
        const poster = posterOf(item);
        return (
          <Pressable
            onPress={() => { hapticLight(); openLive({ streamId: item.id, hostId: item.host.id }); }}
            style={[styles.card, { width: cardWidth, height: Math.round(cardWidth * 4 / 3) }]}
            accessibilityRole="button"
            accessibilityLabel={`${item.host.name} is live: ${item.title}. ${formatViewerCount(item.viewerCount)} watching`}
            testID={`buyer-home-live-card-${item.id}`}
          >
            {poster ? <CachedImage source={poster} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
            <View style={styles.cardShade} pointerEvents="none" />
            <View style={styles.badgeRow} pointerEvents="none">
              <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE</Text></View>
              <Text style={styles.viewers}>{formatViewerCount(item.viewerCount)}</Text>
            </View>
            <View style={styles.cardFooter} pointerEvents="none">
              <LiveHostAvatar host={item.host} size={22} />
              <View style={styles.cardText}>
                <Text style={styles.hostName} numberOfLines={1}>{item.host.name}</Text>
                <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              </View>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: '#000' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: ON_DARK_MUTED, fontFamily: FONT.medium, fontSize: FS.base },
  card: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#1A1A1A' },
  cardShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.18)' },
  badgeRow: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveBadge: { backgroundColor: ON_DARK, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  liveBadgeText: { color: '#000', fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 0.4 },
  viewers: {
    color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.meta,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  cardFooter: { position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardText: { flex: 1, minWidth: 0 },
  hostName: {
    color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.sm,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  title: {
    color: ON_DARK_MUTED, fontFamily: FONT.regular, fontSize: FS.meta,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
});
