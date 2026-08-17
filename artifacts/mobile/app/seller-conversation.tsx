/**
 * Seller Conversation — read a buyer thread and send replies.
 * Reads GET /api/conversations/:id/messages, sends via POST /api/conversations/:id/messages.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Alert, Platform, StyleSheet, Dimensions,
  ActivityIndicator, ListRenderItemInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useUser } from '@clerk/expo';
import {
  BG, CARD, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_DIM, ON_DARK, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useApi } from '@/lib/api';

interface Participant {
  userId: string; name: string; handle: string;
  initials: string; color: string; accountType: string;
}
interface ConvView {
  id: string; type: string; participants: Participant[];
  contextOrderId?: string; contextOrderNumber?: string; contextOrderStatus?: string;
  contextProductName?: string;
}
interface Msg {
  id: string; conversationId: string;
  fromId: string; fromName: string; fromInitials: string; fromColor: string;
  text: string; status: string; ts: number;
}

const SCREEN_W = Dimensions.get('window').width;
const BUBBLE_MAX = SCREEN_W * 0.75;

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return 'Today';
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

type ListRow = { type: 'date'; date: string } | { type: 'message'; msg: Msg };

function groupByDate(msgs: Msg[]): ListRow[] {
  const rows: ListRow[] = [];
  let last = '';
  for (const msg of msgs) {
    const d = formatDate(msg.ts);
    if (d !== last) { rows.push({ type: 'date', date: d }); last = d; }
    rows.push({ type: 'message', msg });
  }
  return rows;
}

export default function SellerConversationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();
  const myId = user?.id ?? '';
  const { id } = useLocalSearchParams<{ id?: string }>();

  const flatListRef = useRef<FlatList<ListRow>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [conv, setConv] = useState<ConvView | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!id) return;
    try {
      const msgs = await api.conversations.messages(id, 100);
      setMessages(msgs as Msg[]);
    } catch { /* keep last state while polling */ }
  }, [api, id]);

  const loadAll = useCallback(async () => {
    if (!id) { setIsLoading(false); return; }
    try {
      const [c] = await Promise.all([
        api.conversations.get(id),
        loadMessages(),
      ]);
      setConv(c as ConvView);
      api.conversations.markRead(id).catch(() => {});
    } catch (e) {
      console.error('Failed to load conversation', e);
    } finally {
      setIsLoading(false);
    }
  }, [api, id, loadMessages]);

  useFocusEffect(useCallback(() => {
    loadAll();
    pollRef.current = setInterval(loadMessages, 15_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadAll, loadMessages]));

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  const other = conv?.participants.find((p) => p.userId !== myId) ?? null;
  const canSend = text.trim().length > 0 && !isSending && !!id;

  async function handleSend() {
    if (!id || !canSend) return;
    const t = text.trim();
    setText('');
    setIsSending(true);
    try {
      const msg = await api.conversations.send(id, { text: t });
      setMessages((prev) => [...prev, msg as Msg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e: any) {
      const raw = String(e?.message ?? '');
      const friendly = raw.includes('MODERATED')
        ? 'This message was flagged by safety filters and was not sent.'
        : raw.includes('BLOCKED')
          ? 'Unable to send message.'
          : 'Failed to send message. Please try again.';
      Alert.alert('Not sent', friendly);
      setText(t);
    } finally {
      setIsSending(false);
    }
  }

  function renderItem({ item }: ListRenderItemInfo<ListRow>) {
    if (item.type === 'date') {
      return (
        <View style={s.dateWrap}>
          <View style={s.datePill}><Text style={s.dateText}>{item.date}</Text></View>
        </View>
      );
    }
    const { msg } = item;
    const isOwn = msg.fromId === myId;
    return (
      <View style={[s.msgOuter, { justifyContent: isOwn ? 'flex-end' : 'flex-start' }]}>
        {!isOwn && (
          <View style={[s.msgAvatar, { backgroundColor: msg.fromColor || PURPLE }]}>
            <Text style={s.msgAvatarInitials}>{msg.fromInitials || (msg.fromName?.[0] ?? '?')}</Text>
          </View>
        )}
        <View
          style={[
            s.bubble,
            {
              backgroundColor: isOwn ? PURPLE_DIM : CARD,
              borderColor: isOwn ? BORDER_ACTIVE : BORDER,
              borderBottomRightRadius: isOwn ? 4 : RADIUS.lg,
              borderBottomLeftRadius: isOwn ? RADIUS.lg : 4,
              maxWidth: BUBBLE_MAX,
            },
          ]}
        >
          <Text style={s.msgText}>{msg.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.headerBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={ICON.lg} color={FG} />
        </TouchableOpacity>
        {other && (
          <View style={[s.headerAvatar, { backgroundColor: other.color || PURPLE }]}>
            <Text style={s.headerAvatarInitials}>
              {other.initials || (other.name?.[0] ?? '?').toUpperCase()}
            </Text>
          </View>
        )}
        <View style={s.headerCenter}>
          <Text style={s.headerName} numberOfLines={1}>{other?.name ?? 'Buyer'}</Text>
          {other?.handle ? <Text style={s.headerHandle} numberOfLines={1}>{other.handle}</Text> : null}
        </View>
      </View>

      {/* Order context card */}
      {conv?.contextOrderNumber ? (
        <View style={s.orderCard}>
          <Feather name="package" size={ICON.md} color={PURPLE} />
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.orderNumber}>{conv.contextOrderNumber}</Text>
            {conv.contextProductName ? (
              <Text style={s.orderProduct} numberOfLines={1}>{conv.contextProductName}</Text>
            ) : null}
          </View>
          {conv.contextOrderStatus ? (
            <View style={s.orderBadge}><Text style={s.orderBadgeText}>{conv.contextOrderStatus}</Text></View>
          ) : null}
        </View>
      ) : null}

      {isLoading ? (
        <View style={s.centerFill}><ActivityIndicator color={PURPLE} /></View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groupByDate(messages)}
          keyExtractor={(item, i) => (item.type === 'date' ? `date-${item.date}-${i}` : item.msg.id)}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Input row */}
      <View style={[s.inputRow, { paddingBottom: insets.bottom + SP.sm }]}>
        <TextInput
          style={s.textInput}
          value={text}
          onChangeText={setText}
          placeholder="Reply..."
          placeholderTextColor={SUBTLE}
          multiline
          returnKeyType="default"
        />
        <TouchableOpacity
          style={[
            s.sendBtn,
            canSend
              ? { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE }
              : { backgroundColor: CARD, borderColor: BORDER },
          ]}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.8}
        >
          <Feather name="send" size={ICON.sm} color={canSend ? PURPLE : MUTED} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.md, paddingBottom: SP.sm,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerBack: { marginRight: SP.sm },
  headerAvatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', marginRight: SP.sm,
  },
  headerAvatarInitials: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  headerCenter: { flex: 1 },
  headerName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  headerHandle: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },

  orderCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: SP.md, marginVertical: SP.sm, padding: SP.sm,
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER,
  },
  orderNumber: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  orderProduct: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  orderBadge: {
    backgroundColor: PURPLE_DIM, borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
  },
  orderBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE },

  listContent: { paddingVertical: SP.sm, paddingBottom: SP.md },
  dateWrap: { alignItems: 'center', marginVertical: SP.md },
  datePill: {
    backgroundColor: CARD, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
  },
  dateText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  msgOuter: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: SP.md, marginBottom: SP.xs,
  },
  msgAvatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    marginRight: SP.sm, marginBottom: 2,
  },
  msgAvatarInitials: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  bubble: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SP.md },
  msgText: { fontSize: FS.base, fontFamily: FONT.regular, color: FG },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: SP.md, paddingTop: SP.sm, gap: SP.sm,
    borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: BG,
  },
  textInput: {
    flex: 1, backgroundColor: CARD, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    fontSize: FS.base, fontFamily: FONT.regular, color: FG, maxHeight: 120,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 2,
  },
});
