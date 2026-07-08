import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Dimensions, FlatList, Image, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';

const { width: W } = Dimensions.get('window');
const COLS = 3;
const GAP = 2;
const TILE = (W - GAP * (COLS - 1)) / COLS;

type Mode = 'post' | 'story' | 'reel' | 'live';

export default function StoryPickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [permissionStatus, setPermissionStatus] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [albumTitle, setAlbumTitle] = useState('Recents');
  const [mode, setMode] = useState<Mode>('story');

  const loadRecents = useCallback(async (albumId?: string) => {
    setLoading(true);
    const page = await MediaLibrary.getAssetsAsync({
      first: 33,
      album: albumId,
      mediaType: [MediaLibrary.MediaType.photo],
      sortBy: [MediaLibrary.SortBy.creationTime],
    });
    setAssets(page.assets);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status === 'granted') {
        setPermissionStatus('granted');
        const albumList = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
        setAlbums(albumList);
        await loadRecents();
      } else {
        setPermissionStatus('denied');
        setLoading(false);
      }
    })();
  }, [loadRecents]);

  function goToEditor(uri: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace({ pathname: '/story-creator', params: { uri } } as never);
  }

  async function openCamera() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo for your story.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [9, 16], quality: 0.9 });
    if (!result.canceled && result.assets[0]) goToEditor(result.assets[0].uri);
  }

  function pickAlbum() {
    if (albums.length === 0) {
      Alert.alert('No albums found', 'Only your Recents are available.');
      return;
    }
    Alert.alert(
      'Switch album',
      undefined,
      [
        { text: 'Recents', onPress: () => { setAlbumTitle('Recents'); loadRecents(); } },
        ...albums.slice(0, 5).map(a => ({
          text: a.title,
          onPress: () => { setAlbumTitle(a.title); loadRecents(a.id); },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }

  function onModePress(m: Mode) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (m !== 'story') {
      Alert.alert('Coming soon', `${m === 'post' ? 'Feed posts' : m === 'reel' ? 'Reels' : 'Live video'} aren't available yet — story creation is ready to use.`);
      return;
    }
    setMode(m);
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* ── Top bar ── */}
      <View style={s.topBar}>
        <TouchableOpacity style={s.iconBtn} activeOpacity={0.7} onPress={() => router.back()}>
          <Feather name="x" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={s.topTitle}>New story</Text>
        <TouchableOpacity
          style={s.iconBtn}
          activeOpacity={0.7}
          onPress={() => Alert.alert('Story settings', 'Save to camera roll, allow sharing, and more will live here.', [{ text: 'OK' }])}
        >
          <Feather name="settings" size={21} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* ── Templates chip ── */}
      <View style={s.templatesRow}>
        <TouchableOpacity
          style={s.templatesChip}
          activeOpacity={0.75}
          onPress={() => Alert.alert('Templates', 'Story templates are coming soon.')}
        >
          <Feather name="copy" size={13} color="#FFF" />
          <Text style={s.templatesText}>Templates</Text>
        </TouchableOpacity>
      </View>

      {/* ── Recents dropdown + Cancel ── */}
      <View style={s.controlsRow}>
        <TouchableOpacity style={s.albumBtn} activeOpacity={0.75} onPress={pickAlbum} hitSlop={{ top: 10, bottom: 10, right: 10 }}>
          <Text style={s.albumText}>{albumTitle}</Text>
          <Feather name="chevron-down" size={16} color="#FFF" />
        </TouchableOpacity>
        <TouchableOpacity style={s.cancelBtn} activeOpacity={0.75} onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10 }}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      {/* ── Media grid ── */}
      {permissionStatus === 'denied' ? (
        <View style={s.deniedWrap}>
          <Feather name="image" size={32} color="#8C8577" />
          <Text style={s.deniedText}>Photo access is off, so your camera roll can't show here.</Text>
          <TouchableOpacity style={s.cameraOnlyBtn} activeOpacity={0.8} onPress={openCamera}>
            <Feather name="camera" size={16} color="#FFF" />
            <Text style={s.cameraOnlyText}>Use camera instead</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={assets}
          keyExtractor={a => a.id}
          numColumns={COLS}
          showsVerticalScrollIndicator={false}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: 110 }}
          ListHeaderComponent={
            <TouchableOpacity style={s.cameraTile} activeOpacity={0.85} onPress={openCamera}>
              <Feather name="camera" size={26} color="#FFF" />
            </TouchableOpacity>
          }
          ListHeaderComponentStyle={{ marginBottom: GAP }}
          ListEmptyComponent={
            !loading ? (
              <Text style={s.emptyText}>No recent photos found.</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={s.thumb} activeOpacity={0.85} onPress={() => goToEditor(item.uri)}>
              <Image source={{ uri: item.uri }} style={s.thumbImg} resizeMode="cover" />
            </TouchableOpacity>
          )}
        />
      )}

      {/* ── Bottom mode selector ── */}
      <View style={[s.modeBar, { paddingBottom: Math.max(insets.bottom, 18) }]}>
        {(['post', 'story', 'reel', 'live'] as Mode[]).map(m => (
          <TouchableOpacity key={m} onPress={() => onModePress(m)} activeOpacity={0.8} style={s.modeItem}>
            <Text style={[s.modeText, mode === m && s.modeTextActive]}>
              {m.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 4, paddingBottom: 2 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },

  templatesRow: { paddingHorizontal: 16, marginTop: 2, marginBottom: 10 },
  templatesChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: '#2A2A2A', paddingHorizontal: 14, paddingVertical: 11, minHeight: 44, borderRadius: 22 },
  templatesText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },

  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10 },
  albumBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingVertical: 10 },
  albumText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  cancelBtn: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  cancelText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#000000' },

  cameraTile: { width: TILE, height: TILE, backgroundColor: '#1C1C1C', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: TILE, height: TILE, backgroundColor: '#1C1C1C' },
  thumbImg: { width: '100%', height: '100%' },
  emptyText: { color: '#8C8577', fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 40, width: W },

  deniedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 40 },
  deniedText: { color: '#8C8577', fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  cameraOnlyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#C94D1F', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 24, marginTop: 4 },
  cameraOnlyText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  modeBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingTop: 4, backgroundColor: '#000000E0' },
  modeItem: { paddingHorizontal: 12, minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  modeText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF80', letterSpacing: 0.4 },
  modeTextActive: { color: '#FFFFFF' },
});
