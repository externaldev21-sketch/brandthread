import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import type { Conversation, Message } from '@/services/socialTypes';
import { FS } from '@/lib/theme';
import { confirmUnblock } from '@/lib/safety';
import {
  BlockedComposer, openConversationOptions, openMessageOptions, REMOVED_MESSAGE_TEXT,
  type DmMessagingState,
} from '@/components/safety/DmSafety';

type ChatMessage = Omit<Message, 'status'> & {
  status: 'sent' | 'delivered' | 'read' | 'failed';
  removedByModeration?: boolean;
};

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

function Bubble({ msg, prevMsg, isDark, currentUserId, onLongPress }: {
  msg: ChatMessage;
  prevMsg: ChatMessage | null;
  isDark: boolean;
  currentUserId: string | null | undefined;
  onLongPress?: (msg: ChatMessage) => void;
}) {
  const colors = useColors();
  const fg       = isDark ? '#F7F7FA' : '#0A0A0B';
  const cardBg   = isDark ? '#1D1A15' : '#EDE7D9';
  const mutedFg  = isDark ? '#8C8577' : '#8080A0';

  // Show day divider if first message or >6 hour gap or different day
  const showDivider = !prevMsg
    || (msg.ts - prevMsg.ts > 6 * 3_600_000)
    || (new Date(msg.ts).toDateString() !== new Date(prevMsg.ts).toDateString());

  // Show time under bubble if last in a run from same sender
  const isMe = msg.fromId === currentUserId;

  return (
    <>
      {showDivider && (
        <View style={bub.dividerRow}>
          <View style={[bub.dividerLine, { backgroundColor: isDark ? '#2A261E' : '#E8E1CF' }]} />
          <Text style={[bub.dividerText, { color: mutedFg }]}>{formatDay(msg.ts)}</Text>
          <View style={[bub.dividerLine, { backgroundColor: isDark ? '#2A261E' : '#E8E1CF' }]} />
        </View>
      )}

      <TouchableOpacity
        style={[bub.row, isMe ? bub.rowMe : bub.rowThem]}
        activeOpacity={0.9}
        disabled={isMe || msg.removedByModeration || !onLongPress}
        onLongPress={() => onLongPress?.(msg)}
        delayLongPress={350}
        accessibilityHint={isMe ? undefined : 'Long press to report this message'}
      >
        {msg.removedByModeration ? (
          <View style={[bub.bubble, bub.bubbleThem, { backgroundColor: 'transparent', borderWidth: 1, borderColor: mutedFg + '55' }]}>
            <Text style={[bub.textThem, { color: mutedFg, fontStyle: 'italic', fontSize: 13 }]}>{REMOVED_MESSAGE_TEXT}</Text>
          </View>
        ) : isMe ? (
          <LinearGradient
            colors={[colors.accent, colors.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[bub.bubble, bub.bubbleMe]}
          >
            <Text style={[bub.textMe, { color: colors.primaryForeground }]}>{msg.text}</Text>
          </LinearGradient>
        ) : (
          <View style={[bub.bubble, bub.bubbleThem, { backgroundColor: cardBg }]}>
            <Text style={[bub.textThem, { color: fg }]}>{msg.text}</Text>
          </View>
        )}
      </TouchableOpacity>

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
  textMe:      { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  textThem:    { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  timestamp:   { fontSize: FS.xs, fontFamily: 'Inter_400Regular', marginBottom: 6, paddingHorizontal: 4 },
  dividerRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16, paddingHorizontal: 20 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Brandthread is dark-only (app.json userInterfaceStyle: "dark"); web must
  // not fall back to the light palette when the browser prefers light.
  const isDark  = true;
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const colors = useColors();
  const api = useApi();
  const { userId } = useAuth();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text,     setText]     = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [messaging, setMessaging] = useState<DmMessagingState>({ blockedByMe: false, unavailable: false });
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const bg      = isDark ? '#121110' : '#F4F3FA';
  const headerBg = isDark ? '#1B1917' : '#FFFFFF';
  const border  = isDark ? '#1A1A28' : '#E3DCC9';
  const fg      = isDark ? '#F7F7FA' : '#0A0A0B';
  const muted   = isDark ? '#8C8577' : '#8080A0';
  const inputBg = isDark ? '#1D1A15' : '#FFFFFF';

  useEffect(() => {
    let active = true;
    if (!id) {
      setConversation(null);
      setMessages([]);
      setLoadError(null);
      setIsLoading(false);
      return;
    }
    if (!userId) {
      setConversation(null);
      setMessages([]);
      setLoadError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    setSendError(null);
    (async () => {
      try {
        const [loadedConversation, loadedMessages] = await Promise.all([
          api.conversations.get(id),
          api.conversations.messages(id),
        ]);
        if (!active) return;
        setConversation(loadedConversation as Conversation);
        const safety = (loadedConversation as { messaging?: DmMessagingState }).messaging;
        setMessaging({ blockedByMe: !!safety?.blockedByMe, unavailable: !!safety?.unavailable });
        setMessages((Array.isArray(loadedMessages) ? loadedMessages : []) as ChatMessage[]);
        try {
          await api.conversations.markRead(id);
        } catch (error) {
          // Mark-read failures are not user-facing; log only.
          if (__DEV__) console.warn('Could not mark messages as read', error);
        }
      } catch (error) {
        if (active) {
          setConversation(null);
          setMessages([]);
          setLoadError(null);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [api, id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !id || !conversation || isSending) return;
    setText('');
    setSendError(null);
    setIsSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const canonicalMessage = await api.conversations.send(id, { text: trimmed });
      setMessages((current) => [
        ...current.filter((message) => message.id !== canonicalMessage.id),
        canonicalMessage as ChatMessage,
      ]);
    } catch (error) {
      setText(trimmed);
      setSendError('Message not sent. Tap send to retry.');
    } finally {
      setIsSending(false);
    }
  }, [api, conversation, id, isSending, text]);

  const participant = conversation?.participants.find((item) => item.userId !== userId)
    ?? conversation?.participants[0];

  if (isLoading) {
    return <View style={[s.state, { backgroundColor: bg }]}><Text style={[s.stateText, { color: muted }]}>Loading conversation…</Text></View>;
  }

  if (!conversation || !participant) {
    return (
      <View style={[s.state, { backgroundColor: bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={[s.stateButton, { borderColor: border }]}>
          <Text style={[s.stateButtonText, { color: colors.primary }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[s.header, { backgroundColor: headerBg, borderBottomColor: border, paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={26} color={colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity style={s.headerCenter} activeOpacity={0.85}>
          <View style={{ position: 'relative' }}>
             <View style={[s.headerAvatar, { backgroundColor: participant.color }]}>
               <Text style={s.headerInitials}>{participant.initials}</Text>
            </View>
          </View>
          <View>
             <Text style={[s.headerName, { color: fg }]}>{participant.name}</Text>
            <Text style={[s.headerStatus, { color: muted }]}>
               {conversation.isRequest ? 'Message request' : 'Conversation'}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.headerBtn, { borderColor: border }]}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Conversation options"
          onPress={() => openConversationOptions({
            router,
            social: api.social,
            counterpart: { userId: participant.userId, name: participant.name },
            messaging,
            onChange: setMessaging,
          })}
        >
          <Feather name="more-horizontal" size={17} color={fg} />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
         data={messages}
         keyExtractor={(item) => item.id}
        style={{ flex: 1, backgroundColor: bg }}
        contentContainerStyle={{ paddingVertical: 12 }}
        keyboardDismissMode="interactive"
         ListHeaderComponent={sendError ? (
           <View style={[s.errorBanner, { backgroundColor: isDark ? '#3A1F20' : '#FDE8E8' }]}>
             <Text style={[s.errorText, { color: isDark ? '#FCA5A5' : '#B91C1C' }]}>{sendError}</Text>
           </View>
         ) : null}
         ListEmptyComponent={
           <View style={s.emptyMessages}>
             <Text style={[s.emptyMessagesText, { color: muted }]}>No messages yet.</Text>
           </View>
         }
        renderItem={({ item, index }) => {
           const prev = index > 0 ? messages[index - 1] : null;
          return (
            <Bubble
              msg={item}
              prevMsg={prev}
              isDark={isDark}
               currentUserId={userId}
              onLongPress={(message) => openMessageOptions({
                router,
                messageId: message.id,
                text: message.text,
                counterpart: { userId: participant.userId, name: participant.name },
              })}
            />
          );
        }}
      />

      {/* Input */}
      {messaging.blockedByMe || messaging.unavailable ? (
        <BlockedComposer
          counterpartName={participant.name}
          messaging={messaging}
          bottomInset={insets.bottom}
          onUnblock={async () => {
            if (await confirmUnblock({ userId: participant.userId, name: participant.name }, api.social.unblock)) {
              setMessaging((current) => ({ ...current, blockedByMe: false }));
            }
          }}
        />
      ) : (
      <View style={[s.inputRow, { backgroundColor: headerBg, borderTopColor: border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={[s.inputWrap, { backgroundColor: inputBg, borderColor: border }]}>
          <TextInput
            style={[s.input, { color: fg }]}
            value={text}
            onChangeText={setText}
             placeholder={`Message ${participant.name.split(' ')[0]}…`}
            placeholderTextColor={muted}
            multiline
            maxLength={500}
            returnKeyType="default"
          />
        </View>
        <TouchableOpacity
          onPress={handleSend}
          activeOpacity={text.trim() ? 0.8 : 0.4}
           disabled={!text.trim() || isSending}
        >
          <LinearGradient
            colors={text.trim() ? [colors.accent, colors.primary] : [isDark ? '#2A261E' : '#E8E1CF', isDark ? '#2A261E' : '#E8E1CF']}
            style={s.sendBtn}
          >
            <Feather name="send" size={17} color={text.trim() ? colors.primaryForeground : muted} />
          </LinearGradient>
        </TouchableOpacity>
      </View>
      )}
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
  onlineDot: { position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: '#10B981', borderWidth: 2 },
  headerName:   { fontSize: 15, fontFamily: 'Inter_700Bold' },
  headerStatus: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  headerBtn:    { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1 },
  inputWrap: { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 6, maxHeight: 110 },
  input:     { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  sendBtn:   { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  errorBanner: { marginHorizontal: 14, marginBottom: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  errorText: { fontSize: 12, fontFamily: 'Inter_500Medium', lineHeight: 17 },
  emptyMessages: { alignItems: 'center', paddingTop: 40 },
  emptyMessagesText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  stateTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', marginTop: 4 },
  stateText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  stateButton: { marginTop: 8, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 9 },
  stateButtonText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
