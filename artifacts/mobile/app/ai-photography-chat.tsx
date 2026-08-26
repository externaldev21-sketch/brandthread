import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Image,
  ScrollView,
  Alert,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useApi } from '@/hooks/useApi';

interface UploadedPhoto {
  id: string;
  uri: string;
  base64: string;
  mime: string;
}

type PhotographyMode = 'free' | 'outfitSwap';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  photos?: string[]; // uris of the photos the user attached with this message
  photoLabels?: string[];
  image?: string; // base64 result
  error?: boolean;
}

const MAX_PHOTOS = 4;
const MAX_GARMENTS = 4;

const INITIAL_MSG: Message = {
  id: '0',
  role: 'assistant',
  content: "Hi! I'm your AI product photographer, powered by Nano Banana 3. Upload one or more photos of your clothing product — plus any reference photos of the look you're going for — and describe the shot you want. I'll generate a studio-quality photo with an AI model wearing your product.",
};

export default function AIPhotographyChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MSG]);
  const [mode, setMode] = useState<PhotographyMode>('free');
  const [input, setInput] = useState('');
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [heroPhoto, setHeroPhoto] = useState<UploadedPhoto | null>(null);
  const [garments, setGarments] = useState<UploadedPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  async function pickPhotos() {
    const remaining = mode === 'outfitSwap'
      ? (heroPhoto ? MAX_GARMENTS - garments.length : MAX_GARMENTS + 1)
      : MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to upload product photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const picked: UploadedPhoto[] = result.assets
      .filter((a) => !!a.base64)
      .slice(0, remaining)
      .map((a) => ({
        id: `${Date.now()}-${a.assetId ?? a.uri}`,
        uri: a.uri,
        base64: a.base64 as string,
        mime: a.mimeType ?? 'image/jpeg',
      }));
    if (mode === 'outfitSwap') {
      if (!heroPhoto && picked.length > 0) {
        setHeroPhoto(picked[0]);
        setGarments((prev) => [...prev, ...picked.slice(1, MAX_GARMENTS + 1)]);
      } else {
        setGarments((prev) => [...prev, ...picked].slice(0, MAX_GARMENTS));
      }
    } else {
      setPhotos((prev) => [...prev, ...picked]);
    }
  }

  function removePhoto(id: string) {
    if (mode === 'outfitSwap') {
      setGarments((prev) => prev.filter((p) => p.id !== id));
      return;
    }
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  function resetOutfitSwap() {
    Alert.alert(
      'Start a new Outfit Swap?',
      'This releases the locked hero photo. Your previous messages and generated images will stay in the thread.',
      [
        { text: 'Keep current hero', style: 'cancel' },
        {
          text: 'Start new swap',
          style: 'destructive',
          onPress: () => {
            setHeroPhoto(null);
            setGarments([]);
            setMessages((prev) => [{
              id: `${Date.now()}-new-outfit-swap`,
              role: 'assistant',
              content: 'New Outfit Swap started. Upload one hero photo to lock a new model, pose, framing, and background.',
            }, ...prev]);
          },
        },
      ],
    );
  }

  async function sendFreeMessage(text: string) {
    if ((!text.trim() && photos.length === 0) || loading) return;
    if (photos.length === 0) return; // need at least one product photo
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const attached = photos;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim() || 'Generate a studio photo from these photos.',
      photos: attached.map((p) => p.uri),
    };
    setMessages((prev) => [userMsg, ...prev]);
    setInput('');
    setPhotos([]);
    setLoading(true);

    try {
      const dataUrls = attached.map((p) => `data:${p.mime};base64,${p.base64}`);
      const result = await api.photography.generate(dataUrls, text.trim());
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result?.b64_json
          ? "Here's your studio photo."
          : "I couldn't generate that photo. Please try again with different photos.",
        image: result?.b64_json,
        error: !result?.b64_json,
      };
      setMessages((prev) => [aiMsg, ...prev]);
    } catch (err: any) {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: err?.message ?? 'Something went wrong generating your photo. Please try again.',
        error: true,
      };
      setMessages((prev) => [aiMsg, ...prev]);
    } finally {
      setLoading(false);
    }
  }

  async function sendOutfitSwap(text: string) {
    if (!heroPhoto || loading) return;

    // A hero-only message locks the photoshoot into the conversation so
    // garment designs can arrive in later chat messages.
    if (garments.length === 0) {
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: text.trim() || 'Lock this hero photo for Outfit Swap.',
        photos: [heroPhoto.uri],
        photoLabels: ['Locked hero photo'],
      };
      const aiMsg: Message = {
        id: `${Date.now()}-locked`,
        role: 'assistant',
        content: 'Hero photo locked. Upload one or more garment mockups in this chat and I’ll keep the same model, pose, framing, and background for each result.',
      };
      setMessages((prev) => [aiMsg, userMsg, ...prev]);
      setInput('');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const attachedGarments = garments;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim() || `Swap the hero outfit for ${attachedGarments.length} garment design${attachedGarments.length === 1 ? '' : 's'}.`,
      photos: [heroPhoto.uri, ...attachedGarments.map((p) => p.uri)],
      photoLabels: ['Locked hero', ...attachedGarments.map((_p, index) => `Garment ${index + 1}`)],
    };
    setMessages((prev) => [userMsg, ...prev]);
    setInput('');
    setGarments([]);
    setLoading(true);

    try {
      const heroDataUrl = `data:${heroPhoto.mime};base64,${heroPhoto.base64}`;
      const garmentDataUrls = attachedGarments.map((p) => `data:${p.mime};base64,${p.base64}`);
      const result = await api.photography.generateOutfitSwap(heroDataUrl, garmentDataUrls, text.trim());
      const resultMessages: Message[] = (result?.results ?? []).map((item: { b64_json?: string; garmentIndex?: number }, index: number) => ({
        id: `${Date.now()}-result-${index}`,
        role: 'assistant',
        content: item.b64_json
          ? `Outfit Swap result ${index + 1} of ${attachedGarments.length} — garment ${item.garmentIndex ?? index + 1} on the locked hero scene.`
          : `Garment ${item.garmentIndex ?? index + 1} could not be generated.`,
        image: item.b64_json,
        error: !item.b64_json,
      }));
      if (resultMessages.length === 0) {
        throw new Error('No outfit swap results were returned. Please try again.');
      }
      if (result?.errors?.length) {
        result.errors.forEach((failure: { garmentIndex?: number }) => {
          resultMessages.push({
            id: `${Date.now()}-error-${failure.garmentIndex ?? resultMessages.length}`,
            role: 'assistant',
            content: `Garment ${failure.garmentIndex ?? resultMessages.length + 1} could not be generated. Please try that design again.`,
            error: true,
          });
        });
      }
      setMessages((prev) => [...resultMessages, ...prev]);
    } catch (err: any) {
      setMessages((prev) => [{
        id: `${Date.now()}-outfit-error`,
        role: 'assistant',
        content: err?.message ?? 'Something went wrong generating the outfit swaps. Please try again.',
        error: true,
      }, ...prev]);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(text: string) {
    if (mode === 'outfitSwap') {
      await sendOutfitSwap(text);
    } else {
      await sendFreeMessage(text);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScreenHeader
        title="AI Product Photography"
        subtitle="Powered by Nano Banana 3"
        rightElement={
          <View style={[styles.statusBadge, { backgroundColor: 'rgba(139,92,246,0.13)' }]}>
            <Text style={[styles.statusText, { color: colors.success }]}>Online</Text>
          </View>
        }
      />

      {/* Chat mode switch — both modes share the same thread and composer. */}
      <View style={[styles.modeSwitch, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={() => setMode('free')}
          style={[styles.modeChip, mode === 'free' && { backgroundColor: colors.primary }]}
        >
          <Feather name="edit-3" size={14} color={mode === 'free' ? colors.primaryForeground : colors.mutedForeground} />
          <Text style={[styles.modeChipText, { color: mode === 'free' ? colors.primaryForeground : colors.mutedForeground }]}>
            Product Photography
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={() => setMode('outfitSwap')}
          style={[styles.modeChip, mode === 'outfitSwap' && { backgroundColor: colors.primary }]}
        >
          <Feather name="refresh-cw" size={14} color={mode === 'outfitSwap' ? colors.primaryForeground : colors.mutedForeground} />
          <Text style={[styles.modeChipText, { color: mode === 'outfitSwap' ? colors.primaryForeground : colors.mutedForeground }]}>
            Outfit Swap
          </Text>
        </TouchableOpacity>
      </View>

      {mode === 'outfitSwap' && (
        <View style={[styles.outfitNotice, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Feather name="lock" size={14} color={colors.primary} />
          <Text style={[styles.outfitNoticeText, { color: colors.mutedForeground }]}>
            {heroPhoto
              ? 'Hero locked — upload garment mockups to keep the same scene.'
              : 'Upload one hero photo first. The model, pose, framing, and background stay locked.'}
          </Text>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatRef}
        data={messages}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          loading ? (
            <View style={[styles.bubble, styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.loadingRow}>
                <View style={styles.loadingDots}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={[styles.loadDot, { backgroundColor: colors.primary }]} />
                  ))}
                </View>
                <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                  {mode === 'outfitSwap' ? 'Generating your outfit swaps…' : 'Generating your studio photo…'}
                </Text>
              </View>
            </View>
          ) : null
        }
        renderItem={({ item: msg }) => (
          <View style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble, {
            backgroundColor: msg.role === 'user' ? colors.primary : colors.card,
            borderColor: msg.role === 'user' ? 'transparent' : (msg.error ? colors.destructive : colors.border),
          }]}>
            {msg.photos && msg.photos.length > 0 && (
              <View style={styles.attachedRow}>
                {msg.photos.map((uri: string, index: number) => (
                  <View key={`${uri}-${index}`} style={styles.attachedItem}>
                    <Image source={{ uri }} style={styles.attachedThumb} resizeMode="cover" />
                    {msg.photoLabels?.[index] && (
                      <Text style={[styles.attachedLabel, { color: msg.role === 'user' ? colors.primaryForeground : colors.mutedForeground }]}>
                        {msg.photoLabels[index]}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}
            <Text style={[styles.bubbleText, { color: msg.role === 'user' ? colors.primaryForeground : colors.foreground }]}>
              {msg.content}
            </Text>
            {msg.image && (
              <Image
                source={{ uri: `data:image/png;base64,${msg.image}` }}
                style={styles.resultImage}
                resizeMode="cover"
              />
            )}
          </View>
        )}
      />

      {/* Photo tray */}
      {mode === 'outfitSwap' && heroPhoto && (
        <View style={[styles.lockedHeroTray, { backgroundColor: colors.card, borderColor: colors.primary }]}>
          <Image source={{ uri: heroPhoto.uri }} style={styles.trayThumb} resizeMode="cover" />
          <View style={styles.lockedHeroCopy}>
            <Text style={[styles.lockedHeroTitle, { color: colors.foreground }]}>Hero locked</Text>
            <Text style={[styles.lockedHeroSub, { color: colors.mutedForeground }]}>Same model · pose · scene</Text>
          </View>
          <TouchableOpacity
            style={[styles.resetHeroBtn, { borderColor: colors.border }]}
            onPress={resetOutfitSwap}
            activeOpacity={0.8}
            accessibilityLabel="Start a new Outfit Swap"
            accessibilityHint="Releases this hero photo so you can lock a different scene"
          >
            <Feather name="rotate-ccw" size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      )}
      {((mode === 'free' && photos.length > 0) || (mode === 'outfitSwap' && garments.length > 0)) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}
        >
          {(mode === 'free' ? photos : garments).map((p) => (
            <View key={p.id} style={styles.trayThumbWrap}>
              <Image source={{ uri: p.uri }} style={styles.trayThumb} resizeMode="cover" />
              <TouchableOpacity
                style={[styles.trayRemove, { backgroundColor: colors.destructive }]}
                onPress={() => removePhoto(p.id)}
                activeOpacity={0.8}
              >
                <Feather name="x" size={11} color="#FFF" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Input */}
      <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: bottomPad + 12 }]}>
        <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            onPress={pickPhotos}
            activeOpacity={0.8}
            disabled={(mode === 'free' ? photos.length >= MAX_PHOTOS : (heroPhoto ? garments.length >= MAX_GARMENTS : false)) || loading}
            style={styles.attachBtn}
          >
            <Feather
              name="camera"
              size={18}
              color={(mode === 'free' ? photos.length >= MAX_PHOTOS : (heroPhoto ? garments.length >= MAX_GARMENTS : false))
                ? colors.mutedForeground
                : colors.primary}
            />
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { color: colors.foreground }]}
            placeholder={mode === 'outfitSwap' ? 'Add outfit notes (optional)...' : 'Describe the shot you want...'}
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={500}
            editable={!loading}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
          />
          <TouchableOpacity
            onPress={() => sendMessage(input)}
            activeOpacity={0.8}
            disabled={(mode === 'free' ? photos.length === 0 : !heroPhoto) || loading}
            style={[styles.sendBtn, {
              backgroundColor: (mode === 'free' ? photos.length > 0 : !!heroPhoto) && !loading ? colors.primary : colors.secondary,
            }]}
          >
            <Feather
              name="send"
              size={16}
              color={(mode === 'free' ? photos.length > 0 : !!heroPhoto) && !loading ? colors.primaryForeground : colors.mutedForeground}
            />
          </TouchableOpacity>
        </View>
        {(mode === 'free' ? photos.length === 0 : !heroPhoto && garments.length === 0) && (
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {mode === 'free'
              ? 'Tap the camera icon to add product or reference photos first.'
              : 'Tap the camera icon to add one hero photo. Garments can follow in this chat.'}
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  modeSwitch: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  modeChip: { flex: 1, minHeight: 34, borderRadius: 17, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  modeChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  outfitNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: 1 },
  outfitNoticeText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  attachedRow: { flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  attachedItem: { alignItems: 'center', gap: 3 },
  attachedThumb: { width: 48, height: 48, borderRadius: 8 },
  attachedLabel: { fontSize: 9, fontFamily: 'Inter_500Medium' },
  resultImage: { width: 240, height: 240, borderRadius: 10, marginTop: 10 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingDots: { flexDirection: 'row', gap: 6 },
  loadDot: { width: 7, height: 7, borderRadius: 3.5, opacity: 0.6 },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  trayThumbWrap: { position: 'relative' },
  trayThumb: { width: 56, height: 56, borderRadius: 10 },
  lockedHeroTray: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, padding: 8, borderRadius: 12, borderWidth: 1 },
  lockedHeroCopy: { flex: 1, marginLeft: 10 },
  lockedHeroTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  lockedHeroSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  resetHeroBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  trayRemove: {
    position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  inputBar: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10 },
  inputWrap: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 24, borderWidth: 1, paddingLeft: 10, paddingRight: 6, paddingVertical: 6, gap: 8 },
  attachBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', maxHeight: 100, paddingTop: 6, paddingBottom: 6 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 6, marginBottom: 4 },
});
