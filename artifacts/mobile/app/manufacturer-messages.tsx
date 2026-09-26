/**
 * Seller ↔ manufacturer conversation: one ongoing thread for the whole job.
 * Photos from the camera or camera roll, the manufacturer's priced sample /
 * bulk cards (paid right here via Stripe), and production updates as they
 * happen.
 *
 * Params:
 *   threadId — thread UUID (takes priority)
 *   mfrName  — manufacturer display name (pre-fills the header)
 *   mfrId    — manufacturer UUID (opens or creates the thread)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@clerk/expo';
import { localTimeLabel } from '@workspace/manufacturer-flow';
import { BrandthreadHeader, EmptyState, SecondaryButton } from '@/components/BrandthreadUI';
import OrderCardBubble from '@/components/manufacturer/OrderCardBubble';
import { useOrderCardPayment } from '@/components/manufacturer/useOrderCardPayment';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { getEntitlementRejection } from '@/lib/entitlementError';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { PendingManufacturerOperations } from '@/services/manufacturerIdempotency';
import { getCallAvailability, type OrderCardSnapshot } from '@/services/manufacturerOrderFlow';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiMessage {
  id: string;
  threadId: string;
  senderRole: 'seller' | 'manufacturer' | 'system';
  content: string;
  messageType: string;   // 'text' | 'image' | 'sample_card' | 'bulk_card' | 'system'
  mediaUrls: string[];
  cardData: Record<string, unknown> | null;
  order?: OrderCardSnapshot | null;
  sentAt: string;
}

type Row = { kind: 'message'; message: ApiMessage } | { kind: 'day'; id: string; label: string };

const MAX_PHOTOS = 6;
// react-native-web renders inverted lists upside down, so web uses a normal
// chronological list that follows the newest message instead.
const INVERTED = Platform.OS !== 'web';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Newest-first rows for the inverted list, with a day separator above each day. */
function buildRows(newestFirst: ApiMessage[]): Row[] {
  const rows: Row[] = [];
  newestFirst.forEach((message, index) => {
    rows.push({ kind: 'message', message });
    const older = newestFirst[index + 1];
    const label = dayLabel(message.sentAt);
    if (!older || dayLabel(older.sentAt) !== label) rows.push({ kind: 'day', id: `day-${message.id}`, label });
  });
  return rows;
}

// ─── Bubbles ──────────────────────────────────────────────────────────────────

function SystemLine({ msg }: { msg: ApiMessage }) {
  const { theme } = useAppTheme();
  const bub = useMemo(() => makeBub(theme), [theme]);
  return (
    <View style={bub.systemWrap} testID={`system-message-${msg.id}`}>
      <View style={bub.systemPill}>
        <Feather name="info" size={12} color={theme.subtle} />
        <Text style={bub.systemText}>{msg.content}</Text>
      </View>
      <Text style={bub.systemTime}>{fmtTime(msg.sentAt)}</Text>
    </View>
  );
}

