import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Alert, Platform, StyleSheet, Dimensions,
  ListRenderItemInfo,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, ORANGE, RED, FONT, FS, SP, RADIUS, COMP, ICON,
  GRAD_PRIMARY,
} from '@/lib/theme';
import {
  getConversation, createOrGetConversation, getMessages,
  sendMessage, retryMessage, addReaction, deleteMessageForMe,
  markConversationRead, subscribeSocial,
  MY_USER_ID, MY_NAME, MY_INITIALS, MY_COLOR,
} from '@/services/socialService';
import type {
  Conversation, Message, MessageAttachment, ConversationParticipant,
} from '@/services/socialTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

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

type DateRow = { type: 'date'; date: string };
type MsgRow  = { type: 'message'; msg: Message };
type ListRow = DateRow | MsgRow;

function groupMessagesByDate(msgs: Message[]): ListRow[] {
  const rows: ListRow[] = [];
  let lastDate = '';
  for (const msg of msgs) {
    const d = formatDate(msg.ts);
    if (d !== lastDate) {
      rows.push({ type: 'date', date: d });
      lastDate = d;
    }
    rows.push({ type: 'message', msg });
  }
  return rows;
}

// ─── Attachment icon ──────────────────────────────────────────────────────────

function attachmentIcon(type: MessageAttachment['type']): keyof typeof Feather.glyphMap {
  switch (type) {
    case 'product': return 'shopping-bag';
    case 'order':   return 'package';
    case 'post':    return 'image';
    case 'profile': return 'user';
    default:        return 'paperclip';
  }
}

// ─── Screen width ─────────────────────────────────────────────────────────────

