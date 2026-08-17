/**
 * Seller Conversation — read a buyer thread and send replies.
 * Reads GET /api/conversations/:id/messages, sends via POST /api/conversations/:id/messages.
 * Sellers can attach a product card or the linked order to a reply.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Alert, Platform, StyleSheet, Dimensions,
  ActivityIndicator, ListRenderItemInfo, Modal, ScrollView,
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface Participant {
  userId: string; name: string; handle: string;
  initials: string; color: string; accountType: string;
}
interface ConvView {
  id: string; type: string; participants: Participant[];
  contextOrderId?: string; contextOrderNumber?: string; contextOrderStatus?: string;
  contextProductId?: string; contextProductName?: string;
}
interface MsgAttachment {
  type: 'product' | 'order' | 'post' | 'profile';
  title?: string;
  subtitle?: string;
  meta?: { productId?: string; orderId?: string };
}
interface Msg {
  id: string; conversationId: string;
  fromId: string; fromName: string; fromInitials: string; fromColor: string;
  text: string; attachment?: MsgAttachment; status: string; ts: number;
}
interface SellerProduct {
  id: string; name: string; price?: number; status?: string;
  variants?: Array<{ price: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatPrice(p: SellerProduct): string {
  if (p.price != null) return `$${(p.price / 100).toFixed(2)}`;
  if (p.variants && p.variants.length > 0) return `$${(p.variants[0].price / 100).toFixed(2)}`;
  return '';
}

function attachmentIcon(type: MsgAttachment['type']): keyof typeof Feather.glyphMap {
  switch (type) {
    case 'product': return 'shopping-bag';
    case 'order':   return 'package';
    case 'post':    return 'image';
    case 'profile': return 'user';
    default:        return 'paperclip';
  }
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

// ─── Screen ───────────────────────────────────────────────────────────────────

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

  // Attachment state
  const [pendingAttachment, setPendingAttachment] = useState<MsgAttachment | null>(null);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────────

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

  // ── Derived ─────────────────────────────────────────────────────────────────

  const other = conv?.participants.find((p) => p.userId !== myId) ?? null;
  const canSend = (text.trim().length > 0 || pendingAttachment != null) && !isSending && !!id;

  // ── Attach helpers ──────────────────────────────────────────────────────────

  async function openAttachPicker() {
    setShowAttachPicker(true);
  }

  async function loadProducts() {
    setLoadingProducts(true);
    try {
      const data = await api.products.list() as SellerProduct[];
      const active = Array.isArray(data) ? data.filter((p) => p.status === 'active') : [];
      setProducts(active);
    } catch {
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  }

  function attachLinkedOrder() {
    if (!conv?.contextOrderId) return;
    setPendingAttachment({
      type: 'order',
      title: conv.contextOrderNumber ?? 'Order',
      subtitle: conv.contextProductName ?? conv.contextOrderStatus ?? undefined,
      meta: { orderId: conv.contextOrderId },
    });
    setShowAttachPicker(false);
  }

  function attachProduct(product: SellerProduct) {
    const priceStr = formatPrice(product);
    setPendingAttachment({
      type: 'product',
      title: product.name,
      subtitle: priceStr || undefined,
      meta: { productId: product.id },
    });
    setShowProductPicker(false);
    setShowAttachPicker(false);
  }

  // ── Send ────────────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!id || !canSend) return;
    const t = text.trim();
    const att = pendingAttachment;
    setText('');
    setPendingAttachment(null);
    setIsSending(true);
    try {
      const msg = await api.conversations.send(id, {
        text: t,
        attachment: att ?? undefined,
      });
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
      setPendingAttachment(att);
    } finally {
      setIsSending(false);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

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
          {/* Attachment card */}
          {msg.attachment && (
            <TouchableOpacity
              style={s.attachCard}
              activeOpacity={
                msg.attachment.type === 'product' || msg.attachment.type === 'order' ? 0.7 : 1
              }
              onPress={() => {
                if (msg.attachment?.type === 'product') {
                  const pid = msg.attachment.meta?.productId;
                  if (pid) {
                    router.push(('/buyer-product-detail?productId=' + pid) as never);
                  }
                } else if (msg.attachment?.type === 'order') {
                  router.push('/seller-orders' as never);
                }
              }}
            >
              <Feather name={attachmentIcon(msg.attachment.type)} size={ICON.sm} color={PURPLE} />
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
          {/* Text — hide the single-space placeholder */}
          {msg.text && msg.text.trim().length > 0 && (
            <Text style={s.msgText}>{msg.text}</Text>
          )}
        </View>
      </View>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

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

      {/* Messages */}
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

      {/* Pending attachment preview */}
      {pendingAttachment && (
        <View style={s.pendingAttachRow}>
          <Feather name={attachmentIcon(pendingAttachment.type)} size={ICON.sm} color={PURPLE} />
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.pendingAttachTitle} numberOfLines={1}>{pendingAttachment.title}</Text>
            {pendingAttachment.subtitle ? (
              <Text style={s.pendingAttachSub} numberOfLines={1}>{pendingAttachment.subtitle}</Text>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={() => setPendingAttachment(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
        </View>
      )}

      {/* Input row */}
      <View style={[s.inputRow, { paddingBottom: insets.bottom + SP.sm }]}>
        {/* Attach button */}
        <TouchableOpacity
          style={s.attachBtn}
          onPress={openAttachPicker}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="paperclip" size={ICON.md} color={pendingAttachment ? PURPLE : MUTED} />
        </TouchableOpacity>

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

      {/* ── Attach picker sheet ─────────────────────────────────────────────── */}
      <Modal
        visible={showAttachPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAttachPicker(false)}
      >
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAttachPicker(false)}
        />
        <View style={[s.sheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>Attach to message</Text>

          <TouchableOpacity
            style={s.sheetOption}
            onPress={async () => {
              setShowAttachPicker(false);
              setShowProductPicker(true);
              await loadProducts();
            }}
          >
            <View style={s.sheetOptionIcon}>
              <Feather name="shopping-bag" size={ICON.md} color={PURPLE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sheetOptionLabel}>Attach a product</Text>
              <Text style={s.sheetOptionDesc}>Share a product card from your store</Text>
            </View>
            <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>

          {conv?.contextOrderId ? (
            <TouchableOpacity style={s.sheetOption} onPress={attachLinkedOrder}>
              <View style={s.sheetOptionIcon}>
                <Feather name="package" size={ICON.md} color={PURPLE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetOptionLabel}>Attach linked order</Text>
                <Text style={s.sheetOptionDesc}>
                  {conv.contextOrderNumber ?? 'Order'}{conv.contextProductName ? ` · ${conv.contextProductName}` : ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[s.sheetOption, { marginTop: SP.sm, borderTopWidth: 1, borderTopColor: BORDER }]}
            onPress={() => setShowAttachPicker(false)}
          >
            <Text style={[s.sheetOptionLabel, { color: MUTED, textAlign: 'center', flex: 1 }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Product picker modal ────────────────────────────────────────────── */}
      <Modal
        visible={showProductPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowProductPicker(false)}
      >
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowProductPicker(false)}
        />
        <View style={[s.productSheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={s.sheetHandle} />
          <View style={s.productSheetHeader}>
            <Text style={s.sheetTitle}>Choose a product</Text>
            <TouchableOpacity onPress={() => setShowProductPicker(false)}>
              <Feather name="x" size={ICON.md} color={MUTED} />
            </TouchableOpacity>
          </View>

          {loadingProducts ? (
            <View style={s.centerFill}><ActivityIndicator color={PURPLE} /></View>
          ) : products.length === 0 ? (
            <View style={s.emptyState}>
              <Feather name="shopping-bag" size={32} color={MUTED} />
              <Text style={s.emptyText}>No products found</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {products.map((product) => (
                <TouchableOpacity
                  key={product.id}
                  style={s.productRow}
                  onPress={() => attachProduct(product)}
                  activeOpacity={0.7}
                >
                  <View style={s.productIcon}>
                    <Feather name="shopping-bag" size={ICON.md} color={PURPLE} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.productName} numberOfLines={1}>{product.name}</Text>
                    {formatPrice(product) ? (
                      <Text style={s.productPrice}>{formatPrice(product)}</Text>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  msgText: { fontSize: FS.base, fontFamily: FONT.regular, color: FG, marginTop: 4 },

  attachCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: BG, borderRadius: RADIUS.md,
    padding: SP.sm, marginBottom: 2,
    borderWidth: 1, borderColor: BORDER,
  },
  attachTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  attachSubtitle: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },

  pendingAttachRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: SP.md, marginBottom: SP.xs,
    padding: SP.sm,
    backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER_ACTIVE,
  },
  pendingAttachTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  pendingAttachSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: SP.md, paddingTop: SP.sm, gap: SP.sm,
    borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: BG,
  },
  attachBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
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

  // Attach picker sheet
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm, paddingHorizontal: SP.md,
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: BORDER,
    borderRadius: 2, alignSelf: 'center', marginBottom: SP.md,
  },
  sheetTitle: {
    fontSize: FS.lg, fontFamily: FONT.semibold, color: FG,
    marginBottom: SP.md,
  },
  sheetOption: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SP.md, gap: SP.sm,
  },
  sheetOptionIcon: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetOptionLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  sheetOptionDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  // Product picker sheet
  productSheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm, paddingHorizontal: SP.md,
    maxHeight: '70%',
  },
  productSheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SP.sm,
  },
  productRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  productIcon: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center', justifyContent: 'center',
    marginRight: SP.sm,
  },
  productName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  productPrice: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: SP.xxl },
  emptyText: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, marginTop: SP.sm },
});
