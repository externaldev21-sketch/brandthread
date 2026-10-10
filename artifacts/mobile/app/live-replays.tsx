/**
 * Replays — a seller's saved live streams, reached from the "Replays" row in
 * the "..." menu of their profile (only shown when they have at least one).
 *
 * Layout reference: TikTok's profile video grid (3 columns of 9:16 tiles with
 * the duration at the bottom-right), reskinned to the app's monochrome theme.
 * Visitors see public replays only; the owner also sees hidden ones (marked
 * with a lock) and can hide/show or delete each from a per-tile menu.
 * Data comes only from the server (GET /api/live-replays/by-seller/:id).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useScreenPadding } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { Snackbar } from '@/components/ui/Snackbar';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type LiveReplay } from '@/lib/api';
import { formatReplayDuration } from '@/lib/liveReplayFormat';
import { FONT, FS, SP } from '@/lib/theme';
import { haptics } from '@/lib/haptics';

const COLUMNS = 3;
const GAP = 2;

export default function LiveReplaysScreen() {
  const params = useLocalSearchParams<{ sellerId?: string }>();
  const sellerId = typeof params.sellerId === 'string' ? params.sellerId : '';
  const { theme } = useAppTheme();
  const api = useApi();
  const router = useRouter();
  const padding = useScreenPadding({ withTopInset: false });
  const { width } = useWindowDimensions();
  const [replays, setReplays] = useState<LiveReplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!sellerId) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    try {
      const res = await api.liveReplays.bySeller(sellerId);
      setReplays(res.replays);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api, sellerId]);

  useEffect(() => { void load(); }, [load]);

  const tile = (width - GAP * (COLUMNS - 1)) / COLUMNS;
  const styles = useMemo(() => makeStyles(theme, tile), [theme, tile]);

  const setVisibility = useCallback(async (replay: LiveReplay, visibility: 'public' | 'hidden') => {
    try {
      await api.liveReplays.setVisibility(replay.streamId, visibility);
      setReplays(prev => prev.map(r => (r.streamId === replay.streamId ? { ...r, visibility } : r)));
      setNotice(visibility === 'hidden' ? 'Replay hidden from your profile' : 'Replay is public again');
    } catch {
      setNotice('Could not update this replay. Try again.');
    }
  }, [api]);

  const remove = useCallback(async (replay: LiveReplay) => {
    try {
      await api.liveReplays.remove(replay.streamId);
      setReplays(prev => prev.filter(r => r.streamId !== replay.streamId));
      setNotice('Replay deleted');
    } catch {
      setNotice('Could not delete this replay. Try again.');
    }
  }, [api]);

  const openManage = useCallback((replay: LiveReplay) => {
    const hidden = replay.visibility === 'hidden';
    showActionSheet(replay.title, undefined, [
      {
        text: hidden ? 'Show on profile' : 'Hide from profile',
        onPress: () => { void setVisibility(replay, hidden ? 'public' : 'hidden'); },
      },
      {
        text: 'Delete replay',
        style: 'destructive',
        onPress: () => showActionSheet('Delete this replay?', 'It will be removed for everyone. This cannot be undone.', [
          { text: 'Delete replay', style: 'destructive', onPress: () => { void remove(replay); } },
          { text: 'Cancel', style: 'cancel' },
        ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [remove, setVisibility]);

  const openReplay = useCallback((replay: LiveReplay) => {
    router.push(`/live-replay?streamId=${encodeURIComponent(replay.streamId)}` as never);
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="live-replays-screen">
      <ScreenHeader title="Replays" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.muted} /></View>
      ) : error ? (
        <EmptyState
          icon="wifi-off"
          title="Couldn't load replays"
          description="Check your connection and try again."
          action={{ label: 'Try again', onPress: () => { void load(); } }}
        />
      ) : replays.length === 0 ? (
        <EmptyState icon="video" title="No replays yet" description="Saved live streams will show up here." />
      ) : (
        <FlatList
          data={replays}
          keyExtractor={r => r.streamId}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GAP }}
          ItemSeparatorComponent={() => <View style={{ height: SP.sm }} />}
          contentContainerStyle={{ paddingBottom: padding.bottom + SP.lg }}
          renderItem={({ item }) => {
            const duration = formatReplayDuration(item.durationSeconds);
            const hidden = item.visibility === 'hidden';
            return (
              <View style={styles.cell}>
                <Pressable
                  onPress={() => openReplay(item)}
                  onLongPress={item.isOwner ? () => { haptics.rigid(); openManage(item); } : undefined}
                  accessibilityRole="button"
                  accessibilityLabel={`Play replay ${item.title}`}
                  testID={`live-replay-tile-${item.streamId}`}
                  style={styles.thumb}
                >
                  {item.thumbnailUrl ? (
                    <CachedImage source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <View style={styles.thumbFallback}><Feather name="play" size={22} color={theme.muted} /></View>
                  )}
                  {duration ? <Text style={styles.duration}>{duration}</Text> : null}
                  {hidden ? (
                    <View style={styles.lock} accessibilityLabel="Hidden from visitors">
                      <Feather name="lock" size={12} color={theme.text} />
                    </View>
                  ) : null}
                </Pressable>
                {item.isOwner ? (
                  <Pressable
                    onPress={() => openManage(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Manage replay ${item.title}`}
                    testID={`live-replay-manage-${item.streamId}`}
                    style={styles.manage}
                  >
                    <Feather name="more-horizontal" size={16} color={theme.text} />
                  </Pressable>
                ) : null}
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
              </View>
            );
          }}
        />
      )}
      <Snackbar visible={!!notice} message={notice} onDismiss={() => setNotice('')} />
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useAppTheme>['theme'], tile: number) {
  return StyleSheet.create({
    root: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    cell: { width: tile },
    thumb: { width: tile, height: tile * (16 / 9), backgroundColor: theme.cardElevated, overflow: 'hidden' },
    thumbFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    duration: {
      position: 'absolute', right: 6, bottom: 6,
      fontFamily: FONT.semibold, fontSize: FS.xs, color: theme.text,
      backgroundColor: theme.background, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden',
    },
    lock: {
      position: 'absolute', left: 6, top: 6, width: 22, height: 22, borderRadius: 11,
      backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center',
    },
    manage: { position: 'absolute', right: 4, top: 4, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background },
    title: { fontFamily: FONT.medium, fontSize: FS.xs, color: theme.text, marginTop: 4, paddingHorizontal: 4 },
  });
}
