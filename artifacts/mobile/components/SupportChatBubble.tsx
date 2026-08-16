/**
 * SupportChatBubble — AI-powered support chatbot floating entry point.
 *
 * - Floating teal bubble (bottom-left, distinct from seller AIBrainFAB)
 * - Opens a full Modal chat interface — works across all screens without navigation
 * - Account-aware: backend pulls real seller/buyer data as context
 * - Escalation: one tap creates a human support ticket
 * - PII-safe: AI prompt enforces last-4-digits-only rule for bank accounts
 */
import React, {
  useState, useRef, useCallback, useEffect, memo,
} from 'react';
import {
  View, Text, Modal, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Animated,
  Keyboard, ActivityIndicator, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import {
  BG, CARD, SURFACE, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_DIM,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';

// ─── Teal brand color for support (distinct from AI Brain purple) ─────────────
const TEAL        = '#22D3EE';
const TEAL_DIM    = 'rgba(34,211,238,0.15)';
const TEAL_BORDER = 'rgba(34,211,238,0.30)';
const SUCCESS_GRN = '#34D399';

// ─── Types ────────────────────────────────────────────────────────────────────
type MsgRole = 'user' | 'assistant' | 'system';

interface ChatMsg {
  id:        string;
  role:      MsgRole;
  content:   string;
  ts:        number;
  isError?:  boolean;
}

// ─── Streaming Dots ───────────────────────────────────────────────────────────
function StreamingDots() {
  const d = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = d.map((dot, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 150),
        Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(600 - i * 150),
      ]))
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  }, []);
  return (
    <View style={s.dotsRow}>
      {d.map((dot, i) => <Animated.View key={i} style={[s.dot, { opacity: dot }]} />)}
    </View>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
const MessageBubble = memo(({ msg }: { msg: ChatMsg }) => {
  const isUser = msg.role === 'user';
  return (
    <View style={[s.msgRow, isUser && s.msgRowUser]}>
      {!isUser && (
        <View style={s.aiBadge}>
          <Feather name="headphones" size={12} color={TEAL} />
        </View>
      )}
      <View style={[
        s.bubble,
        isUser ? s.bubbleUser : s.bubbleAI,
        msg.isError && s.bubbleError,
      ]}>
        <Text style={[s.bubbleText, isUser ? s.bubbleTextUser : s.bubbleTextAI]}>
          {msg.content}
        </Text>
      </View>
    </View>
  );
});

// ─── Quick reply chips ────────────────────────────────────────────────────────
const QUICK_REPLIES = [
  { label: 'Why is my payout on hold?',   icon: 'clock' as const },
  { label: 'How do drops work?',          icon: 'zap' as const },
  { label: 'How do I get paid?',          icon: 'dollar-sign' as const },
  { label: 'Track my order',             icon: 'package' as const },
  { label: 'Manufacturer Hub help',       icon: 'tool' as const },
  { label: 'Talk to a human',            icon: 'user' as const },
];

// ─── Main Chat Modal ──────────────────────────────────────────────────────────
function SupportChatModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const api    = useApi();
  const flatRef = useRef<FlatList>(null);

  const [msgs, setMsgs]           = useState<ChatMsg[]>([]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [escalated, setEscalated] = useState(false);

  // Seed welcome message when modal opens
  useEffect(() => {
    if (!visible) return;
    if (msgs.length === 0) {
      setMsgs([{
        id:      'welcome',
        role:    'assistant',
        content: "Hi! I'm the Brandthread Support AI 👋\n\nI can answer questions about your orders, payouts, drops, live shopping, the Manufacturer Hub, and more — using your real account data.\n\nWhat can I help you with?",
        ts:      Date.now(),
      }]);
    }
  }, [visible]);

  const uid = () => Math.random().toString(36).slice(2);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: ChatMsg = { id: uid(), role: 'user', content: text.trim(), ts: Date.now() };
    setMsgs(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Build history for API (exclude welcome / system messages)
    const history = [...msgs, userMsg]
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const resp = await api.supportChat.send(history);

      const aiMsg: ChatMsg = {
        id:      uid(),
        role:    'assistant',
        content: resp.content ?? "I'm sorry, I didn't get a response. Please try again.",
        ts:      Date.now(),
      };
      setMsgs(prev => [...prev, aiMsg]);

      // Auto-escalate if AI signals it
      if (resp.shouldEscalate) {
        await handleEscalate(resp.escalateReason ?? "Requested via AI chat", [...msgs, userMsg, aiMsg]);
      }
    } catch {
      setMsgs(prev => [...prev, {
        id: uid(), role: 'assistant', isError: true, ts: Date.now(),
        content: "Sorry, I'm having trouble connecting right now. Please try again, or tap 'Escalate' to reach a human.",
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [msgs, loading, api]);

  async function handleEscalate(reason?: string, history?: ChatMsg[]) {
    if (escalated || escalating) return;
    setEscalating(true);
    const snippet = (history ?? msgs)
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
      .join('\n');
    try {
      await api.supportChat.escalate(reason ?? "User requested human support", snippet);
      setEscalated(true);
      setMsgs(prev => [...prev, {
        id: uid(), role: 'assistant', ts: Date.now(),
        content: "✅ I've flagged your case for our human support team. You'll receive a reply at your account email within 2 business hours.",
      }]);
    } catch {
      setMsgs(prev => [...prev, {
        id: uid(), role: 'assistant', isError: true, ts: Date.now(),
        content: "Couldn't create a ticket automatically. Please email us directly at support@brandthread.app",
      }]);
    } finally {
      setEscalating(false);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[s.modal, { paddingTop: Platform.OS === 'android' ? 24 : 0 }]}>
        {/* Header */}
        <View style={s.modalHeader}>
          <View style={s.headerLeft}>
            <View style={s.headerIcon}>
              <Feather name="headphones" size={16} color={TEAL} />
            </View>
            <View>
              <Text style={s.headerTitle}>Brandthread Support</Text>
              <Text style={s.headerSub}>AI-powered · Account-aware</Text>
            </View>
          </View>
          <View style={s.headerActions}>
            {!escalated && (
              <TouchableOpacity
                style={s.escalateBtn}
                onPress={() => handleEscalate()}
                disabled={escalating}
                activeOpacity={0.8}
              >
                {escalating
                  ? <ActivityIndicator size="small" color={TEAL} />
                  : <><Feather name="user" size={13} color={TEAL} /><Text style={s.escalateBtnText}>Human</Text></>
                }
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Feather name="x" size={20} color={MUTED} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Escalated banner */}
        {escalated && (
          <View style={s.escalatedBanner}>
            <Feather name="check-circle" size={14} color={SUCCESS_GRN} />
            <Text style={s.escalatedText}>Ticket submitted — reply within 2 business hours</Text>
          </View>
        )}

        {/* Messages */}
        <FlatList
          ref={flatRef}
          data={msgs}
          keyExtractor={m => m.id}
          renderItem={({ item }) => <MessageBubble msg={item} />}
          contentContainerStyle={s.msgList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
          ListFooterComponent={loading ? (
            <View style={[s.msgRow]}>
              <View style={s.aiBadge}>
                <Feather name="headphones" size={12} color={TEAL} />
              </View>
              <View style={[s.bubble, s.bubbleAI, { paddingVertical: 14 }]}>
                <StreamingDots />
              </View>
            </View>
          ) : null}
        />

        {/* Quick replies — only show when no conversation yet */}
        {msgs.length <= 1 && !loading && (
          <View style={s.quickReplies}>
            <FlatList
              horizontal
              data={QUICK_REPLIES}
              keyExtractor={q => q.label}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.quickChip}
                  onPress={() => sendMessage(item.label)}
                  activeOpacity={0.8}
                >
                  <Feather name={item.icon} size={12} color={TEAL} />
                  <Text style={s.quickChipText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {/* Input */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <View style={[s.inputRow, { paddingBottom: insets.bottom + 8 }]}>
            <TextInput
              style={s.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask anything about your account…"
              placeholderTextColor={SUBTLE}
              multiline
              maxLength={800}
              returnKeyType="send"
              onSubmitEditing={() => sendMessage(input)}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnDisabled]}
              onPress={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              activeOpacity={0.85}
            >
              <Feather name="send" size={16} color={input.trim() && !loading ? '#000' : SUBTLE} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Floating Bubble ──────────────────────────────────────────────────────────
interface SupportChatBubbleProps {
  /** Extra bottom offset — pass tab-bar height when sitting inside a tab layout */
  bottomOffset?: number;
  /** Optional right offset override — defaults to left-aligned */
  side?: 'left' | 'right';
}

export default function SupportChatBubble({ bottomOffset = 0, side = 'left' }: SupportChatBubbleProps) {
  const insets  = useSafeAreaInsets();
  const scale   = useRef(new Animated.Value(1)).current;
  const [open, setOpen] = useState(false);

  // Hide when keyboard is up
  const [kbVisible, setKbVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKbVisible(true));
    const hide  = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.88, duration: 80, useNativeDriver: true }),
      Animated.spring(scale,  { toValue: 1,    useNativeDriver: true, damping: 10 }),
    ]).start();
    setOpen(true);
  }

  if (kbVisible || Platform.OS === 'web') return null;

  const positionStyle = side === 'left'
    ? { left: 16 }
    : { right: 16 };

  return (
    <>
      <Animated.View
        style={[
          s.fab,
          positionStyle,
          {
            bottom: insets.bottom + bottomOffset + 12,
            transform: [{ scale }],
          },
        ]}
        pointerEvents="box-none"
      >
        <Pressable onPress={handlePress} style={s.fabInner}>
          <Feather name="headphones" size={22} color="#000" />
        </Pressable>
      </Animated.View>

      <SupportChatModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Fab
  fab:        { position: 'absolute', zIndex: 999 },
  fabInner:   {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: TEAL,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: TEAL, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },

  // Modal
  modal:      { flex: 1, backgroundColor: BG },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon:  {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: TEAL_DIM, borderWidth: 1, borderColor: TEAL_BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  headerSub:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  escalateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: TEAL_BORDER, backgroundColor: TEAL_DIM,
  },
  escalateBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: TEAL },

  escalatedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16,
    paddingVertical: 8, backgroundColor: 'rgba(52,211,153,0.10)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(52,211,153,0.20)',
  },
  escalatedText: { fontSize: FS.xs, fontFamily: FONT.medium, color: SUCCESS_GRN, flex: 1 },

  // Messages
  msgList:     { padding: 16, gap: 10, paddingBottom: 8 },
  msgRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 4 },
  msgRowUser:  { flexDirection: 'row-reverse' },
  aiBadge:    {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: TEAL_DIM, borderWidth: 1, borderColor: TEAL_BORDER,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  bubble:      { maxWidth: '78%', borderRadius: 16, padding: 12 },
  bubbleUser:  { backgroundColor: TEAL, borderBottomRightRadius: 4 },
  bubbleAI:    { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderBottomLeftRadius: 4 },
  bubbleError: { borderColor: 'rgba(239,68,68,0.40)', backgroundColor: 'rgba(239,68,68,0.08)' },
  bubbleText:  { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  bubbleTextUser: { color: '#000', fontFamily: FONT.medium },
  bubbleTextAI:   { color: FG },

  // Streaming dots
  dotsRow:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: TEAL },

  // Quick replies
  quickReplies: { paddingVertical: 10 },
  quickChip:    {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: TEAL_DIM, borderWidth: 1, borderColor: TEAL_BORDER,
  },
  quickChipText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: TEAL },

  // Input
  inputRow:    {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  input:       {
    flex: 1, backgroundColor: SURFACE, borderRadius: 20, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
    maxHeight: 100,
  },
  sendBtn:       {
    width: 40, height: 40, borderRadius: 20, backgroundColor: TEAL,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: SURFACE },
});
