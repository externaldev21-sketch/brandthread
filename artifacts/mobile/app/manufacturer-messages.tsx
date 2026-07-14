/**
 * Manufacturer Messages Screen
 * Params: conversationId (string)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  getConversations, sendMessage, markConversationRead,
} from '@/services/manufacturerService';
import { ManufacturerConversation, ManufacturerMessage } from '@/services/manufacturerTypes';
import { BrandthreadHeader, GuidedTip, StatusBadge } from '@/components/BrandthreadUI';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_FOCUS,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, ORANGE, ORANGE_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type AttachType = null | 'quote' | 'sample' | 'production';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function attachIcon(type: ManufacturerMessage['attachmentType']): string {
  switch (type) {
    case 'quote': return '📋';
    case 'sample': return '🧵';
    case 'production': return '🏭';
    case 'product': return '📦';
    default: return '📎';
  }
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ManufacturerMessage }) {
  const isSeller = msg.senderType === 'seller';
  const isSystem = msg.senderType === 'system';
  const isInternal = msg.isInternalNote;

  if (isSystem) {
    return (
      <View style={bubS.systemWrap}>
        <Text style={bubS.systemText}>{msg.text}</Text>
        <Text style={bubS.timestamp}>{fmtTime(msg.createdAt)}</Text>
      </View>
    );
  }

  const bubbleStyle = isInternal
    ? bubS.internalBubble
    : isSeller
    ? bubS.sellerBubble
    : bubS.mfgBubble;

  return (
    <View style={[bubS.row, isSeller ? bubS.rowRight : bubS.rowLeft]}>
      <View style={{ maxWidth: '78%' }}>
        {isInternal && (
          <Text style={bubS.internalLabel}>🔒 Internal note</Text>
        )}
        <View style={[bubS.bubble, bubbleStyle]}>
          <Text style={[bubS.msgText, isSeller && { color: '#fff' }]}>{msg.text}</Text>
        </View>
        {msg.attachmentType && (
          <View style={bubS.attachCard}>
            <Text style={bubS.attachIcon}>{attachIcon(msg.attachmentType)}</Text>
            <View>
              <Text style={bubS.attachLabel}>{msg.attachmentLabel ?? msg.attachmentType}</Text>
              <Text style={bubS.attachSub}>{msg.attachmentType}</Text>
            </View>
          </View>
        )}
        <Text style={[bubS.timestamp, isSeller ? { textAlign: 'right' } : {}]}>
          {fmtTime(msg.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const bubS = StyleSheet.create({
  row: { marginVertical: 3, paddingHorizontal: SP.md },
  rowRight: { flexDirection: 'row', justifyContent: 'flex-end' },
  rowLeft:  { flexDirection: 'row', justifyContent: 'flex-start' },
  bubble: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    maxWidth: '100%',
  },
  sellerBubble: {
    backgroundColor: PURPLE,
    borderBottomRightRadius: 4,
  },
  mfgBubble: {
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    borderBottomLeftRadius: 4,
  },
  internalBubble: {
    backgroundColor: ORANGE_DIM,
    borderWidth: 1,
    borderColor: ORANGE + '50',
    borderBottomRightRadius: 4,
  },
  msgText: {
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
    lineHeight: 20,
  },
  systemWrap: {
    alignItems: 'center',
    marginVertical: SP.sm,
    paddingHorizontal: SP.lg,
  },
  systemText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  internalLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: ORANGE,
    marginBottom: 3,
    textAlign: 'right',
  },
  timestamp: {
    fontSize: 10,
    fontFamily: FONT.regular,
    color: SUBTLE,
    marginTop: 3,
  },
  attachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.sm,
    marginTop: 4,
  },
  attachIcon: { fontSize: 20 },
  attachLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  attachSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
});

// ─── Attachment Chip ──────────────────────────────────────────────────────────

function AttachChip({ type, onRemove }: { type: AttachType; onRemove: () => void }) {
  if (!type) return null;
  const labels: Record<string, string> = { quote: 'Quote', sample: 'Sample', production: 'Production' };
  return (
    <View style={chipS.root}>
      <Text style={chipS.text}>{attachIcon(type as any)} {labels[type]}</Text>
      <TouchableOpacity onPress={onRemove} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Feather name="x" size={12} color={MUTED} />
      </TouchableOpacity>
    </View>
  );
}

const chipS = StyleSheet.create({
  root: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start',
  },
  text: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ManufacturerMessagesScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [conversation, setConversation] = useState<ManufacturerConversation | null>(null);
  const [messages, setMessages] = useState<ManufacturerMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachType, setAttachType] = useState<AttachType>(null);
  const [tipDismissed, setTipDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  const inputRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    if (!conversationId) return;
    const convs = await getConversations();
    const conv = convs.find(c => c.id === conversationId);
    if (conv) {
      setConversation(conv);
      setMessages([...conv.messages].reverse());
      await markConversationRead(conversationId);
    }
    setLoading(false);
  }, [conversationId]);

  useEffect(() => { load(); }, [load]);

  async function handleSend() {
    const text = inputText.trim();
    if (!text || !conversationId) return;
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const msg = await sendMessage(conversationId, {
        text,
        attachmentType: attachType ?? undefined,
        attachmentLabel: attachType ? attachType.charAt(0).toUpperCase() + attachType.slice(1) : undefined,
        isInternalNote: false,
      });
      setMessages(prev => [msg, ...prev]);
      setInputText('');
      setAttachType(null);
    } catch (e) {
      Alert.alert('Error', 'Could not send message.');
    }
    setSending(false);
  }

  async function handleSendInternal() {
    const text = inputText.trim();
    if (!text || !conversationId) return;
    setSending(true);
    try {
      const msg = await sendMessage(conversationId, {
        text,
        isInternalNote: true,
      });
      setMessages(prev => [msg, ...prev]);
      setInputText('');
      setAttachType(null);
    } catch {}
    setSending(false);
  }

  function handleAttachPress() {
    Alert.alert('Attach', 'Choose attachment type', [
      { text: 'Attach Quote', onPress: () => setAttachType('quote') },
      { text: 'Attach Sample', onPress: () => setAttachType('sample') },
      { text: 'Attach Production', onPress: () => setAttachType('production') },
      { text: 'Internal Note', onPress: () => {
        Alert.alert('Internal Note', 'Type your note and it will be marked as internal.', [
          { text: 'OK', onPress: () => inputRef.current?.focus() },
        ]);
      }},
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={PURPLE} />
      </View>
    );
  }

  if (!conversation) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top }}>
        <BrandthreadHeader title="Messages" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: MUTED, fontFamily: FONT.regular }}>Conversation not found.</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={{ paddingTop: insets.top, backgroundColor: BG, borderBottomWidth: 1, borderBottomColor: BORDER }}>
        <BrandthreadHeader
          title={conversation.manufacturerName}
          subtitle={conversation.contextLabel ?? undefined}
          onBack={() => router.back()}
          rightElement={
            conversation.contextLabel ? (
              <StatusBadge label={conversation.contextLabel} variant="purple" small />
            ) : undefined
          }
        />
      </View>

      {/* Demo tip */}
      {!tipDismissed && (
        <GuidedTip
          id="msg-demo"
          text="Messages are stored locally. Real-time sync available with backend."
          dismissedIds={[]}
          onDismiss={() => setTipDismissed(true)}
          style={{ marginTop: SP.sm }}
        />
      )}

      {/* Messages */}
      <FlatList
        data={messages}
        keyExtractor={m => m.id}
        inverted
        renderItem={({ item }) => <MessageBubble msg={item} />}
        contentContainerStyle={{ paddingVertical: SP.md }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <Text style={{ color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm }}>
              No messages yet. Say hello!
            </Text>
          </View>
        }
      />

      {/* Input Bar */}
      <View style={[s.inputArea, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        {attachType && (
          <View style={{ paddingHorizontal: SP.md, paddingBottom: SP.sm }}>
            <AttachChip type={attachType} onRemove={() => setAttachType(null)} />
          </View>
        )}
        <View style={s.inputRow}>
          <TouchableOpacity onPress={handleAttachPress} style={s.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 20 }}>📎</Text>
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={s.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Message…"
            placeholderTextColor={SUBTLE}
            multiline
            returnKeyType="default"
          />
          <TouchableOpacity
            onPress={handleSend}
            style={[s.sendBtn, (!inputText.trim() || sending) && { opacity: 0.4 }]}
            disabled={!inputText.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Feather name="send" size={ICON.sm} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────


const s = StyleSheet.create({
  inputArea: {
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: SP.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SP.sm,
    paddingHorizontal: SP.md,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
