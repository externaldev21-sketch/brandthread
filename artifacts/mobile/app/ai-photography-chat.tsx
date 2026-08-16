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

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  photos?: string[]; // uris of the photos the user attached with this message
  image?: string; // base64 result
  error?: boolean;
}

const MAX_PHOTOS = 4;

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
  const [input, setInput] = useState('');
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  async function pickPhotos() {
    if (photos.length >= MAX_PHOTOS) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to upload product photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const picked: UploadedPhoto[] = result.assets
      .filter((a) => !!a.base64)
      .slice(0, MAX_PHOTOS - photos.length)
      .map((a) => ({
        id: `${Date.now()}-${a.assetId ?? a.uri}`,
        uri: a.uri,
        base64: a.base64 as string,
        mime: a.mimeType ?? 'image/jpeg',
      }));
    setPhotos((prev) => [...prev, ...picked]);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function sendMessage(text: string) {
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
                <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Generating your studio photo…</Text>
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
                {msg.photos.map((uri: string) => (
                  <Image key={uri} source={{ uri }} style={styles.attachedThumb} resizeMode="cover" />
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
      {photos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}
        >
          {photos.map((p) => (
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
            disabled={photos.length >= MAX_PHOTOS || loading}
            style={styles.attachBtn}
          >
            <Feather name="camera" size={18} color={photos.length >= MAX_PHOTOS ? colors.mutedForeground : colors.primary} />
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { color: colors.foreground }]}
            placeholder="Describe the shot you want..."
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
            disabled={photos.length === 0 || loading}
            style={[styles.sendBtn, { backgroundColor: photos.length > 0 && !loading ? colors.primary : colors.secondary }]}
          >
            <Feather name="send" size={16} color={photos.length > 0 && !loading ? colors.primaryForeground : colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        {photos.length === 0 && (
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Tap the camera icon to add product or reference photos first.</Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  attachedRow: { flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  attachedThumb: { width: 48, height: 48, borderRadius: 8 },
  resultImage: { width: 240, height: 240, borderRadius: 10, marginTop: 10 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingDots: { flexDirection: 'row', gap: 6 },
  loadDot: { width: 7, height: 7, borderRadius: 3.5, opacity: 0.6 },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  trayThumbWrap: { position: 'relative' },
  trayThumb: { width: 56, height: 56, borderRadius: 10 },
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
