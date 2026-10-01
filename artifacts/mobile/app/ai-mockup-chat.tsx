import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
  Image,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import Composer from '@/components/ui/Composer';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import { FONT, FS } from '@/lib/theme';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string; // base64
  error?: boolean;
}

const SUGGESTED = [
  'Minimalist hoodie, chest wordmark',
  'Streetwear tee, bold back graphic',
  'Cropped jacket, embroidered sleeve logo',
];

const INITIAL_MSG: Message = {
  id: '0',
  role: 'assistant',
  content: "Describe the garment, your brand and the design — I'll turn it into a photo-real mockup.",
};

export default function AIMockupChatScreen() {
  const colors = useColors();
  const api = useApi();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MSG]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatRef = useRef<FlatList>(null);

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
      <ScreenHeader title="AI Clothing Mockups" divider={false} />

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

      {/* Input */}
      <Composer
        testID="ai-mockup"
        value={input}
        onChangeText={setInput}
        onSend={() => sendMessage(input)}
        canSend={!!input.trim() && !loading}
        editable={!loading}
        maxLength={500}
        enterToSend={false}
        placeholder="Describe your design in your own words..."
        topSlot={
          messages.length <= 1 ? (
            <View style={styles.suggestionList}>
              {SUGGESTED.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => sendMessage(s)}
                  activeOpacity={0.75}
                  style={[styles.suggestion, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text style={[styles.suggestionText, { color: colors.foreground }]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  mockupImage: { width: 240, height: 240, borderRadius: 10, marginTop: 10 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingDots: { flexDirection: 'row', gap: 6 },
  loadDot: { width: 7, height: 7, borderRadius: 3.5, opacity: 0.6 },
  loadingText: { fontSize: 13, fontFamily: FONT.regular },
  suggestionList: { gap: 8, paddingBottom: 8 },
  suggestion: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  suggestionText: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
});
