import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Dimensions, FlatList, Image, Keyboard, KeyboardAvoidingView,
  PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, TouchableWithoutFeedback, useColorScheme, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';

const { width: W, height: H } = Dimensions.get('window');
const PANEL_H = H * 0.52;
const CANVAS_H = H - PANEL_H;

// ─── Music data (real current songs) ─────────────────────────────────────────

const SONGS = [
  { id: '1',  title: 'Espresso',              artist: 'Sabrina Carpenter',     duration: '2:55', color: '#E879A0' },
  { id: '2',  title: 'Please Please Please',   artist: 'Sabrina Carpenter',     duration: '3:06', color: '#8B5CF6' },
  { id: '3',  title: 'Good Luck, Babe!',       artist: 'Chappell Roan',         duration: '3:38', color: '#EC4899' },
  { id: '4',  title: 'Not Like Us',            artist: 'Kendrick Lamar',        duration: '4:34', color: '#1D4ED8' },
  { id: '5',  title: 'Beautiful Things',       artist: 'Benson Boone',          duration: '3:37', color: '#B98A2E' },
  { id: '6',  title: 'Too Sweet',              artist: 'Hozier',                duration: '4:09', color: '#0F766E' },
  { id: '7',  title: 'BIRDS OF A FEATHER',     artist: 'Billie Eilish',         duration: '3:30', color: '#065F46' },
  { id: '8',  title: 'Die With A Smile',       artist: 'Lady Gaga & Bruno Mars',duration: '4:11', color: '#8B5CF6' },
  { id: '9',  title: 'APT.',                   artist: 'ROSÉ & Bruno Mars',     duration: '2:51', color: '#F43F5E' },
  { id: '10', title: 'luther',                 artist: 'Kendrick Lamar & SZA',  duration: '3:56', color: '#0369A1' },
  { id: '11', title: 'End of Beginning',       artist: 'Djo',                   duration: '3:36', color: '#B45309' },
  { id: '12', title: "Texas Hold 'Em",         artist: 'Beyoncé',               duration: '3:54', color: '#A66A1E' },
  { id: '13', title: 'Timeless',               artist: 'The Weeknd',            duration: '4:02', color: '#DC2626' },
  { id: '14', title: 'Lose Control',           artist: 'Teddy Swims',           duration: '3:44', color: '#8B5CF6' },
  { id: '15', title: 'Stargazing',             artist: 'Myles Smith',           duration: '3:22', color: '#3D5A80' },
  { id: '16', title: 'Nokia',                  artist: 'Drake',                 duration: '2:52', color: '#475569' },
  { id: '17', title: 'Disease',                artist: 'Lady Gaga',             duration: '4:05', color: '#1A0A2E' },
  { id: '18', title: 'Taste',                  artist: 'Sabrina Carpenter',     duration: '2:37', color: '#DB2777' },
  { id: '19', title: 'My Eyes',                artist: 'Travis Scott',          duration: '3:48', color: '#78350F' },
  { id: '20', title: 'Dinner',                 artist: 'Beyoncé',               duration: '4:14', color: '#92400E' },
];

const TEXT_COLORS = ['#FFFFFF', '#000000', '#8B5CF6', '#EC4899', '#B98A2E', '#A78BFA', '#4A6FA5', '#EF4444'];
const TEXT_SIZES  = [18, 24, 32, 44];

// ─── Types ────────────────────────────────────────────────────────────────────

type Song   = typeof SONGS[0];
type TxtItem = { id: string; text: string; color: string; size: number; x: number; y: number };
type GifItem = { id: string; url: string; w: number; h: number };
type Panel   = 'none' | 'text' | 'music' | 'gif';

// ─── Draggable item ───────────────────────────────────────────────────────────

function DraggableItem({ x, y, children, onRelease }: {
  x: number; y: number;
  children: React.ReactNode;
  onRelease: (x: number, y: number) => void;
}) {
  const pos = useRef(new Animated.ValueXY({ x, y })).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        pos.setOffset({ x: (pos.x as any)._value, y: (pos.y as any)._value });
        pos.setValue({ x: 0, y: 0 });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      },
      onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pos.flattenOffset();
        onRelease((pos.x as any)._value, (pos.y as any)._value);
      },
    }),
  ).current;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[{ position: 'absolute' }, { transform: pos.getTranslateTransform() }]}
    >
      {children}
    </Animated.View>
  );
}

// ─── GIF Search ───────────────────────────────────────────────────────────────
// Uses Giphy public beta key — swap for your own production key at giphy.com

const GIPHY_KEY = 'dc6zaTOxFJmzC';

