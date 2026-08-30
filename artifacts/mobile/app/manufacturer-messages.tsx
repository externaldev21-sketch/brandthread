/**
 * Manufacturer Messages Screen
 * Params:
 *   threadId      — real DB thread UUID (takes priority)
 *   mfrName       — manufacturer display name (pre-fill header)
 *   mfrId         — manufacturer UUID (for creating threads)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Image,
  ScrollView, RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { BrandthreadHeader, StatusBadge } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_FOCUS,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, ORANGE, ORANGE_DIM, SUCCESS, SUCCESS_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { getEntitlementRejection } from '@/lib/entitlementError';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiMessage {
  id: string;
  threadId: string;
  senderRole: 'seller' | 'manufacturer' | 'system';
  content: string;
  messageType: string;   // 'text' | 'image' | 'sample_card' | 'bulk_card' | 'system'
  mediaUrls: string[];
  cardData: Record<string, unknown> | null;
  sentAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtCents(c: number) { return formatCents(c); }

// ─── Message Bubble ───────────────────────────────────────────────────────────

function ApiMessageBubble({ msg, onOpenOrder }: { msg: ApiMessage; onOpenOrder: (id: string, type: string) => void }) {
  const isSeller = msg.senderRole === 'seller';
  const isSystem = msg.senderRole === 'system' || msg.messageType === 'system';

  if (isSystem) {
    return (
      <View style={bubS.systemWrap}>
        <Text style={bubS.systemText}>{msg.content}</Text>
        <Text style={bubS.timestamp}>{fmtTime(msg.sentAt)}</Text>
      </View>
    );
  }

  if (msg.messageType === 'image' && msg.mediaUrls.length > 0) {
    return (
      <View style={[bubS.row, isSeller ? bubS.rowRight : bubS.rowLeft]}>
        <View style={{ maxWidth: '75%' }}>
          <Image
            source={{ uri: msg.mediaUrls[0] }}
            style={bubS.imageMsg}
            resizeMode="cover"
          />
          <Text style={[bubS.timestamp, isSeller ? { textAlign: 'right' } : {}]}>
            {fmtTime(msg.sentAt)}
          </Text>
        </View>
      </View>
    );
  }

  if (msg.messageType === 'sample_card' || msg.messageType === 'bulk_card') {
    const card = msg.cardData as any;
    const icon = msg.messageType === 'sample_card' ? '🧵' : '📦';
    const label = msg.messageType === 'sample_card' ? 'Sample Order' : 'Bulk Order';
    return (
      <View style={[bubS.row, isSeller ? bubS.rowRight : bubS.rowLeft]}>
        <TouchableOpacity style={bubS.cardMsg} onPress={() => card?.orderId && onOpenOrder(card.orderId, card.orderType)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Text style={{ fontSize: 20 }}>{icon}</Text>
            <Text style={bubS.cardLabel}>{label}</Text>
          </View>
          {card?.title && <Text style={bubS.cardTitle}>{card.title}</Text>}
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
            {card?.quantity && (
              <View>
                <Text style={bubS.cardKey}>Qty</Text>
                <Text style={bubS.cardVal}>{card.quantity}</Text>
              </View>
            )}
            {card?.priceCents && (
              <View>
                <Text style={bubS.cardKey}>Price</Text>
                <Text style={bubS.cardVal}>{fmtCents(card.priceCents)}</Text>
              </View>
            )}
            {card?.walletBalance !== undefined && (
              <View>
                <Text style={bubS.cardKey}>Wallet</Text>
                <Text style={[bubS.cardVal, { color: SUCCESS }]}>{fmtCents(card.walletBalance)}</Text>
              </View>
            )}
          </View>
          {card?.description && (
            <Text style={[bubS.cardDesc]}>{card.description}</Text>
          )}
          <Text style={bubS.timestamp}>{fmtTime(msg.sentAt)}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Default text bubble
  return (
    <View style={[bubS.row, isSeller ? bubS.rowRight : bubS.rowLeft]}>
      <View style={{ maxWidth: '78%' }}>
        <View style={[bubS.bubble, isSeller ? bubS.sellerBubble : bubS.mfgBubble]}>
          <Text style={[bubS.msgText, isSeller && { color: '#fff' }]}>{msg.content}</Text>
        </View>
        <Text style={[bubS.timestamp, isSeller ? { textAlign: 'right' } : {}]}>
          {fmtTime(msg.sentAt)}
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
  timestamp: {
    fontSize: 10,
    fontFamily: FONT.regular,
    color: SUBTLE,
    marginTop: 3,
  },
  imageMsg: {
    width: 200,
    height: 200,
    borderRadius: RADIUS.md,
  },
  cardMsg: {
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.lg,
    padding: SP.md,
    maxWidth: 280,
  },
  cardLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  cardTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  cardKey:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  cardVal:   { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  cardDesc:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 6 },
});

// ─── Sample Card Dialog ────────────────────────────────────────────────────────

function SampleCardDialog({
  type,
  onSend,
  onClose,
}: {
  type: 'sample_card' | 'bulk_card';
  onSend: (cardData: any) => void;
  onClose: () => void;
}) {
  const [title, setTitle]       = useState('');
  const [qty, setQty]           = useState('1');
  const [price, setPrice]       = useState('');
  const [desc, setDesc]         = useState('');

  const isBulk = type === 'bulk_card';
  const label  = isBulk ? 'Bulk Order' : 'Sample Order';

  function handleSend() {
    if (!title.trim() || !price.trim()) {
      Alert.alert('Required', 'Title and price are required.'); return;
    }
    const priceCents = parseDecimalToCents(price);
    if (priceCents === null || priceCents <= 0) {
      Alert.alert('Invalid price', 'Enter a valid amount with up to two decimal places.'); return;
    }
    onSend({
      title:      title.trim(),
      quantity:   parseInt(qty) || 1,
      priceCents,
      orderType:  isBulk ? 'bulk' : 'sample',
      description: desc.trim() || undefined,
    });
    onClose();
  }

  return (
    <View style={dlgS.overlay}>
      <View style={dlgS.sheet}>
        <View style={dlgS.header}>
          <Text style={dlgS.title}>{isBulk ? '📦' : '🧵'} Send {label}</Text>
          <TouchableOpacity onPress={onClose}>
            <Feather name="x" size={20} color={MUTED} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <DlgField label="Title" value={title} onChange={setTitle} placeholder={isBulk ? 'e.g. 500 Hoodies — White' : 'e.g. Sample Hoodie — Black'} />
          <DlgField label="Quantity" value={qty} onChange={setQty} keyboard="numeric" />
          <DlgField label="Price (USD)" value={price} onChange={setPrice} keyboard="decimal-pad" placeholder="0.00" />
          <DlgField label="Notes (optional)" value={desc} onChange={setDesc} multiline />
        </ScrollView>

        <TouchableOpacity style={dlgS.sendBtn} onPress={handleSend}>
          <Text style={dlgS.sendBtnText}>Send {label} Card</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DlgField({ label, value, onChange, placeholder, keyboard, multiline }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, marginBottom: 6 }}>{label}</Text>
      <TextInput
        style={[dlgS.input, multiline && { height: 72, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={SUBTLE}
        keyboardType={keyboard}
        multiline={multiline}
        returnKeyType="done"
      />
    </View>
  );
}

const dlgS = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end', zIndex: 999,
  },
  sheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    padding: SP.lg, paddingBottom: 40, maxHeight: '80%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
  title:  { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  input: {
    backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: 12,
    fontSize: FS.base, fontFamily: FONT.regular, color: FG,
  },
  sendBtn: {
    backgroundColor: PURPLE, borderRadius: RADIUS.md, paddingVertical: 14,
    alignItems: 'center', marginTop: SP.md,
  },
  sendBtnText: { fontSize: FS.base, fontFamily: FONT.bold, color: '#fff' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ManufacturerMessagesScreen() {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const { theme } = useAppTheme();
  const params = useLocalSearchParams<{
    threadId?: string;
    mfrName?: string;
    mfrId?: string;
  }>();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const api     = useApi();

  const [resolvedThreadId, setResolvedThreadId] = useState<string | null>(params.threadId ?? null);
  const [mfrDisplayName, setMfrDisplayName] = useState(params.mfrName ?? 'Manufacturer');
  const [manufacturerId, setManufacturerId] = useState(params.mfrId ?? '');

  // API mode state
  const [apiMessages,    setApiMessages]    = useState<ApiMessage[]>([]);
  const [inputText,  setInputText]  = useState('');
  const [sending,    setSending]    = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [cardDialog, setCardDialog] = useState<'sample_card' | 'bulk_card' | null>(null);

  const inputRef = useRef<TextInput>(null);
  const listRef  = useRef<FlatList>(null);

  const showUpgrade = useCallback((error: unknown): boolean => {
    const rejection = getEntitlementRejection(error);
    if (!rejection) return false;
    Alert.alert(
      `Upgrade to ${rejection.requiredPlan === 'growth' ? 'Growth' : 'Scale'}`,
      rejection.message,
      [
        { text: 'Not now', style: 'cancel', onPress: () => router.back() },
        { text: 'View plans', onPress: () => router.replace('/subscription' as never) },
      ],
    );
    return true;
  }, [router]);

  // ── Load ──────────────────────────────────────────────────────────────────────

  const loadApiMessages = useCallback(async (threadId: string) => {
    try {
      setLoadError('');
      const msgs = await api.manufacturers.threads.messages.list(threadId);
      setApiMessages(msgs.reverse()); // newest first for inverted list
    } catch (e) {
      if (showUpgrade(e)) return;
      setLoadError('Could not load messages.');
      console.error('Failed to load messages:', e);
    } finally {
      setRefreshing(false);
    }
  }, [api, showUpgrade]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      if (resolvedThreadId) {
        try {
          const threads = await api.manufacturers.threads.list();
          const thread = threads.find((item: any) => item.id === resolvedThreadId);
          if (thread) {
            setMfrDisplayName(thread.manufacturerName);
            setManufacturerId(thread.manufacturerId);
          }
        } catch (error) {
          if (!showUpgrade(error)) Alert.alert('Error', 'Could not load this conversation.');
        }
        await loadApiMessages(resolvedThreadId);
      } else if (params.mfrId) {
        // Create or get thread for this manufacturer
        try {
          const thread = await api.manufacturers.threads.create({
            manufacturerId: params.mfrId,
            subject: 'General',
          });
          setResolvedThreadId(thread.id);
          // Messages will load via the effect below
        } catch (error) {
          if (!showUpgrade(error)) {
            Alert.alert('Error', 'Could not open this manufacturer conversation.');
          }
        }
      } else {
        Alert.alert('Conversation unavailable', 'A valid manufacturer thread is required.', [
          { text: 'Back', onPress: () => router.back() },
        ]);
      }
      setLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When threadId resolves, load messages
  useEffect(() => {
    if (resolvedThreadId) {
      loadApiMessages(resolvedThreadId).catch(() => {});
    }
  }, [resolvedThreadId, loadApiMessages]);
  useEffect(() => {
    if (!resolvedThreadId) return;
    const timer = setInterval(() => loadApiMessages(resolvedThreadId), 5_000);
    return () => clearInterval(timer);
  }, [resolvedThreadId, loadApiMessages]);

  // ── Send text ─────────────────────────────────────────────────────────────────

  async function handleSend() {
    const text = inputText.trim();
    if (!text) return;
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (resolvedThreadId) {
      try {
        const msg = await api.manufacturers.threads.messages.send(resolvedThreadId, {
          content:     text,
          messageType: 'text',
          senderRole:  'seller',
        });
        setApiMessages(prev => [{ ...msg }, ...prev]);
        setInputText('');
      } catch (error) {
        if (!showUpgrade(error)) Alert.alert('Error', 'Could not send message.');
      }
    }
    setSending(false);
  }

  // ── Send photo ────────────────────────────────────────────────────────────────

  async function handlePhotoSend() {
    if (!resolvedThreadId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to share images.'); return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: false,
    });
    if (result.canceled) return;

    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const asset = result.assets[0];
      const upload = await api.manufacturers.threads.uploadAttachment(resolvedThreadId, {
        uri: asset.uri,
        mimeType: asset.mimeType,
      });

      const msg = await api.manufacturers.threads.messages.send(resolvedThreadId, {
        content:     '📷 Photo',
        messageType: 'image',
        mediaUrls:   [upload.objectPath],
        senderRole:  'seller',
      });
      setApiMessages(prev => [{ ...msg }, ...prev]);
    } catch (e) {
      if (!showUpgrade(e)) Alert.alert('Error', 'Could not send photo.');
    }
    setSending(false);
  }

  // ── Send card ─────────────────────────────────────────────────────────────────

  async function handleSendCard(cardType: 'sample_card' | 'bulk_card', cardData: any) {
    if (!resolvedThreadId || !manufacturerId) return;
    setSending(true);
    try {
      const order = await api.manufacturers.sampleOrders.create({
        manufacturerId,
        threadId: resolvedThreadId,
        orderType: cardType === 'sample_card' ? 'sample' : 'bulk',
        title: cardData.title,
        description: cardData.description,
        quantity: cardData.quantity,
        priceCents: cardData.priceCents,
      });
      const label = cardType === 'sample_card' ? 'Sample Order Card' : 'Bulk Order Card';
      const msg = await api.manufacturers.threads.messages.send(resolvedThreadId, {
        content:     label,
        messageType: cardType,
        cardData: { ...cardData, orderId: order.id },
        senderRole:  'seller',
      });
      setApiMessages(prev => [{ ...msg }, ...prev]);
      router.push(
        `${cardType === 'bulk_card' ? '/production-detail' : '/sample-detail'}?id=${encodeURIComponent(order.id)}&paymentPrompt=1` as never,
      );
    } catch (error) {
      if (!showUpgrade(error)) Alert.alert('Error', 'Could not send card.');
    }
    setSending(false);
  }

  // ── Attach menu ───────────────────────────────────────────────────────────────

  function handleAttachPress() {
    const actions: any[] = [
      { text: '🖼️  Send Photo',       onPress: handlePhotoSend },
    ];
    actions.push({ text: '🧵 Send Sample Order Card', onPress: () => setCardDialog('sample_card') });
    actions.push({ text: '📦 Send Bulk Order Card',   onPress: () => setCardDialog('bulk_card')   });
    actions.push({
      text: '📹 Start Video Call',
      onPress: () => Alert.alert('Video Calling', 'Video and voice calling requires the EAS native build. Ask your account manager to enable it for your workspace.'),
    });
    actions.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert('Attach', 'Choose an action', actions);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={PURPLE} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Card dialogs (above everything) */}
      {cardDialog && (
        <SampleCardDialog
          type={cardDialog}
          onSend={(cd) => handleSendCard(cardDialog, cd)}
          onClose={() => setCardDialog(null)}
        />
      )}

      {/* Header */}
      <View style={{ paddingTop: insets.top, backgroundColor: BG, borderBottomWidth: 1, borderBottomColor: BORDER }}>
        <BrandthreadHeader
          title={mfrDisplayName}
          subtitle="Connected"
          onBack={() => router.back()}
          rightElement={
            <TouchableOpacity
              onPress={() => Alert.alert('Video Calling', 'Video and voice calling requires the EAS native build.')}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="video" size={16} color={PURPLE_LIGHT} />
            </TouchableOpacity>
          }
        />
      </View>

      {/* Messages */}
      {loadError && apiMessages.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg }}>
          <Text style={{ color: MUTED, fontFamily: FONT.medium, marginBottom: SP.md }}>{loadError}</Text>
          <TouchableOpacity style={dlgS.sendBtn} onPress={() => resolvedThreadId && loadApiMessages(resolvedThreadId)}>
            <Text style={dlgS.sendBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : <FlatList
          ref={listRef}
          data={apiMessages}
          keyExtractor={m => m.id}
          inverted
          renderItem={({ item }) => <ApiMessageBubble msg={item} onOpenOrder={(orderId, orderType) =>
            router.push(`${orderType === 'bulk' ? '/production-detail' : '/sample-detail'}?id=${orderId}&paymentPrompt=1` as never)
          } />}
          contentContainerStyle={{ paddingVertical: SP.md }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
            if (!resolvedThreadId) return;
            setRefreshing(true);
            loadApiMessages(resolvedThreadId);
          }} tintColor={PURPLE} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 40 }}>
              <Text style={{ color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm }}>
                No messages yet. Say hello!
              </Text>
            </View>
          }
        />}

      {/* Input Bar */}
      <View style={[s.inputArea, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        <View style={s.inputRow}>
          <TouchableOpacity
            onPress={handleAttachPress}
            style={s.iconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="paperclip" size={ICON.sm} color={MUTED} />
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
            style={[s.sendBtn, { backgroundColor: theme.accent }, (!inputText.trim() || sending) && { opacity: 0.4 }]}
            disabled={!inputText.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color={theme.onAccent} />
              : <Feather name="send" size={ICON.sm} color={theme.onAccent} />
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
    alignItems: 'center',
    justifyContent: 'center',
  },
});
