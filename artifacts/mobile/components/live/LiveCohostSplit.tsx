/**
 * Split stage for a live with co-hosts: the host on the top half, the
 * accepted co-hosts side by side on the bottom half (TikTok LIVE / Whatnot
 * multi-guest layout). Rendered by the viewer screen (buyer-live.tsx) and
 * the host's own screen (seller-live.tsx) in place of the single full-bleed
 * video while at least one co-host is on stage; with none, callers keep
 * their original full-screen video and this renders nothing.
 *
 * `RtcSurfaceView` is passed in because the native Agora SDK is only
 * loadable on device. Without it (web / Expo Go) each tile shows the
 * person's avatar instead of video.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Avatar } from '@/components/ui/Avatar';
import { FONT, RADIUS } from '@/lib/theme';
import type { LiveCohostPerson } from '@/lib/live/moderationTypes';

interface Props {
  /** The host's Agora uid; 0 renders the local camera (the host's own screen). */
  hostUid: number | null;
  hostName: string;
  hostAvatarUrl?: string | null;
  cohosts: LiveCohostPerson[];
  RtcSurfaceView: any;
}

function Tile({
  uid, name, avatarUrl, RtcSurfaceView, chip, testID,
}: { uid: number | null; name: string; avatarUrl?: string | null; RtcSurfaceView: any; chip: 'top' | 'bottom'; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.card }]} testID={testID}>
      {RtcSurfaceView && uid != null ? (
        <RtcSurfaceView canvas={{ uid, renderMode: 1 }} style={StyleSheet.absoluteFill} zOrderMediaOverlay={uid !== 0} />
      ) : (
        <View style={styles.fallback}>
          <Avatar uri={avatarUrl ?? null} name={name} size={72} />
        </View>
      )}
      {/* Name chips sit on the seam between the halves, clear of the top bar and the chat. */}
      <View style={[styles.nameChip, chip === 'top' ? styles.chipTop : styles.chipBottom, { backgroundColor: theme.background }]}>
        <Text style={[styles.nameText, { color: theme.text }]} numberOfLines={1}>{name}</Text>
      </View>
    </View>
  );
}

export function LiveCohostSplit({ hostUid, hostName, hostAvatarUrl, cohosts, RtcSurfaceView }: Props) {
  const { theme } = useAppTheme();
  if (!cohosts.length) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: theme.background }]} testID="live-cohost-split">
      <View style={styles.half}>
        <Tile uid={hostUid} name={hostName} avatarUrl={hostAvatarUrl} RtcSurfaceView={RtcSurfaceView} chip="bottom" testID="live-split-host" />
      </View>
      <View style={[styles.half, styles.row]}>
        {cohosts.map((c) => (
          <View key={c.userId} style={styles.cell}>
            <Tile uid={c.agoraUid} name={c.displayName} avatarUrl={c.avatarUrl} RtcSurfaceView={RtcSurfaceView} chip="top" testID="live-split-cohost" />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 2 },
  half: { flex: 1 },
  row: { flexDirection: 'row', gap: 2 },
  cell: { flex: 1 },
  tile: { flex: 1, overflow: 'hidden' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  nameChip: {
    position: 'absolute', left: 10, maxWidth: '80%',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.sm,
  },
  chipTop: { top: 10 },
  chipBottom: { bottom: 10 },
  nameText: { fontFamily: FONT.semibold, fontSize: 12 },
});
