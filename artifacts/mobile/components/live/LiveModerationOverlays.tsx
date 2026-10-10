/**
 * Small presentational pieces shared by the live host and viewer screens:
 * the pinned-comment bar above chat, and the co-host tiles.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import type { PinnedComment } from '@/lib/live/useLiveModeration';
import type { LiveCohostPerson } from '@/lib/live/moderationTypes';

export function PinnedCommentBar({ comment }: { comment: PinnedComment | null }) {
  const { theme } = useAppTheme();
  if (!comment) return null;
  return (
    <View
      style={[styles.pinned, { backgroundColor: theme.card }]}
      accessibilityLabel={`Pinned comment from ${comment.display_name}: ${comment.message}`}
      testID="live-pinned-comment"
    >
      <Icon name="bookmark" size={13} color={theme.text} style={styles.pinIcon} />
      <Text style={[styles.pinnedText, { color: theme.text }]} numberOfLines={2}>
        <Text style={styles.pinnedName}>{comment.display_name} </Text>
        {comment.message}
      </Text>
    </View>
  );
}

/**
 * Co-host tiles: one small video tile per accepted co-host that has an Agora
 * uid, with their name underneath. `RtcSurfaceView` is passed in because the
 * native SDK is only loadable on device.
 */
export function CohostTiles({
  cohosts, RtcSurfaceView, top,
}: { cohosts: LiveCohostPerson[]; RtcSurfaceView: any; top: number }) {
  const { theme } = useAppTheme();
  if (!cohosts.length) return null;
  return (
    <View style={[styles.tiles, { top }]} pointerEvents="none" testID="live-cohost-tiles">
      {cohosts.map((c) => (
        <View key={c.userId} style={[styles.tile, { backgroundColor: theme.card }]}>
          {RtcSurfaceView && c.agoraUid != null ? (
            <RtcSurfaceView canvas={{ uid: c.agoraUid, renderMode: 1 }} style={StyleSheet.absoluteFill} zOrderMediaOverlay />
          ) : (
            <View style={styles.tileFallback}><Icon name="user" size={22} color={theme.muted} /></View>
          )}
          <View style={[styles.tileName, { backgroundColor: theme.card }]}>
            <Text style={[styles.tileNameText, { color: theme.text }]} numberOfLines={1}>{c.displayName}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pinned: {
    flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: 12, marginBottom: SP.sm,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.md,
  },
  pinIcon: { marginTop: 2, marginRight: 8 },
  pinnedText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.meta },
  pinnedName: { fontFamily: FONT.bold },
  tiles: { position: 'absolute', left: 12, zIndex: 9, gap: SP.sm },
  tile: { width: 92, height: 136, borderRadius: RADIUS.md, overflow: 'hidden' },
  tileFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileName: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 6, paddingVertical: 3 },
  tileNameText: { fontFamily: FONT.semibold, fontSize: 11 },
});
