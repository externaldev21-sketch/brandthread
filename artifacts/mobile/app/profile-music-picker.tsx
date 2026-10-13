/**
 * Edit profile → Music (Instagram "Add music to your profile", 1:1): search
 * the licensed preview catalog, preview a track with its play button (never
 * on its own), tap the row to put it on your profile. Only reachable while
 * profile music is on; a cold deep link with it off just goes back.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CachedImage } from '@/components/CachedImage';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useProfileMusicEnabled } from '@/hooks/useProfileMusic';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { emitProfileSongChanged, type ProfileSong } from '@/lib/profileSong';

export default function ProfileMusicPicker() {
  const router = useRouter();
  const api = useApi();
  const { userId } = useAuth();
  const { theme } = useAppTheme();
  const enabled = useProfileMusicEnabled();
  const [q, setQ] = useState('');
  const [tracks, setTracks] = useState<ProfileSong[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const requestId = useRef(0);
  const leave = () => goBackOr(router, '/(buyer)/edit-profile');

  useEffect(() => { if (status.didJustFinish) setPreviewing(null); }, [status.didJustFinish]);
  useFocusEffect(useCallback(() => () => {
    try { player.pause(); } catch { /* released */ }
    setPreviewing(null);
  }, [player]));

  const search = useCallback(async (term: string) => {
    const id = ++requestId.current;
    if (!term.trim()) { setTracks([]); setLoading(false); setFailed(false); return; }
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.profileMusic.search(term.trim());
      if (id === requestId.current) setTracks(res.tracks);
    } catch {
      if (id === requestId.current) setFailed(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const t = setTimeout(() => { void search(q); }, 300);
    return () => clearTimeout(t);
  }, [q, search]);

  async function togglePreview(track: ProfileSong) {
    if (previewing === track.id) {
      player.pause();
      setPreviewing(null);
      return;
    }
    try {
      await setAudioModeAsync({ playsInSilentMode: false });
      player.replace({ uri: track.previewUrl });
      player.play();
      setPreviewing(track.id);
    } catch {
      setPreviewing(null);
    }
  }

  async function pick(track: ProfileSong) {
    if (saving) return;
    setSaving(track.id);
    try {
      const res = await api.profileMusic.setMine(track.id);
      if (userId) emitProfileSongChanged(userId, res.song);
      try { player.pause(); } catch { /* noop */ }
      leave();
    } catch {
      setSaving(null);
    }
  }

  if (!enabled) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Music" variant="push" onBack={leave} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Music" variant="push" onBack={leave} />
      <View style={[styles.search, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Feather name="search" size={16} color={theme.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search music"
          placeholderTextColor={theme.muted}
          style={[styles.input, { color: theme.text }]}
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
          testID="music-search"
        />
      </View>
      {loading && tracks.length === 0 ? <ActivityIndicator color={theme.muted} style={{ marginTop: SP.lg }} /> : null}
      {failed ? (
        <Pressable onPress={() => { void search(q); }} style={styles.retry} accessibilityRole="button">
          <Text style={[styles.meta, { color: theme.muted }]}>Couldn't load music. Tap to retry.</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={tracks}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: SP.xxl }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { void pick(item); }}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.title} by ${item.artist} to your profile`}
            testID={`music-track-${item.id}`}
          >
            {item.artworkUrl ? (
              <CachedImage source={{ uri: item.artworkUrl }} style={styles.art} contentFit="cover" />
            ) : (
              <View style={[styles.art, { backgroundColor: theme.card }]} />
            )}
            <View style={styles.rowText}>
              <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{item.title}</Text>
              <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>{item.artist}</Text>
            </View>
            {saving === item.id ? (
              <ActivityIndicator color={theme.muted} />
            ) : (
              <Pressable
                onPress={() => { void togglePreview(item); }}
                hitSlop={10}
                style={[styles.play, { borderColor: theme.border }]}
                accessibilityRole="button"
                accessibilityLabel={previewing === item.id ? `Pause ${item.title}` : `Preview ${item.title}`}
              >
                <Feather name={previewing === item.id ? 'pause' : 'play'} size={14} color={theme.text} />
              </Pressable>
            )}
          </Pressable>
        )}
        ListFooterComponent={tracks.length > 0 ? (
          <Text style={[styles.attribution, { color: theme.muted }]}>Previews from Apple Music</Text>
        ) : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.md, marginBottom: SP.sm,
    paddingHorizontal: 12, height: 40, borderRadius: RADIUS.sm, borderWidth: 1,
  },
  input: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  art: { width: 48, height: 48, borderRadius: 4 },
  rowText: { flex: 1, minWidth: 0 },
  title: { fontFamily: FONT.semibold, fontSize: FS.base },
  meta: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
  play: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  retry: { paddingHorizontal: SP.md, paddingVertical: SP.md },
  attribution: { fontFamily: FONT.regular, fontSize: FS.meta, textAlign: 'center', marginTop: SP.md },
});
