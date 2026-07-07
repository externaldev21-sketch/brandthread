import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, StyleSheet,
  Text, TextInput, TouchableOpacity, useColorScheme, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  FRIENDS, Message,
  getMessages, getUnread, isTyping, markRead, sendMessage, subscribe,
} from '@/lib/chatStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: number) {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

function formatDay(ts: number) {
  const d    = new Date(ts);
  const now  = new Date();
  const diff = Math.floor((now.getTime() - ts) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function Bubble({ msg, prevMsg, isDark, friendColor }: {
  msg: Message;
  prevMsg: Message | null;
  isDark: boolean;
  friendColor: string;
}) {
  const fg       = isDark ? '#F0EEFF' : '#1A1035';
  const cardBg   = isDark ? '#1A1A2E' : '#F0EEFF';
  const mutedFg  = isDark ? '#6B6B8A' : '#8080A0';

  // Show day divider if first message or >6 hour gap or different day
  const showDivider = !prevMsg
    || (msg.ts - prevMsg.ts > 6 * 3_600_000)
    || (new Date(msg.ts).toDateString() !== new Date(prevMsg.ts).toDateString());

  // Show time under bubble if last in a run from same sender
  const isMe = msg.fromMe;

  return (
    <>
      {showDivider && (
        <View style={bub.dividerRow}>
          <View style={[bub.dividerLine, { backgroundColor: isDark ? '#2A2A40' : '#E0DDEE' }]} />
          <Text style={[bub.dividerText, { color: mutedFg }]}>{formatDay(msg.ts)}</Text>
          <View style={[bub.dividerLine, { backgroundColor: isDark ? '#2A2A40' : '#E0DDEE' }]} />
        </View>
      )}

      <View style={[bub.row, isMe ? bub.rowMe : bub.rowThem]}>
        {isMe ? (
          <LinearGradient
            colors={['#A855F7', '#7C3AED']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[bub.bubble, bub.bubbleMe]}
          >
            <Text style={bub.textMe}>{msg.text}</Text>
          </LinearGradient>
        ) : (
          <View style={[bub.bubble, bub.bubbleThem, { backgroundColor: cardBg }]}>
            <Text style={[bub.textThem, { color: fg }]}>{msg.text}</Text>
          </View>
        )}
      </View>

      <Text style={[
        bub.timestamp,
        { color: mutedFg },
        isMe ? { textAlign: 'right', paddingRight: 16 } : { textAlign: 'left', paddingLeft: 16 },
      ]}>
        {formatTime(msg.ts)}
        {isMe && msg.status === 'delivered' && '  ✓'}
        {isMe && msg.status === 'read'      && '  ✓✓'}
      </Text>
    </>
  );
}

const bub = StyleSheet.create({
  row:         { paddingHorizontal: 12, marginTop: 2 },
  rowMe:       { alignItems: 'flex-end' },
  rowThem:     { alignItems: 'flex-start' },
  bubble:      { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, marginBottom: 2 },
  bubbleMe:    { borderRadius: 20, borderBottomRightRadius: 5 },
  bubbleThem:  { borderRadius: 20, borderBottomLeftRadius: 5 },
  textMe:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#FFFFFF', lineHeight: 21 },
  textThem:    { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  timestamp:   { fontSize: 10, fontFamily: 'Inter_400Regular', marginBottom: 6, paddingHorizontal: 4 },
  dividerRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16, paddingHorizontal: 20 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
});

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator({ isDark }: { isDark: boolean }) {
  const [dots, setDots] = useState('•');
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '•' : d + '•'), 400);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={[ty.wrap, { backgroundColor: isDark ? '#1A1A2E' : '#F0EEFF' }]}>
      <Text style={[ty.dots, { color: isDark ? '#9F7AEA' : '#7C3AED' }]}>{dots}</Text>
    </View>
  );
}

