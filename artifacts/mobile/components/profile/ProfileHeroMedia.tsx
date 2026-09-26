/**
 * Full-bleed profile hero media: the creator's latest video playing muted
 * behind their name, falling back to the latest post's poster, then to the
 * theme's hero gradient with the Brandthread thread drawn across it.
 *
 * Playback only runs while `active` (screen focused, hero on screen, Reduce
 * Motion off) so a profile never keeps decoding video off-screen. A profile
 * cover video uses the same path (always muted, looping, poster first); with
 * `posterOnly` (Reduce Motion / data saver) no player is created at all.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ProfileThread } from './ProfileThread';

export function ProfileHeroMedia({
  videoUri,
  posterUri,
  active,
  height,
  posterOnly = false,
}: {
  videoUri?: string | null;
  posterUri?: string | null;
  active: boolean;
  height: number;
  posterOnly?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.card }]} pointerEvents="none" testID="profile-hero-media">
      {videoUri && !(posterOnly && posterUri) ? (
        <HeroVideo uri={videoUri} posterUri={posterUri ?? null} active={active} />
      ) : posterUri ? (
        <CachedImage source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      ) : (
        <>
          <LinearGradient
            colors={theme.heroGradient as unknown as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={theme.glowGradient as unknown as [string, string, ...string[]]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <ProfileThread height={Math.round(height * 0.5)} color={theme.text} style={styles.thread} />
        </>
      )}
    </View>
  );
}

function HeroVideo({ uri, posterUri, active }: { uri: string; posterUri: string | null; active: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) setStarted(true);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  return (
    <>
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, styles.fill, !started && posterUri ? styles.hidden : null]}
        contentFit="cover"
        nativeControls={false}
      />
      {!started && posterUri ? (
        <CachedImage source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  hidden: { opacity: 0 },
  thread: { position: 'absolute', left: 0, right: 0, top: '22%' },
});