async function searchGifs(q: string): Promise<GifItem[]> {
  try {
    const url = q.trim()
      ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=18&rating=g`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=18&rating=g`;
    const res  = await fetch(url);
    const json = await res.json();
    return (json.data ?? []).map((g: any) => ({
      id:  g.id,
      url: g.images.fixed_height_small.url,
      w:   Number(g.images.fixed_height_small.width),
      h:   Number(g.images.fixed_height_small.height),
    }));
  } catch {
    return [];
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StoryCreatorScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';
  const params  = useLocalSearchParams<{ uri?: string }>();

  // Canvas state
  const [imageUri,      setImageUri]      = useState<string | null>(params.uri ?? null);
  const [textItems,     setTextItems]     = useState<TxtItem[]>([]);
  const [selectedMusic, setSelectedMusic] = useState<Song | null>(null);
  const [selectedGif,   setSelectedGif]   = useState<GifItem | null>(null);
  const [gifPos,        setGifPos]        = useState({ x: W / 2 - 75, y: H * 0.3 });

  // Panel state
  const [activePanel,   setActivePanel]   = useState<Panel>('none');
  const [textInput,     setTextInput]     = useState('');
  const [textColor,     setTextColor]     = useState('#FFFFFF');
  const [textSize,      setTextSize]      = useState(24);
  const [musicQuery,    setMusicQuery]    = useState('');
  const [gifQuery,      setGifQuery]      = useState('');
  const [gifResults,    setGifResults]    = useState<GifItem[]>([]);
  const [gifLoading,    setGifLoading]    = useState(false);
  const [posted,        setPosted]        = useState(false);

  // Panel slide animation
  const panelY = useRef(new Animated.Value(PANEL_H)).current;
  const gifDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openPanel(p: Panel) {
    Keyboard.dismiss();
    setActivePanel(p);
    if (p === 'gif') loadGifs('');
    Animated.spring(panelY, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 200 }).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  function closePanel() {
    Keyboard.dismiss();
    Animated.timing(panelY, { toValue: PANEL_H, duration: 220, useNativeDriver: true }).start(() => setActivePanel('none'));
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [9, 16],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      closePanel();
    }
  }

  async function loadGifs(q: string) {
    setGifLoading(true);
    const results = await searchGifs(q);
    setGifResults(results);
    setGifLoading(false);
  }

  function onGifSearch(q: string) {
    setGifQuery(q);
    if (gifDebounce.current) clearTimeout(gifDebounce.current);
    gifDebounce.current = setTimeout(() => loadGifs(q), 500);
  }

  function addText() {
    if (!textInput.trim()) return;
    const newItem: TxtItem = {
      id:    Date.now().toString(),
      text:  textInput.trim(),
      color: textColor,
      size:  textSize,
      x:     W / 2 - 100,
      y:     H * 0.25,
    };
    setTextItems(prev => [...prev, newItem]);
    setTextInput('');
    closePanel();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function removeText(id: string) {
    setTextItems(prev => prev.filter(t => t.id !== id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  function updateTextPos(id: string, x: number, y: number) {
    setTextItems(prev => prev.map(t => t.id === id ? { ...t, x, y } : t));
  }

  function handlePost() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPosted(true);
    setTimeout(() => router.back(), 1800);
  }

  // Auto-open picker on mount only if no photo was already handed to us
  useEffect(() => { if (!params.uri) pickImage(); }, []);

  const filteredSongs = musicQuery.trim()
    ? SONGS.filter(s =>
        s.title.toLowerCase().includes(musicQuery.toLowerCase()) ||
        s.artist.toLowerCase().includes(musicQuery.toLowerCase()))
    : SONGS;

  // ── Posted state ──────────────────────────────────────────────────────────
  if (posted) {
    return (
      <View style={{ flex: 1, backgroundColor: '#121110', alignItems: 'center', justifyContent: 'center' }}>
        <LinearGradient colors={['#1A0A2E', '#8B5CF6']} style={s.postedCircle}>
          <Feather name="check" size={40} color="#FFF" />
        </LinearGradient>
        <Text style={s.postedTitle}>Story posted!</Text>
        <Text style={s.postedSub}>Your followers can see it now</Text>
      </View>
    );
  }

  const canvasGradient: [string, string, string] = imageUri
    ? ['#000', '#000', '#000']
    : ['#14110D', '#241708', '#0F0D0A'];

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* ── Canvas ── */}
      <TouchableWithoutFeedback onPress={closePanel}>
        <View style={s.canvas}>
          {/* Background */}
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <LinearGradient colors={canvasGradient} style={StyleSheet.absoluteFill}>
              <View style={s.tapHint}>
                <Feather name="image" size={36} color="#FFFFFF60" />
                <Text style={s.tapHintText}>Tap the gallery icon to pick a photo</Text>
              </View>
            </LinearGradient>
          )}

          {/* Dark scrim when no image */}
          {!imageUri && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#00000030' }]} />}

          {/* Draggable text items */}
          {textItems.map(item => (
            <DraggableItem
              key={item.id}
              x={item.x}
              y={item.y}
              onRelease={(x, y) => updateTextPos(item.id, x, y)}
            >
              <TouchableOpacity onLongPress={() => removeText(item.id)} activeOpacity={0.9}>
                <View style={[s.textOverlay, { backgroundColor: '#00000040' }]}>
                  <Text style={{ color: item.color, fontSize: item.size, fontFamily: 'Inter_700Bold' }}>
                    {item.text}
                  </Text>
                </View>
              </TouchableOpacity>
            </DraggableItem>
          ))}

          {/* Draggable GIF */}
          {selectedGif && (
            <DraggableItem x={gifPos.x} y={gifPos.y} onRelease={(x, y) => setGifPos({ x, y })}>
              <TouchableOpacity onLongPress={() => setSelectedGif(null)} activeOpacity={0.9}>
                <Image
                  source={{ uri: selectedGif.url }}
                  style={{ width: 140, height: 140 * (selectedGif.h / selectedGif.w) }}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            </DraggableItem>
          )}

          {/* Music sticker */}
          {selectedMusic && (
            <View style={[s.musicSticker, { bottom: 100 }]}>
              <BlurView intensity={60} tint="dark" style={s.musicStickerBlur}>
                <View style={[s.musicStickerArt, { backgroundColor: selectedMusic.color }]}>
                  <Feather name="music" size={13} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.musicStickerTitle} numberOfLines={1}>{selectedMusic.title}</Text>
                  <Text style={s.musicStickerArtist} numberOfLines={1}>{selectedMusic.artist}</Text>
                </View>
                <Feather name="music" size={14} color="#FFFFFF80" />
              </BlurView>
            </View>
          )}

          {/* Top toolbar */}
          <View style={[s.topBar, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity onPress={() => router.back()} style={s.topBtn} activeOpacity={0.75}>
              <BlurView intensity={40} tint="dark" style={s.topBtnBlur}>
                <Feather name="x" size={20} color="#FFF" />
              </BlurView>
            </TouchableOpacity>

            <View style={s.topRight}>
              {[
                { icon: 'type' as const,    panel: 'text'  as Panel },
                { icon: 'music' as const,   panel: 'music' as Panel },
                { icon: 'smile' as const,   panel: 'gif'   as Panel },
              ].map(({ icon, panel }) => (
                <TouchableOpacity
                  key={panel}
                  onPress={() => activePanel === panel ? closePanel() : openPanel(panel)}
                  style={s.topBtn}
                  activeOpacity={0.75}
                >
                  <BlurView intensity={40} tint="dark" style={[s.topBtnBlur, activePanel === panel && { backgroundColor: 'rgba(139,92,246,0.38)' }]}>
                    <Feather name={icon} size={18} color={activePanel === panel ? '#E2DDD0' : '#FFF'} />
                  </BlurView>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Hint label when text items exist */}
          {textItems.length > 0 && (
            <View style={s.hint}>
              <Text style={s.hintText}>Long-press text to remove · drag to reposition</Text>
            </View>
          )}
        </View>
      </TouchableWithoutFeedback>

      {/* ── Bottom action bar ── */}
      <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: activePanel === 'none' ? '#000' : 'transparent' }]}>
        <TouchableOpacity style={s.galleryBtn} onPress={pickImage} activeOpacity={0.8}>
          <Feather name="image" size={20} color="#FFF" />
          <Text style={s.galleryText}>Gallery</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handlePost} activeOpacity={0.85}>
          <LinearGradient colors={['#1A0A2E', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.postBtn}>
            <Text style={s.postBtnText}>Post Story</Text>
            <Feather name="arrow-right" size={16} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* ── Slide-up panel ── */}
      {activePanel !== 'none' && (
        <Animated.View style={[s.panel, { transform: [{ translateY: panelY }] }]}>
          {Platform.OS === 'ios' && (
            <BlurView intensity={70} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          <View style={[s.panelInner, { backgroundColor: isDark ? '#1B1917F5' : '#FFFFFFF5' }]}>
            {/* Handle */}
            <View style={[s.handle, { backgroundColor: isDark ? '#3A362C' : '#D1D1E0' }]} />

            {/* Text Panel */}
            {activePanel === 'text' && (
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <Text style={[s.panelTitle, { color: isDark ? '#F4F4FF' : '#07070F' }]}>Add Text</Text>
                <TextInput
                  style={[s.textInputLarge, { color: textColor, backgroundColor: isDark ? '#1D1A15' : '#EDE7D9', borderColor: isDark ? '#2A261E' : '#DBD3C0' }]}
                  value={textInput}
                  onChangeText={setTextInput}
                  placeholder="Type something…"
                  placeholderTextColor={isDark ? '#4A453B' : '#A69C87'}
                  multiline
                  autoFocus
                  maxLength={80}
                />
                <Text style={[s.subLabel, { color: isDark ? '#8C8577' : '#8080A0' }]}>Colour</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.colorRow}>
                  {TEXT_COLORS.map(c => (
                    <TouchableOpacity
                      key={c}
                      onPress={() => setTextColor(c)}
                      style={[s.colorSwatch, { backgroundColor: c }, textColor === c && s.colorSwatchActive]}
                    />
                  ))}
                </ScrollView>
                <Text style={[s.subLabel, { color: isDark ? '#8C8577' : '#8080A0' }]}>Size</Text>
                <View style={s.sizeRow}>
                  {TEXT_SIZES.map(sz => (
                    <TouchableOpacity
                      key={sz}
                      onPress={() => setTextSize(sz)}
                      style={[s.sizeBtn, { backgroundColor: textSize === sz ? '#8B5CF6' : (isDark ? '#1D1A15' : '#E8E1CF'), borderColor: isDark ? '#2A261E' : '#DBD3C0' }]}
                    >
                      <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: textSize === sz ? '#FFF' : (isDark ? '#A78BFA' : '#8B5CF6') }}>
                        {sz === 18 ? 'S' : sz === 24 ? 'M' : sz === 32 ? 'L' : 'XL'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity onPress={addText} style={s.doneBtn} activeOpacity={0.85}>
                  <LinearGradient colors={['#1A0A2E', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.doneBtnGrad}>
                    <Text style={s.doneBtnText}>Add to Story</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </KeyboardAvoidingView>
            )}

            {/* Music Panel */}
            {activePanel === 'music' && (
              <View style={{ flex: 1 }}>
                <Text style={[s.panelTitle, { color: isDark ? '#F4F4FF' : '#07070F' }]}>Add Music</Text>
                <View style={[s.searchRow, { backgroundColor: isDark ? '#1D1A15' : '#E8E1CF', borderColor: isDark ? '#2A261E' : '#DBD3C0' }]}>
                  <Feather name="search" size={16} color={isDark ? '#8C8577' : '#8080A0'} />
                  <TextInput
                    style={[s.searchInput, { color: isDark ? '#F4F4FF' : '#07070F' }]}
                    value={musicQuery}
                    onChangeText={setMusicQuery}
                    placeholder="Search songs or artists…"
                    placeholderTextColor={isDark ? '#4A453B' : '#A69C87'}
                  />
                  {musicQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setMusicQuery('')}>
                      <Feather name="x-circle" size={15} color={isDark ? '#8C8577' : '#8080A0'} />
                    </TouchableOpacity>
                  )}
                </View>
                {!musicQuery && (
                  <Text style={[s.subLabel, { color: isDark ? '#8C8577' : '#8080A0', marginTop: 6 }]}>🔥 Trending Now</Text>
                )}
                <FlatList
                  data={filteredSongs}
                  keyExtractor={i => i.id}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 20 }}
                  renderItem={({ item }) => {
                    const chosen = selectedMusic?.id === item.id;
                    return (
                      <TouchableOpacity
                        style={[s.songRow, chosen && { backgroundColor: isDark ? '#14110D' : '#E8E1CF' }]}
                        onPress={() => { setSelectedMusic(chosen ? null : item); closePanel(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                        activeOpacity={0.75}
                      >
                        <View style={[s.albumArt, { backgroundColor: item.color }]}>
                          <Feather name="music" size={14} color="#FFF" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.songTitle, { color: isDark ? '#F4F4FF' : '#07070F' }]} numberOfLines={1}>{item.title}</Text>
                          <Text style={[s.songArtist, { color: isDark ? '#8C8577' : '#8080A0' }]} numberOfLines={1}>{item.artist} · {item.duration}</Text>
                        </View>
                        {chosen
                          ? <Feather name="check-circle" size={20} color="#8B5CF6" />
                          : <Feather name="play-circle" size={20} color={isDark ? '#3A362C' : '#E2DDD0'} />}
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            )}

            {/* GIF Panel */}
            {activePanel === 'gif' && (
              <View style={{ flex: 1 }}>
                <Text style={[s.panelTitle, { color: isDark ? '#F4F4FF' : '#07070F' }]}>Add GIF</Text>
                <View style={[s.searchRow, { backgroundColor: isDark ? '#1D1A15' : '#E8E1CF', borderColor: isDark ? '#2A261E' : '#DBD3C0' }]}>
                  <Feather name="search" size={16} color={isDark ? '#8C8577' : '#8080A0'} />
                  <TextInput
                    style={[s.searchInput, { color: isDark ? '#F4F4FF' : '#07070F' }]}
                    value={gifQuery}
                    onChangeText={onGifSearch}
                    placeholder="Search GIFs…"
                    placeholderTextColor={isDark ? '#4A453B' : '#A69C87'}
                  />
                </View>
                {gifLoading ? (
                  <View style={s.loadingRow}>
                    <Text style={[s.loadingText, { color: isDark ? '#8C8577' : '#8080A0' }]}>Loading GIFs…</Text>
                  </View>
                ) : (
                  <FlatList
                    data={gifResults}
                    keyExtractor={g => g.id}
                    numColumns={3}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={s.gifGrid}
                    columnWrapperStyle={{ gap: 4 }}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={s.gifThumb}
                        onPress={() => { setSelectedGif(item); setGifPos({ x: W / 2 - 70, y: H * 0.28 }); closePanel(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                        activeOpacity={0.8}
                      >
                        <Image source={{ uri: item.url }} style={s.gifThumbImg} resizeMode="cover" />
                      </TouchableOpacity>
                    )}
                  />
                )}
                <Text style={[s.poweredBy, { color: isDark ? '#4A453B' : '#B8AE99' }]}>Powered by GIPHY · Long-press GIF on canvas to remove</Text>
              </View>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  canvas:       { width: W, height: H - 80, overflow: 'hidden' },
  tapHint:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  tapHintText:  { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#FFFFFF80', textAlign: 'center', paddingHorizontal: 40 },

  topBar:       { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16 },
  topRight:     { flexDirection: 'row', gap: 8 },
  topBtn:       { borderRadius: 22 },
  topBtnBlur:   { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },

  textOverlay:  { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  hint:         { position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center' },
  hintText:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#FFFFFF70', backgroundColor: '#00000040', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },

  musicSticker:    { position: 'absolute', left: 16, right: 16 },
  musicStickerBlur:{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#FFFFFF20' },
  musicStickerArt: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  musicStickerTitle:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  musicStickerArtist: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#FFFFFF80', marginTop: 1 },

  bottomBar:    { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12 },
  galleryBtn:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24, borderWidth: 1.5, borderColor: '#FFFFFF40' },
  galleryText:  { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  postBtn:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 28 },
  postBtnText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },

  panel:        { position: 'absolute', bottom: 0, left: 0, right: 0, height: PANEL_H, overflow: 'hidden' },
  panelInner:   { flex: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12 },
  handle:       { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  panelTitle:   { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 14 },
  subLabel:     { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginTop: 14 },

  textInputLarge: { borderRadius: 14, borderWidth: 1, padding: 14, fontSize: 20, fontFamily: 'Inter_700Bold', minHeight: 70, textAlignVertical: 'top' },
  colorRow:     { gap: 10, paddingVertical: 4 },
  colorSwatch:  { width: 34, height: 34, borderRadius: 17 },
  colorSwatchActive: { borderWidth: 3, borderColor: '#8B5CF6', transform: [{ scale: 1.15 }] },
  sizeRow:      { flexDirection: 'row', gap: 8 },
  sizeBtn:      { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 9, alignItems: 'center' },
  doneBtn:      { marginTop: 18, borderRadius: 16, overflow: 'hidden' },
  doneBtnGrad:  { paddingVertical: 14, alignItems: 'center' },
  doneBtnText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },

  searchRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 8 },
  searchInput:  { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },

  songRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12 },
  albumArt:     { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  songTitle:    { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  songArtist:   { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  gifGrid:      { gap: 4, paddingVertical: 4, paddingBottom: 20 },
  gifThumb:     { flex: 1, height: 90, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1D1A15' },
  gifThumbImg:  { width: '100%', height: '100%' },
  loadingRow:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:  { fontSize: 14, fontFamily: 'Inter_400Regular' },
  poweredBy:    { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 6 },

  postedCircle: { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  postedTitle:  { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#FFF', marginBottom: 8 },
  postedSub:    { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#8C8577' },
});
