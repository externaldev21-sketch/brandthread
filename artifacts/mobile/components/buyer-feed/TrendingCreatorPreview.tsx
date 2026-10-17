/**
 * The single live video preview in the Following empty state (Mobbin
 * following-2). Mounted only for the centered card while the screen is
 * focused, so at most one player exists here (the empty Following tab
 * has no Spotlight players). Muted, looping; the card's real poster stays
 * visible underneath until the first frame renders, and on error the
 * video layer simply stays hidden. Unmounting releases the player.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { recordFeedVideoError } from '@/lib/feedVideoDiagnostics';

export function TrendingCreatorPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.muted = true; p.loop = true; });
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    const sub = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error') {
        recordFeedVideoError('trending-creator-preview', uri, error?.message ?? 'Unknown preview error');
        setFailed(true);
      }
    });
    return () => sub.remove();
  }, [player, uri]);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    // Setup must restore playback after Strict Mode replays the cleanup.
    player.play();
    return () => { try { player.pause(); } catch { /* already released */ } };
  }, [player]);
  if (failed) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="trending-creator-preview-video">
      <VideoView
      player={player}
      style={[StyleSheet.absoluteFill, { opacity: shown ? 1 : 0 }]}
      contentFit="cover"
      nativeControls={false}
      onFirstFrameRender={() => setShown(true)}
      />
    </View>
  );
}
