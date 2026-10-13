/**
 * The tappable profile song row — the audio half of ProfileSongLine, loaded
 * lazily so profile screens don't pull in the audio module until a song is
 * actually on screen. Tap plays the 30-second preview, tap again pauses;
 * never autoplays; plays through the ringer so the silent switch mutes it
 * (playsInSilentMode: false); stops when the screen loses focus.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS } from '@/lib/theme';
import type { ProfileSong } from '@/lib/profileSong';

export function ProfileSongPlayButton({ song, label }: { song: ProfileSong; label: string }) {
  const { theme } = useAppTheme();
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (status.didJustFinish) setPlaying(false);
  }, [status.didJustFinish]);

  useFocusEffect(useCallback(() => () => {
    try { player.pause(); } catch { /* player already released */ }
    setPlaying(false);
  }, [player]));

  // A different song (edit profile → back) never inherits the old one's playback.
  useEffect(() => {
    try { player.pause(); } catch { /* noop */ }
    setPlaying(false);
  }, [song.previewUrl, player]);

  const toggle = async () => {
    if (playing) {
      player.pause();
      setPlaying(false);
      return;
    }
    try {
      await setAudioModeAsync({ playsInSilentMode: false });
      if (status.isLoaded && status.currentTime > 0 && !status.didJustFinish) {
        player.play();
      } else {
        player.replace({ uri: song.previewUrl });
        player.play();
      }
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  };

  return (
    <Pressable
      onPress={() => { void toggle(); }}
      hitSlop={6}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={playing ? `Pause ${song.title}` : `Play ${song.title} by ${song.artist}`}
      testID="profile-song"
    >
      <Feather name={playing ? 'pause' : 'music'} size={13} color={theme.text} />
      <Text style={[styles.text, { color: theme.text }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 28, maxWidth: '100%' },
  text: { fontFamily: FONT.medium, fontSize: FS.sm, flexShrink: 1 },
});