const ty = StyleSheet.create({
  wrap: { alignSelf: 'flex-start', marginLeft: 24, marginTop: 6, marginBottom: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderBottomLeftRadius: 5 },
  dots: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: 3 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';
  const insets  = useSafeAreaInsets();
  const router  = useRouter();

  const friend = FRIENDS[id ?? ''];

  const [messages, setMessages] = useState<Message[]>(() => getMessages(id ?? ''));
  const [typing,   setTyping]   = useState(false);
  const [text,     setText]     = useState('');
  const listRef = useRef<FlatList>(null);

  const bg      = isDark ? '#08080F' : '#F4F3FA';
  const headerBg = isDark ? '#111118' : '#FFFFFF';
  const border  = isDark ? '#1A1A28' : '#E8E6F0';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#8080A0';
  const inputBg = isDark ? '#1A1A2E' : '#FFFFFF';

  // Subscribe to store updates
  useEffect(() => {
    const unsub = subscribe(() => {
      setMessages([...getMessages(id ?? '')]);
      setTyping(isTyping(id ?? ''));
    });
    markRead(id ?? '');
    return unsub;
  }, [id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length, typing]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !id) return;
    setText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMessage(id, trimmed);
  }, [text, id]);

  if (!friend) return null;

  const data: Array<Message | { _typing: true }> = [
    ...messages,
    ...(typing ? [{ _typing: true as const }] : []),
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[s.header, { backgroundColor: headerBg, borderBottomColor: border, paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={26} color={isDark ? '#9F7AEA' : '#7C3AED'} />
        </TouchableOpacity>

        <TouchableOpacity style={s.headerCenter} activeOpacity={0.85}>
          <View style={{ position: 'relative' }}>
            <View style={[s.headerAvatar, { backgroundColor: friend.color }]}>
              <Text style={s.headerInitials}>{friend.initials}</Text>
            </View>
            {friend.online && <View style={[s.onlineDot, { borderColor: headerBg }]} />}
          </View>
          <View>
            <Text style={[s.headerName, { color: fg }]}>{friend.name}</Text>
            <Text style={[s.headerStatus, { color: muted }]}>
              {friend.online ? 'Active now' : 'Offline'}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[s.headerBtn, { borderColor: border }]} activeOpacity={0.7}>
            <Feather name="phone" size={17} color={muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.headerBtn, { borderColor: border }]} activeOpacity={0.7}>
            <Feather name="video" size={17} color={muted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(item, i) => ('_typing' in item ? 'typing' : item.id)}
        style={{ flex: 1, backgroundColor: bg }}
        contentContainerStyle={{ paddingVertical: 12 }}
        keyboardDismissMode="interactive"
        renderItem={({ item, index }) => {
          if ('_typing' in item) {
            return <TypingIndicator isDark={isDark} />;
          }
          const prev = index > 0 && !('_typing' in data[index - 1])
            ? (data[index - 1] as Message) : null;
          return (
            <Bubble
              msg={item}
              prevMsg={prev}
              isDark={isDark}
              friendColor={friend.color}
            />
          );
        }}
      />

      {/* Input */}
      <View style={[s.inputRow, { backgroundColor: headerBg, borderTopColor: border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={[s.inputWrap, { backgroundColor: inputBg, borderColor: border }]}>
          <TextInput
            style={[s.input, { color: fg }]}
            value={text}
            onChangeText={setText}
            placeholder={`Message ${friend.name.split(' ')[0]}…`}
            placeholderTextColor={muted}
            multiline
            maxLength={500}
            returnKeyType="default"
          />
        </View>
        <TouchableOpacity
          onPress={handleSend}
          activeOpacity={text.trim() ? 0.8 : 0.4}
          disabled={!text.trim()}
        >
          <LinearGradient
            colors={text.trim() ? ['#A855F7', '#7C3AED'] : [isDark ? '#2A2A40' : '#E0DDEE', isDark ? '#2A2A40' : '#E0DDEE']}
            style={s.sendBtn}
          >
            <Feather name="send" size={17} color={text.trim() ? '#FFFFFF' : muted} />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1,
  },
  backBtn:      { padding: 4 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerInitials: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },
  onlineDot: { position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: '#22C55E', borderWidth: 2 },
  headerName:   { fontSize: 15, fontFamily: 'Inter_700Bold' },
  headerStatus: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  headerBtn:    { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1 },
  inputWrap: { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 6, maxHeight: 110 },
  input:     { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  sendBtn:   { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
