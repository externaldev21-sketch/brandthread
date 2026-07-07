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
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

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

const CANNED: Record<string, string> = {
  'Why are my sales down?': "Looking at your data over the last 7 days, I see sales dropped 12% compared to last week. The biggest contributing factor appears to be a decrease in returning customer purchases — down 28%. Your 'Oversized Hoodie' and 'Cargo Shorts' have also gone out of stock, representing $4,200 in missed revenue. I'd recommend:\n1. Restocking those items immediately\n2. Launching a win-back email to inactive customers\n3. Running a flash sale this weekend to boost conversion",
  'Which products should I restock?': "Based on your sales velocity and current stock levels, here's your urgent restock priority:\n\n🔴 Critical (< 5 units):\n• Cargo Shorts – Khaki M (1 unit)\n• Classic Tee – White XL (3 units)\n\n🟡 Low (< 10 units):\n• Hoodie – Black S (7 units)\n\nI recommend placing a reorder for at least 200 units each with Apex Garment Co. based on your typical 6-week lead time.",
  'Write a product description': "Here's a product description for the Classic Thread Tee:\n\n**Classic Thread Tee**\n\nSimplicity, perfected. The Classic Thread Tee is crafted from 180gsm premium combed cotton — structured enough to keep its shape, soft enough to wear every day. A clean silhouette, a barely-there logo, and a fit that works whether you're building the brand or living in it.\n\n• 180gsm 100% combed cotton\n• True-to-size fit\n• Reinforced shoulder seams\n• Pre-shrunk & colorfast",
  'Predict next month\'s revenue': "Based on your historical trend, current inventory, and planned marketing campaigns, here's my revenue forecast for August:\n\n**Projected Revenue: $98,400 – $112,000**\n\nKey assumptions:\n• Summer Drop campaign launches Aug 1 (est. +$18k)\n• Hoodie restock arrives Aug 5\n• 15% MoM growth trend continues\n\nRisk factors: Potential shipping delays from Apex (QC review in progress). If their delivery slips past Aug 15, I'd revise the forecast down by ~$8k.",
  'Which ads are underperforming?': "Analyzing your ad attribution data from the last 30 days:\n\n🔴 Underperforming (ROAS < 1.5x):\n• Instagram Story – 'Summer Vibes' (ROAS: 0.9x, spend: $400)\n• TikTok Carousel – Product showcase (ROAS: 1.1x, spend: $280)\n\n✅ Strong performers:\n• Instagram Reel – Hoodie launch (ROAS: 4.2x)\n• Email campaign 'Summer Drop' (ROAS: 8.1x)\n\nRecommendation: Pause the two underperformers and reallocate that $680 to the hoodie reel.",
  'Create an email campaign': "Here's a ready-to-send email campaign:\n\n**Subject:** Something new just dropped. 👀\n\n**Preview:** Your next go-to piece is here.\n\n---\n\nHey [First Name],\n\nWe don't drop things often — but when we do, we make it count.\n\nIntroducing the **Wide-Leg Trousers**. Clean lines, premium cotton twill, and a silhouette that works from desk to dinner.\n\n[SHOP NOW →]\n\nLimited quantities. First come, first served.\n\n— The Brandthread Team\n\n---\n\nShall I send this to all subscribers or a specific segment?",
};

export default function AIAssistantScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MSG]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  function sendMessage(text: string) {
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

    const responseText = CANNED[text.trim()] ??
      "Great question! Based on your current store data, I'm analyzing the trends across your orders, products, and customer segments. In summary: your store is performing well with a 24% revenue growth this month. If you'd like a deeper dive into any specific area, just let me know — inventory, marketing, customers, or financial projections.";

    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText,
      };
      setMessages((prev) => [aiMsg, ...prev]);
      setLoading(false);
    }, 1200);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={[styles.aiDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>AI Assistant</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: '#22C55E22' }]}>
          <Text style={[styles.statusText, { color: colors.success }]}>Online</Text>
        </View>
      </View>

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
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}
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
  suggestion: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  suggestionText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  inputBar: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10 },
  inputWrap: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 24, borderWidth: 1, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, gap: 8 },
  input: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', maxHeight: 100, paddingTop: 6, paddingBottom: 6 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
