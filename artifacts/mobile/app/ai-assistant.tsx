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
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import {
  sendMessage as aiSendMessage,
  loadSession,
} from '@/services/aiService';
import type { AISession } from '@/services/aiTypes';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED = [
  'Why are my sales down?',
  'Which products should I restock?',
  'Write a product description',
  'Predict next month\'s revenue',
  'Which ads are underperforming?',
  'Create an email campaign',
];

const INITIAL_MSG: Message = {
  id: '0',
  role: 'assistant',
  content: "Hi! I'm your AI Business Assistant for Brandthread. I have full access to your store data — revenue, products, orders, customers, and more. Ask me anything about your business.",
};

export default function AIAssistantScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MSG]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const sessionRef = useRef<AISession | null>(null);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

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
      // Load or reuse session
      if (!sessionRef.current) {
        sessionRef.current = await loadSession({ screen: 'home' });
      }

      const token = await getToken().catch(() => null);
      const result = await aiSendMessage({
        userText: text.trim(),
        session: sessionRef.current,
        authToken: token,
      });

      sessionRef.current = result.session;

      const aiMsg: Message = {
        id: result.response.id,
        role: 'assistant',
        content: result.response.content || "I'm here to help with your Brandthread business. Ask me about your products, orders, inventory, content, analytics, or store.",
      };
      setMessages((prev) => [aiMsg, ...prev]);
    } catch {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again in a moment.",
      };
      setMessages((prev) => [errMsg, ...prev]);
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
        title="AI Assistant"
        subtitle="Your AI-powered business advisor"
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
              <View style={styles.loadingDots}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.loadDot, { backgroundColor: colors.primary }]} />
                ))}
              </View>
            </View>
          ) : null
        }
        renderItem={({ item: msg }) => (
          <View style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble, {
            backgroundColor: msg.role === 'user' ? colors.primary : colors.card,
            borderColor: msg.role === 'user' ? 'transparent' : colors.border,
          }]}>
            <Text style={[styles.bubbleText, { color: msg.role === 'user' ? colors.primaryForeground : colors.foreground }]}>
              {msg.content}
            </Text>
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
              <Text style={[styles.suggestionText, { color: colors.foreground }]}>{s}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Input */}
      <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: bottomPad + 12 }]}>
        <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            style={[styles.input, { color: colors.foreground }]}
            placeholder="Ask anything about your brand..."
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
          />
          <TouchableOpacity
            onPress={() => sendMessage(input)}
            activeOpacity={0.8}
            disabled={!input.trim() || loading}
            style={[styles.sendBtn, { backgroundColor: input.trim() ? colors.primary : colors.secondary }]}
          >
            <Feather name="send" size={16} color={input.trim() ? colors.primaryForeground : colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 12 },
  backBtn: {},
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiDot: { width: 8, height: 8, borderRadius: 4 },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  loadingDots: { flexDirection: 'row', gap: 6 },
  loadDot: { width: 7, height: 7, borderRadius: 3.5, opacity: 0.6 },
  suggestionList: { flexGrow: 0, maxHeight: 40 },
  suggestion: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'center' },
  suggestionText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  inputBar: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10 },
  inputWrap: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 24, borderWidth: 1, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, gap: 8 },
  input: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', maxHeight: 100, paddingTop: 6, paddingBottom: 6 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
