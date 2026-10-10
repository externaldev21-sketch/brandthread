/**
 * Live replay player — one saved live stream.
 *
 * Reference: Whatnot / TikTok LIVE replay (vertical video with transport
 * controls, title + date underneath), reskinned to the app's theme under the
 * shared ScreenHeader. The owner additionally gets Hide/Show and Delete.
 * Plays only the server-confirmed `replayUrl`; a replay that is hidden,
 * deleted or never finished uploading is a plain "not available" state.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { Snackbar } from '@/components/ui/Snackbar';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type LiveReplay } from '@/lib/api';
import { formatReplayDate, formatReplayDuration } from '@/lib/liveReplayFormat';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, SP } from '@/lib/theme';

function ReplayVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  useEffect(() => {
    player.play();
    return () => { try { player.pause(); } catch { /* player already released */ } };
  }, [player]);
  return <VideoView player={player} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} contentFit="contain" nativeControls />;
}

export default function LiveReplayScreen() {
  const params = useLocalSearchParams<{ streamId?: string }>();
  const streamId = typeof params.streamId === 'string' ? params.streamId : '';
  const { theme } = useAppTheme();
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [replay, setReplay] = useState<LiveReplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'missing' | 'network' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!streamId) { setLoading(false); setError('missing'); return undefined; }
    let cancelled = false;
    setLoading(true);
    api.liveReplays.get(streamId)
      .then(r => { if (!cancelled) setReplay(r.replay); })
      .catch((e: any) => { if (!cancelled) setError(/not found|404/i.test(String(e?.message ?? '')) ? 'missing' : 'network'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, streamId]);

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    stage: { flex: 1, backgroundColor: theme.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    meta: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: insets.bottom + SP.sm, gap: SP.xs },
    title: { fontFamily: FONT.bold, fontSize: FS.md, color: theme.text },
    sub: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted },
    actionCell: { flex: 1 },
    actions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.xs },
  }), [theme, insets.bottom]);

  const toggleVisibility = useCallback(async () => {
    if (!replay || busy) return;
    const next = replay.visibility === 'hidden' ? 'public' : 'hidden';
    setBusy(true);
    try {
      await api.liveReplays.setVisibility(replay.streamId, next);
      setReplay({ ...replay, visibility: next });
      setNotice(next === 'hidden' ? 'Replay hidden from your profile' : 'Replay is public again');
    } catch {
      setNotice('Could not update this replay. Try again.');
    } finally {
      setBusy(false);
    }
  }, [api, busy, replay]);

  const confirmDelete = useCallback(() => {
    if (!replay) return;
    showActionSheet('Delete this replay?', 'It will be removed for everyone. This cannot be undone.', [
      {
        text: 'Delete replay',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          api.liveReplays.remove(replay.streamId)
            .then(() => goBackOr(router))
            .catch(() => { setNotice('Could not delete this replay. Try again.'); setBusy(false); });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [api, replay, router]);

  const duration = formatReplayDuration(replay?.durationSeconds);
  const date = formatReplayDate(replay?.endedAt ?? replay?.startedAt);
  const hidden = replay?.visibility === 'hidden';

  return (
    <View style={styles.root} testID="live-replay-screen">
      <ScreenHeader title="Replay" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.muted} /></View>
      ) : !replay ? (
        <EmptyState
          icon="video-off"
          title={error === 'network' ? "Couldn't load this replay" : 'Replay not available'}
          description={error === 'network' ? 'Check your connection and try again.' : 'It may have been removed by the host.'}
        />
      ) : (
        <>
          <View style={styles.stage}><ReplayVideo uri={replay.replayUrl} /></View>
          <View style={styles.meta}>
            <Text style={styles.title} numberOfLines={2}>{replay.title}</Text>
            <Text style={styles.sub}>{[date, duration, hidden ? 'Hidden from visitors' : null].filter(Boolean).join(', ')}</Text>
            {replay.isOwner ? (
              <View style={styles.actions}>
                <View style={styles.actionCell}><Button
                  fullWidth
                  label={hidden ? 'Show on profile' : 'Hide from profile'}
                  variant="secondary"
                  size="compact"
                  onPress={() => { void toggleVisibility(); }}
                  disabled={busy}
                  testID="live-replay-toggle-visibility"
                /></View>
                <View style={styles.actionCell}><Button
                  fullWidth
                  label="Delete"
                  variant="secondary"
                  size="compact"
                  onPress={confirmDelete}
                  disabled={busy}
                  testID="live-replay-delete"
                /></View>
              </View>
            ) : null}
          </View>
        </>
      )}
      <Snackbar visible={!!notice} message={notice} onDismiss={() => setNotice('')} />
    </View>
  );
}