const SCREEN_W = Dimensions.get('window').width;
const BUBBLE_MAX = SCREEN_W * 0.75;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerConversationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string;
    participantId?: string;
    participantName?: string;
    participantHandle?: string;
    participantInitials?: string;
    participantColor?: string;
    participantAccountType?: string;
    type?: string;
    contextOrderId?: string;
    contextOrderNumber?: string;
    contextOrderStatus?: string;
    contextProductName?: string;
    contextSellerName?: string;
  }>();

  const flatListRef = useRef<FlatList<ListRow>>(null);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  // ── Load conversation + messages ────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      let loadedConv: Conversation | null = null;

      if (params.id) {
        loadedConv = await getConversation(params.id);
        if (loadedConv) await markConversationRead(loadedConv.id);
      } else if (params.participantId) {
        loadedConv = await createOrGetConversation({
          type: (params.type as Conversation['type']) ?? 'buyer_to_buyer',
          participant: {
            userId: params.participantId,
            name:   params.participantName   ?? '',
            handle: params.participantHandle ?? '',
            initials: params.participantInitials ?? '',
            color:  params.participantColor   ?? PURPLE,
            accountType: (params.participantAccountType as 'buyer' | 'seller') ?? 'buyer',
          },
          contextOrderId:     params.contextOrderId,
          contextOrderNumber: params.contextOrderNumber,
          contextOrderStatus: params.contextOrderStatus,
          contextProductName: params.contextProductName,
          contextSellerName:  params.contextSellerName,
        });
      }

      setConv(loadedConv);
      if (loadedConv) {
        const msgs = await getMessages(loadedConv.id);
        setMessages(msgs);
      }
    } catch (e) {
      console.error('Failed to load conversation', e);
    } finally {
      setIsLoading(false);
    }
  }, [params.id, params.participantId]);

  useFocusEffect(useCallback(() => {
    loadData();
  }, [loadData]));

  useEffect(() => {
    const unsub = subscribeSocial(() => {
      if (conv?.id) {
        getMessages(conv.id).then(setMessages);
      }
    });
    return unsub;
  }, [conv?.id]);

  // Scroll to end after messages load
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const participant = conv?.participants[0] ?? null;
  const displayName = participant?.name ?? params.participantName ?? 'Unknown';
  const displayHandle = participant?.handle ?? params.participantHandle ?? '';
  const isDisabled = conv?.isFriendshipActive === false;
  const canSend = text.trim().length > 0 && !isDisabled && !isSending;

  // Show "View store" button for any seller conversation (resolved or pre-created)
  const convType = conv?.type ?? params.type ?? '';
  const isSellerConv = convType === 'buyer_to_seller' || convType === 'buyer_to_seller_product';
  const sellerUserId = participant?.userId ?? params.participantId ?? '';

  // ── Send message ────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!conv || !canSend) return;
    const t = text.trim();
    setText('');
    setReplyTo(null);
    setIsSending(true);
    try {
      await sendMessage(conv.id, t);
      const msgs = await getMessages(conv.id);
      setMessages(msgs);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      Alert.alert('Error', 'Failed to send message. Please try again.');
      setText(t);
    } finally {
      setIsSending(false);
    }
  }

  // ── Header options ──────────────────────────────────────────────────────────

  function openOptions() {
    if (!participant) return;
    Alert.alert('Options', undefined, [
      {
        text: 'Archive conversation',
        onPress: async () => {
          const { archiveConversation } = await import('@/services/socialService');
          if (conv) await archiveConversation(conv.id);
          router.back();
        },
      },
      {
        text: 'Block user',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            `Block ${participant.name}?`,
            'They will no longer be able to message you.',
            [
              {
                text: 'Block',
                style: 'destructive',
                onPress: async () => {
                  const { blockUser } = await import('@/services/socialService');
                  await blockUser({
                    userId: participant.userId,
                    name: participant.name,
                    handle: participant.handle,
                    initials: participant.initials,
                    color: participant.color,
                  });
                  router.back();
                },
              },
              { text: 'Cancel', style: 'cancel' },
            ],
          );
        },
      },
      {
        text: 'Report',
        onPress: () => {
          router.push(`/buyer-report?targetType=profile&targetId=${participant.userId}&targetLabel=${encodeURIComponent(participant.name)}` as never);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Message long press ──────────────────────────────────────────────────────

  function longPressMessage(msg: Message) {
    const isOwn = msg.fromId === MY_USER_ID;
    const options: Alert['alert'] extends (t: string, m: string | undefined, b: infer B) => void ? B : never = [
      {
        text: 'Reply',
        onPress: () => setReplyTo(msg),
      },
      {
        text: 'React',
        onPress: () => {
          const EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
          Alert.alert('React', undefined, [
            ...EMOJIS.map(emoji => ({
              text: emoji,
              onPress: () => { if (conv) addReaction(conv.id, msg.id, emoji); },
            })),
            { text: 'Cancel', style: 'cancel' as const },
          ]
          );
        },
      },
      {
        text: 'Copy',
        onPress: () => {
          // Clipboard handled gracefully — no import needed for display
        },
      },
    ];
    if (isOwn) {
      options.push({
        text: 'Delete for me',
        style: 'destructive' as const,
        onPress: () => conv && deleteMessageForMe(conv.id, msg.id).then(() =>
          getMessages(conv.id).then(setMessages)
        ),
      });
    }
    options.push({
      text: 'Report',
      onPress: () => {
        router.push(`/buyer-report?targetType=message&targetId=${msg.id}&targetLabel=Message` as never);
      },
    });
    options.push({ text: 'Cancel', style: 'cancel' as const, onPress: () => {} });
    Alert.alert('Message Options', undefined, options as any);
  }

  // ── Render list item ────────────────────────────────────────────────────────

  function renderItem({ item }: ListRenderItemInfo<ListRow>) {
    if (item.type === 'date') {
      return (
        <View style={s.dateSeparatorWrap}>
          <View style={s.dateSeparator}>
            <Text style={s.dateSeparatorText}>{item.date}</Text>
          </View>
        </View>
      );
    }

    const { msg } = item;
    const isOwn = msg.fromId === MY_USER_ID;

    // Count reactions
    const reactionMap: Record<string, number> = {};
    for (const r of msg.reactions) {
      reactionMap[r.emoji] = (reactionMap[r.emoji] ?? 0) + 1;
    }
    const reactionEntries = Object.entries(reactionMap);

    return (
      <View style={[s.msgOuter, { justifyContent: isOwn ? 'flex-end' : 'flex-start' }]}>
        {/* Other-user avatar */}
        {!isOwn && (
          <View style={[s.msgAvatar, { backgroundColor: msg.fromColor }]}>
            <Text style={s.msgAvatarInitials}>{msg.fromInitials}</Text>
          </View>
        )}

        {/* Bubble */}
        <TouchableOpacity
          activeOpacity={0.85}
          onLongPress={() => longPressMessage(msg)}
          style={[
            s.bubble,
            {
              backgroundColor: isOwn ? PURPLE_DIM : CARD,
              borderColor: isOwn ? BORDER_ACTIVE : BORDER,
              borderBottomRightRadius: isOwn ? 4 : RADIUS.lg,
              borderBottomLeftRadius: isOwn ? RADIUS.lg : 4,
              maxWidth: BUBBLE_MAX,
              alignSelf: isOwn ? 'flex-end' : 'flex-start',
            },
          ]}
        >
          {/* Attachment — tappable for product/order types */}
          {msg.attachment && (
            <TouchableOpacity
              style={s.attachCard}
              activeOpacity={msg.attachment.type === 'product' || msg.attachment.type === 'order' ? 0.7 : 1}
              onPress={() => {
                if (msg.attachment?.type === 'product') {
                  const productId = msg.attachment.meta?.productId;
                  if (productId) {
                    router.push(('/buyer-product-detail?productId=' + productId) as never);
                  } else if (participant) {
                    router.push(('/seller-profile?id=' + participant.userId) as never);
                  }
                } else if (msg.attachment?.type === 'order') {
                  router.push('/(buyer)/orders' as never);
                }
              }}
            >
              <Feather
                name={attachmentIcon(msg.attachment.type)}
                size={ICON.sm}
                color={PURPLE}
              />
              <View style={{ flex: 1, marginLeft: SP.sm }}>
                {msg.attachment.title ? (
                  <Text style={s.attachTitle} numberOfLines={1}>{msg.attachment.title}</Text>
                ) : null}
                {msg.attachment.subtitle ? (
                  <Text style={s.attachSubtitle} numberOfLines={1}>{msg.attachment.subtitle}</Text>
                ) : null}
              </View>
              {(msg.attachment.type === 'product' || msg.attachment.type === 'order') && (
                <Feather name="chevron-right" size={ICON.xs} color={MUTED} />
              )}
            </TouchableOpacity>
          )}

          {/* Text */}
          {msg.text ? (
            <Text style={s.msgText}>{msg.text}</Text>
          ) : null}

          {/* Reactions */}
          {reactionEntries.length > 0 && (
            <View style={s.reactionsRow}>
              {reactionEntries.map(([emoji, count]) => (
                <TouchableOpacity
                  key={emoji}
                  style={s.reactionChip}
                  onPress={() => conv && addReaction(conv.id, msg.id, emoji)}
                  activeOpacity={0.7}
                >
                  <Text style={s.reactionEmoji}>{emoji}{count > 1 ? ` ${count}` : ''}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Status (own messages only) */}
          {isOwn && (
            <View style={s.msgStatus}>
              {msg.status === 'sending' && (
                <Feather name="clock" size={10} color={SUBTLE} />
              )}
              {msg.status === 'sent' && (
                <Feather name="check" size={10} color={MUTED} />
              )}
              {msg.status === 'delivered' && (
                <Feather name="check-circle" size={10} color={MUTED} />
              )}
              {msg.status === 'failed' && (
                <TouchableOpacity
                  onPress={() => conv && retryMessage(conv.id, msg.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.retryText}>Tap to retry</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  const visibleMessages = messages.filter(m => !m.deletedForMe);
  const listData = groupMessagesByDate(visibleMessages);

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

        {participant && (
          <View style={s.headerAvatarSmall}>
            <View style={[s.headerAvatarCircle, { backgroundColor: participant.color }]}>
              <Text style={s.headerAvatarInitials}>{participant.initials}</Text>
            </View>
          </View>
        )}

        <View style={s.headerCenter}>
          <Text style={s.headerName} numberOfLines={1}>{displayName}</Text>
          {displayHandle ? (
            <Text style={s.headerHandle} numberOfLines={1}>{displayHandle}</Text>
          ) : null}
        </View>

        {/* View Store — only for seller conversations */}
        {isSellerConv && sellerUserId && (
          <TouchableOpacity
            style={s.headerShop}
            onPress={() => router.push(('/seller-profile?id=' + sellerUserId) as never)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="shopping-bag" size={ICON.lg} color={PURPLE} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={s.headerMore}
          onPress={openOptions}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="more-horizontal" size={ICON.lg} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Order context card */}
      {conv?.type === 'buyer_to_seller_order' && (
        <TouchableOpacity
          style={s.orderCard}
          onPress={() => router.push('/(buyer)/orders' as never)}
          activeOpacity={0.8}
        >
          <Feather name="package" size={ICON.md} color={PURPLE} />
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.orderCardNumber}>{conv.contextOrderNumber ?? 'Order'}</Text>
            {conv.contextProductName ? (
              <Text style={s.orderCardProduct} numberOfLines={1}>{conv.contextProductName}</Text>
            ) : null}
          </View>
          {conv.contextOrderStatus ? (
            <View style={s.orderStatusBadge}>
              <Text style={s.orderStatusText}>{conv.contextOrderStatus}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      )}

      {/* Product context card — shown for seller product conversations */}
      {conv?.type === 'buyer_to_seller_product' && conv.contextProductName && (
        <TouchableOpacity
          style={s.orderCard}
          onPress={() => {
            if (participant) {
              router.push(('/seller-profile?id=' + participant.userId) as never);
            }
          }}
          activeOpacity={0.8}
        >
          <Feather name="shopping-bag" size={ICON.md} color={PURPLE} />
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.orderCardNumber} numberOfLines={1}>{conv.contextProductName}</Text>
            {conv.contextSellerName ? (
              <Text style={s.orderCardProduct} numberOfLines={1}>{conv.contextSellerName}</Text>
            ) : null}
          </View>
          <View style={s.orderStatusBadge}>
            <Text style={s.orderStatusText}>View store</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Friendship inactive banner */}
      {isDisabled && (
        <View style={s.disabledBanner}>
          <Feather name="info" size={ICON.sm} color={ORANGE} />
          <Text style={s.disabledBannerText}>
            Messaging disabled — friendship was removed.
          </Text>
        </View>
      )}

      {/* Messages list */}
      <FlatList
        ref={flatListRef}
        data={listData}
        keyExtractor={(item, i) =>
          item.type === 'date' ? `date-${item.date}-${i}` : item.msg.id
        }
        renderItem={renderItem}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
      />

      {/* Reply preview */}
      {replyTo && (
        <View style={s.replyBar}>
          <Feather name="corner-up-left" size={ICON.sm} color={PURPLE} />
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.replyFromName}>{replyTo.fromName}</Text>
            <Text style={s.replyPreviewText} numberOfLines={1}>{replyTo.text}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setReplyTo(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={s.replyClose}>×</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input row */}
      {!isDisabled ? (
        <View style={[s.inputRow, { paddingBottom: insets.bottom + SP.sm }]}>
          {/* Attach */}
          <TouchableOpacity
            onPress={() => {
              Alert.alert('Attach', undefined, [
                { text: 'Attach product', onPress: () => {} },
                { text: 'Attach post',    onPress: () => {} },
                { text: 'Attach order',   onPress: () => {} },
                { text: 'Cancel',         style: 'cancel' },
              ]);
            }}
            style={s.attachBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="paperclip" size={ICON.lg} color={MUTED} />
          </TouchableOpacity>

          {/* Text input */}
          <TextInput
            style={s.textInput}
            value={text}
            onChangeText={setText}
            placeholder="Message..."
            placeholderTextColor={SUBTLE}
            multiline
            returnKeyType="default"
          />

          {/* Send */}
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
      ) : (
        <View style={[s.inputRow, s.disabledInputRow, { paddingBottom: insets.bottom + SP.sm }]}>
          <Text style={s.disabledInputText}>Messaging disabled</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerBack: {
    marginRight: SP.sm,
  },
  headerAvatarSmall: {
    marginRight: SP.sm,
  },
  headerAvatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarInitials: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },
  headerCenter: {
    flex: 1,
  },
  headerName: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  headerHandle: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 1,
  },
  headerShop: {
    marginLeft: SP.sm,
  },
  headerMore: {
    marginLeft: SP.xs,
  },

  // Order context card
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SP.md,
    marginVertical: SP.sm,
    padding: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  orderCardNumber: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  orderCardProduct: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 2,
  },
  orderStatusBadge: {
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  orderStatusText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE,
  },

  // Disabled banner
  disabledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: 'rgba(249,115,22,0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(249,115,22,0.3)',
  },
  disabledBannerText: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: ORANGE,
    marginLeft: SP.sm,
  },

  // Messages
  listContent: {
    paddingVertical: SP.sm,
    paddingBottom: SP.md,
  },

  // Date separator
  dateSeparatorWrap: {
    alignItems: 'center',
    marginVertical: SP.md,
  },
  dateSeparator: {
    backgroundColor: CARD,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  dateSeparatorText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },

  // Message row
  msgOuter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SP.md,
    marginBottom: SP.xs,
  },
  msgAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SP.sm,
    marginBottom: 2,
  },
  msgAvatarInitials: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },

  // Bubble
  bubble: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SP.md,
  },

  // Attachment
  attachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.sm,
    marginBottom: SP.xs,
  },
  attachTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  attachSubtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 1,
  },

  // Message text
  msgText: {
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
  },

  // Reactions
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
    marginTop: SP.xs,
  },
  reactionChip: {
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.xs,
    paddingVertical: 2,
  },
  reactionEmoji: {
    fontSize: FS.xs,
  },

  // Status
  msgStatus: {
    alignSelf: 'flex-end',
    marginTop: SP.xs,
  },
  retryText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: RED,
  },

  // Reply bar
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  replyFromName: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE,
  },
  replyPreviewText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 1,
  },
  replyClose: {
    fontSize: FS.md,
    fontFamily: FONT.regular,
    color: MUTED,
    marginLeft: SP.sm,
  },

  // Input row
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: BG,
  },
  attachBtn: {
    paddingBottom: SP.xs,
  },
  textInput: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 2,
  },

  // Disabled input
  disabledInputRow: {
    justifyContent: 'center',
  },
  disabledInputText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: SUBTLE,
    textAlign: 'center',
  },
});