function MessageBubble({ msg, accent, onAccent, onOpenImage }: { msg: ApiMessage; accent: string; onAccent: string; onOpenImage: (uri: string) => void }) {
  const { theme } = useAppTheme();
  const bub = useMemo(() => makeBub(theme), [theme]);
  const mine = msg.senderRole === 'seller';
  const images = msg.messageType === 'image' ? msg.mediaUrls : [];
  const files = msg.messageType === 'image' ? [] : msg.mediaUrls;
  const autoCaption = /^(📷 Photo|Sent (a photo|\d+ photos|an attachment))$/.test(msg.content);
  const showText = !!msg.content && !(autoCaption && (images.length || files.length));
  return (
    <View style={[bub.row, mine ? bub.right : bub.left]} testID={`message-${msg.id}`}>
      <View style={{ maxWidth: '80%' }}>
        {images.length > 0 && (
          <View style={[bub.grid, images.length === 1 && { width: 220 }]}>
            {images.map((uri) => (
              <Pressable key={uri} onPress={() => onOpenImage(uri)} accessibilityRole="imagebutton" accessibilityLabel="Open photo">
                <Image source={{ uri }} style={images.length === 1 ? bub.imageSingle : bub.imageTile} resizeMode="cover" />
              </Pressable>
            ))}
          </View>
        )}
        {files.map((uri) => (
          <View key={uri} style={[bub.file, mine && { alignSelf: 'flex-end' }]}>
            <Feather name="file-text" size={14} color={theme.text} />
            <Text style={bub.fileText}>Attachment</Text>
          </View>
        ))}
        {showText && (
          <View style={[bub.bubble, mine ? [bub.mine, { backgroundColor: accent }] : bub.theirs, images.length > 0 && { marginTop: 4 }]}>
            <Text style={[bub.text, mine && { color: onAccent }]}>{msg.content}</Text>
          </View>
        )}
        <Text style={[bub.time, mine && { textAlign: 'right' }]}>{fmtTime(msg.sentAt)}</Text>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ManufacturerMessagesScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const params = useLocalSearchParams<{ threadId?: string; mfrName?: string; mfrId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();

  const [threadId, setThreadId] = useState<string | null>(params.threadId ?? null);
  const [mfrName, setMfrName] = useState(params.mfrName ?? 'Manufacturer');
  const [manufacturerId, setManufacturerId] = useState(params.mfrId ?? '');
  const [mfrTimeZone, setMfrTimeZone] = useState<string | null>(null);
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [callsInfoOpen, setCallsInfoOpen] = useState(false);
  const [callingEnabled, setCallingEnabled] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [, setClock] = useState(0);

  const pendingOperations = useRef(new PendingManufacturerOperations());

  const showUpgrade = useCallback((error: unknown): boolean => {
    const rejection = getEntitlementRejection(error);
    if (!rejection) return false;
    Alert.alert(
      `Upgrade to ${rejection.requiredPlan === 'growth' ? 'Growth' : 'Pro'}`,
      rejection.message,
      [
        { text: 'Not now', style: 'cancel', onPress: () => goBackOr(router) },
        { text: 'View plans', onPress: () => router.replace('/subscription' as never) },
      ],
    );
    return true;
  }, [router]);

  const loadMessages = useCallback(async (id: string) => {
    try {
      const rows: ApiMessage[] = await api.manufacturers.threads.messages.list(id);
      setMessages([...rows].reverse());
      setLoadError(null);
    } catch (error) {
      if (!showUpgrade(error)) setLoadError('Messages could not be loaded. Check your connection and try again.');
    } finally {
      setRefreshing(false);
    }
  }, [api, showUpgrade]);

  const { pay, payingId, outcome } = useOrderCardPayment(() => { if (threadId) void loadMessages(threadId); });

  useEffect(() => {
    if (!authLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let id = threadId;
        if (!id && params.mfrId) {
          const thread = await api.manufacturers.threads.create({ manufacturerId: params.mfrId, subject: 'General' });
          id = thread.id;
          if (!cancelled) setThreadId(thread.id);
        }
        if (id) {
          const threads = await api.manufacturers.threads.list();
          const thread = threads.find((item: any) => item.id === id);
          if (thread && !cancelled) {
            setMfrName(thread.manufacturerName ?? 'Manufacturer');
            setManufacturerId(thread.manufacturerId);
            setMfrTimeZone(thread.manufacturerTimeZone ?? null);
          }
          await loadMessages(id);
        } else if (!cancelled) {
          setLoadError('This conversation link is incomplete.');
        }
      } catch (error) {
        if (!showUpgrade(error) && !cancelled) setLoadError('This conversation could not be opened. Check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    void getCallAvailability().then((enabled) => { if (!cancelled) setCallingEnabled(enabled); });
    return () => { cancelled = true; };
  }, [authLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!threadId) return;
    const timer = setInterval(() => { void loadMessages(threadId); }, 5_000);
    const clock = setInterval(() => setClock((tick) => tick + 1), 60_000);
    return () => { clearInterval(timer); clearInterval(clock); };
  }, [threadId, loadMessages]);

  const rows = useMemo(() => (INVERTED ? buildRows(messages) : buildRows(messages).reverse()), [messages]);
  const listRef = useRef<FlatList<Row>>(null);
  const localTime = localTimeLabel(mfrTimeZone);

  // ── Sending ──────────────────────────────────────────────────────────────────

  async function send() {
    const text = draft.trim();
    if ((!text && pending.length === 0) || !threadId || sending) return;
    setSending(true);
    const assets = pending;
    const signature = `${threadId}:${text}:${assets.map((asset) => asset.uri).join('|')}`;
    const operation = pendingOperations.current.get(assets.length ? 'photo' : 'text', signature);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      let mediaUrls: string[] | undefined;
      if (assets.length) {
        // Uploaded paths survive a failed send so a retry doesn't re-upload.
        const uploaded = operation.metadata?.objectPaths ? String(operation.metadata.objectPaths).split('|') : [];
        for (const asset of assets.slice(uploaded.length)) {
          const result = await api.manufacturers.threads.uploadAttachment(threadId, { uri: asset.uri, mimeType: asset.mimeType });
          uploaded.push(result.objectPath);
          operation.metadata = { objectPaths: uploaded.join('|') };
        }
        mediaUrls = uploaded;
      }
      const message = await api.manufacturers.threads.messages.send(threadId, {
        clientRequestId: operation.clientRequestId,
        content: text || (assets.length === 1 ? 'Sent a photo' : assets.length ? `Sent ${assets.length} photos` : ''),
        messageType: assets.length ? 'image' : 'text',
        mediaUrls,
      });
      setMessages((current) => [message, ...current.filter((item) => item.id !== message.id)]);
      setDraft('');
      setPending([]);
      pendingOperations.current.complete(assets.length ? 'photo' : 'text', signature);
    } catch (error) {
      if (!showUpgrade(error)) Alert.alert('Not sent', 'Your message didn\'t go through. Check your connection and tap send again.');
    } finally {
      setSending(false);
    }
  }

  async function pickPhotos(source: 'camera' | 'library') {
    setAttachOpen(false);
    const room = MAX_PHOTOS - pending.length;
    if (room <= 0) { Alert.alert('Photo limit', `You can send up to ${MAX_PHOTOS} photos at once.`); return; }
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        source === 'camera' ? 'Camera access needed' : 'Photo access needed',
        source === 'camera' ? 'Allow camera access in Settings to take photos for your manufacturer.' : 'Allow photo access in Settings to share images from your camera roll.',
      );
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: room, orderedSelection: true });
    if (result.canceled) return;
    setPending((current) => [...current, ...result.assets].slice(0, MAX_PHOTOS));
  }

  function startCall(mode: 'voice' | 'video') {
    if (!callingEnabled) { setCallsInfoOpen(true); return; }
    if (!threadId) return;
    const initials = mfrName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
    const query = new URLSearchParams({
      conversationId: threadId, participantName: mfrName, participantInitials: initials,
      participantColor: theme.accent, mode, manufacturerCall: '1',
    });
    router.push(`/call-screen?${query.toString()}` as never);
  }

  const openTracker = (order: OrderCardSnapshot) => {
    router.push({ pathname: '/production-detail', params: { id: order.id } } as never);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const header = (
    <View style={{ paddingTop: insets.top, backgroundColor: theme.background, borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <BrandthreadHeader
        title={mfrName}
        subtitle={localTime ? `${localTime} for them` : 'Manufacturer conversation'}
        onBack={() => goBackOr(router)}
        rightElement={
          <View style={{ flexDirection: 'row', gap: SP.xs, alignItems: 'center' }}>
            {manufacturerId ? (
              <TouchableOpacity onPress={() => router.push({ pathname: '/manufacturer-profile', params: { id: manufacturerId } } as never)} style={s.headerBtn} accessibilityLabel="View manufacturer profile">
                <Feather name="info" size={16} color={theme.text} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => startCall('voice')} accessibilityRole="button" accessibilityLabel={callingEnabled ? 'Start voice call' : 'Calls coming soon'} testID="manufacturer-voice-call" style={[s.headerBtn, !callingEnabled && { opacity: 0.55 }]}>
              <Feather name="phone" size={16} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => startCall('video')} accessibilityRole="button" accessibilityLabel={callingEnabled ? 'Start video call' : 'Calls coming soon'} testID="manufacturer-video-call" style={[s.headerBtn, !callingEnabled && { opacity: 0.55 }]}>
              <Feather name="video" size={16} color={theme.text} />
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={s.center} testID="thread-loading"><ActivityIndicator color={theme.text} /><Text style={s.centerText}>Loading conversation…</Text></View>
      </View>
    );
  }

  if (loadError && messages.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={s.center}>
          <EmptyState icon="wifi-off" title="Conversation unavailable" description={loadError} />
          <SecondaryButton label="Try again" onPress={() => { setLoading(true); if (threadId) void loadMessages(threadId).finally(() => setLoading(false)); else goBackOr(router); }} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header}

      <FlatList
        ref={listRef}
        data={rows}
        inverted={INVERTED}
        onContentSizeChange={() => { if (!INVERTED) listRef.current?.scrollToEnd({ animated: false }); }}
        keyExtractor={(row) => (row.kind === 'day' ? row.id : row.message.id)}
        renderItem={({ item }) => {
          if (item.kind === 'day') {
            return (
              <View style={s.dayRow}><View style={s.dayLine} /><Text style={s.dayText}>{item.label}</Text><View style={s.dayLine} /></View>
            );
          }
          const msg = item.message;
          if (msg.senderRole === 'system' || msg.messageType === 'system') return <SystemLine msg={msg} />;
          if ((msg.messageType === 'sample_card' || msg.messageType === 'bulk_card')) {
            if (!msg.order) {
              return <SystemLine msg={{ ...msg, content: `${msg.content || 'Order card'} · no longer available` }} />;
            }
            return (
              <OrderCardBubble
                order={msg.order}
                fromMe={msg.senderRole === 'seller'}
                time={fmtTime(msg.sentAt)}
                paying={payingId === msg.order.id}
                payOutcome={outcome?.orderId === msg.order.id ? outcome.result : null}
                onPay={(order) => void pay(order)}
                onChanged={() => { if (threadId) void loadMessages(threadId); }}
                onOpenTracker={openTracker}
              />
            );
          }
          return <MessageBubble msg={msg} accent={theme.accent} onAccent={theme.onAccent} onOpenImage={setViewer} />;
        }}
        contentContainerStyle={{ paddingVertical: SP.md, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.text} onRefresh={() => { if (!threadId) return; setRefreshing(true); void loadMessages(threadId); }} />}
        ListEmptyComponent={
          <View style={[s.emptyWrap, INVERTED && { transform: [{ scaleY: -1 }] }]} testID="thread-empty">
            <Feather name="message-circle" size={28} color={theme.subtle} />
            <Text style={s.emptyTitle}>Start the conversation</Text>
            <Text style={s.emptyText}>Share your designs, references and target price. When {mfrName} is ready, they'll send a sample card you can pay right here.</Text>
          </View>
        }
      />

      {loadError ? <Text style={s.inlineError}>{loadError}</Text> : null}

      <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        {pending.length > 0 && (
          <View style={s.previewRow} testID="pending-photos">
            {pending.map((asset, index) => (
              <View key={`${asset.uri}-${index}`} style={s.previewTile}>
                <Image source={{ uri: asset.uri }} style={s.previewImage} />
                <TouchableOpacity style={s.previewRemove} onPress={() => setPending((current) => current.filter((_, i) => i !== index))} accessibilityLabel="Remove photo">
                  <Feather name="x" size={12} color={theme.text} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        <View style={s.inputRow}>
          <TouchableOpacity onPress={() => setAttachOpen(true)} style={s.iconBtn} accessibilityLabel="Add photos" testID="button-attach">
            <Feather name="image" size={ICON.sm} color={theme.text} />
          </TouchableOpacity>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${mfrName}…`}
            placeholderTextColor={theme.subtle}
            multiline
            testID="input-message"
          />
          <TouchableOpacity
            onPress={() => void send()}
            style={[s.sendBtn, { backgroundColor: theme.accent }, ((!draft.trim() && !pending.length) || sending) && { opacity: 0.4 }]}
            disabled={(!draft.trim() && !pending.length) || sending}
            accessibilityLabel="Send"
            testID="button-send"
          >
            {sending ? <ActivityIndicator size="small" color={theme.onAccent} /> : <Feather name="send" size={ICON.sm} color={theme.onAccent} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Attach sheet */}
      <Modal visible={attachOpen} transparent animationType="slide" onRequestClose={() => setAttachOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setAttachOpen(false)}>
          <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, SP.lg) }]}>
            <View style={s.grabber} />
            <Text style={s.sheetTitle}>Share photos</Text>
            {([
              { key: 'camera', icon: 'camera', label: 'Take a photo', hint: 'Samples, fabric, fit on body' },
              { key: 'library', icon: 'image', label: 'Choose from camera roll', hint: `Up to ${MAX_PHOTOS} at once` },
            ] as const).map((option) => (
              <TouchableOpacity key={option.key} style={s.sheetRow} onPress={() => void pickPhotos(option.key)} testID={`attach-${option.key}`}>
                <View style={s.sheetIcon}><Feather name={option.icon} size={18} color={theme.text} /></View>
                <View style={{ flex: 1 }}><Text style={s.sheetLabel}>{option.label}</Text><Text style={s.sheetHint}>{option.hint}</Text></View>
                <Feather name="chevron-right" size={16} color={theme.subtle} />
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Calls coming soon */}
      <Modal visible={callsInfoOpen} transparent animationType="fade" onRequestClose={() => setCallsInfoOpen(false)}>
        <Pressable style={[s.backdrop, { justifyContent: 'center', padding: SP.lg }]} onPress={() => setCallsInfoOpen(false)}>
          <Pressable style={s.dialog} testID="calls-coming-soon">
            <View style={s.dialogIcon}><Feather name="video" size={22} color={theme.text} /></View>
            <Text style={s.dialogTitle}>Voice & video calls are coming soon</Text>
            <Text style={s.dialogText}>
              Until then, keep everything in this conversation. Photos, order cards and production updates stay in one place for you and {mfrName}.
              {localTime ? `\n\nIt's ${localTime} for them right now.` : ''}
            </Text>
            <TouchableOpacity style={[s.dialogBtn, { backgroundColor: theme.accent }]} onPress={() => setCallsInfoOpen(false)}>
              <Text style={[s.dialogBtnText, { color: theme.onAccent }]}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Full-screen photo viewer */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={s.viewer} onPress={() => setViewer(null)} accessibilityLabel="Close photo">
          {viewer ? <Image source={{ uri: viewer }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
          <View style={[s.viewerClose, { top: insets.top + SP.sm }]}><Feather name="x" size={22} color="#fff" /></View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeBub = (theme: AppThemePreset) => StyleSheet.create({
  row: { marginVertical: 3, paddingHorizontal: SP.md },
  right: { flexDirection: 'row', justifyContent: 'flex-end' },
  left: { flexDirection: 'row', justifyContent: 'flex-start' },
  bubble: { borderRadius: RADIUS.lg, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  mine: { borderBottomRightRadius: 4 },
  theirs: { backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, borderBottomLeftRadius: 4 },
  text: { fontSize: FS.base, fontFamily: FONT.regular, color: theme.text, lineHeight: 21 },
  time: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginTop: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, width: 226, borderRadius: RADIUS.md, overflow: 'hidden' },
  imageSingle: { width: 220, height: 240, borderRadius: RADIUS.md },
  imageTile: { width: 111, height: 111 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.md, backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, marginBottom: 4 },
  fileText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  systemWrap: { alignItems: 'center', marginVertical: SP.sm, paddingHorizontal: SP.lg },
  systemPill: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, maxWidth: 320 },
  systemText: { flexShrink: 1, fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted, lineHeight: 16 },
  systemTime: { fontSize: 10, fontFamily: FONT.regular, color: theme.subtle, marginTop: 3 },
});

const makeS = (theme: AppThemePreset) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.md, padding: SP.lg },
  centerText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.lg, marginVertical: SP.sm },
  dayLine: { flex: 1, height: 1, backgroundColor: theme.border },
  dayText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.subtle },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl, gap: SP.sm, paddingVertical: SP.xl },
  emptyTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text },
  emptyText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', lineHeight: 19 },
  inlineError: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.error, textAlign: 'center', paddingVertical: 4 },
  composer: { backgroundColor: theme.card, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: SP.sm },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  previewTile: { width: 56, height: 56, borderRadius: RADIUS.sm, overflow: 'hidden' },
  previewImage: { width: '100%', height: '100%' },
  previewRemove: { position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SP.sm, paddingHorizontal: SP.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.cardElevated },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: theme.cardElevated, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    paddingHorizontal: SP.md, paddingTop: 10, paddingBottom: 10, fontSize: FS.base, fontFamily: FONT.regular, color: theme.text,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SP.lg, gap: SP.sm },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, marginBottom: SP.sm },
  sheetTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text, marginBottom: 4 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm + 2 },
  sheetIcon: { width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' },
  sheetLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  sheetHint: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  dialog: { backgroundColor: theme.card, borderRadius: RADIUS.xl, padding: SP.lg, borderWidth: 1, borderColor: theme.border, alignItems: 'center', gap: SP.sm },
  dialogIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  dialogTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text, textAlign: 'center' },
  dialogText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', lineHeight: 19 },
  dialogBtn: { marginTop: SP.sm, alignSelf: 'stretch', height: 46, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  dialogBtnText: { fontSize: FS.base, fontFamily: FONT.bold },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  viewerClose: { position: 'absolute', right: SP.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});
