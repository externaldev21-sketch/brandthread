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
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string; // base64
  error?: boolean;
}

const SUGGESTED = [
  'A minimalist hoodie with our wordmark centered on the chest',
  'Streetwear tee, bold graphic on the back, our brand colors',
  'Cropped jacket with an embroidered logo on the sleeve',
];

const INITIAL_MSG: Message = {
  id: '0',
  role: 'assistant',
  content: "Describe the garment, your brand and the design — I'll turn it into a photo-real mockup.",
};

export default function AIMockupChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MSG]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const bottomPad = insets.bottom;

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
    };
    setMessages((prev) => [userMsg, ...prev]);
    setInput('');
    setLoading(true);

    try {
      const result = await api.mockup.generate(text.trim());
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result?.b64_json
          ? "Here's your mockup — generated from your description."
          : "I couldn't generate that mockup. Please try again with a different description.",
        image: result?.b64_json,
        error: !result?.b64_json,
      };
      setMessages((prev) => [aiMsg, ...prev]);
    } catch (err: any) {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "Couldn't create that mockup. Try rewording it.",
        error: true,
      };
      setMessages((prev) => [aiMsg, ...prev]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: 'transparent' }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScreenHeader
        title="AI Clothing Mockups"
        subtitle="AI-generated mockups"
        rightElement={
          <View style={[styles.statusBadge, { backgroundColor: colors.accent }]}>
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
                <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Generating your mockup…</Text>
              </View>
            </View>
          ) : null
        }
        renderItem={({ item: msg }) => (
          <View style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble, {
            backgroundColor: msg.role === 'user' ? colors.primary : colors.card,
            borderColor: msg.role === 'user' ? 'transparent' : (msg.error ? colors.destructive : colors.border),
          }]}>
            <Text style={[styles.bubbleText, { color: msg.role === 'user' ? colors.primaryForeground : colors.foreground }]}>
              {msg.content}
            </Text>
            {msg.image && (
              <Image
                source={{ uri: `data:image/png;base64,${msg.image}` }}
                style={styles.mockupImage}
                resizeMode="cover"
              />
            )}
          </View>
        )}
      />

      {/* Suggestions */}
      {messages.length <= 1 && (
        <FlatList
          horizontal
          data={SUGGESTED}
          keyExtractor={(s) => s}
          showsHorizontalScrollIndicator={false}
          style={styles.suggestionList}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8, alignItems: 'center' }}
          renderItem={({ item: s }) => (
            <TouchableOpacity
              onPress={() => sendMessage(s)}
              activeOpacity={0.75}
              style={[styles.suggestion, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.suggestionText, { color: colors.foreground }]} numberOfLines={2}>{s}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Input */}
      <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: bottomPad + 12 }]}>
        <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.foreground }]}
            placeholder="Describe your design in your own words..."
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
            disabled={!input.trim() || loading}
            style={[styles.sendBtn, { backgroundColor: input.trim() && !loading ? colors.primary : colors.secondary }]}
          >
            <Feather name="send" size={16} color={input.trim() && !loading ? colors.primaryForeground : colors.mutedForeground} />
          </TouchableOpacity>
        </View>
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
  mockupImage: { width: 240, height: 240, borderRadius: 10, marginTop: 10 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingDots: { flexDirection: 'row', gap: 6 },
  loadDot: { width: 7, height: 7, borderRadius: 3.5, opacity: 0.6 },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  suggestionList: { flexGrow: 0, maxHeight: 40 },
  suggestion: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, maxWidth: 220, alignSelf: 'center' },
  suggestionText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  inputBar: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10 },
  inputWrap: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 24, borderWidth: 1, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, gap: 8 },
  input: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', maxHeight: 100, paddingTop: 6, paddingBottom: 6 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
