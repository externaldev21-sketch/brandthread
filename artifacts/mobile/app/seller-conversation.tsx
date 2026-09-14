/**
 * Seller Conversation — read a buyer thread and send replies.
 * Reads GET /api/conversations/:id/messages, sends via POST /api/conversations/:id/messages.
 * Sellers can attach a product card or the linked order to a reply.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, KeyboardAvoidingView, Alert, Platform, StyleSheet, Dimensions, ActivityIndicator, ListRenderItemInfo, Modal, ScrollView, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useUser } from '@clerk/expo';
import { BG, CARD, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, RED, ON_DARK, FONT, FS, SP, RADIUS, ICON, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import * as ImagePicker from 'expo-image-picker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from 'expo-audio';
import { formatCents } from '@/lib/money';
import { notifyConversationReadFailure } from '@/lib/conversationReadEvents';

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
  type: 'product' | 'order' | 'post' | 'profile' | 'image' | 'video' | 'voice';
  uri?: string;
  title?: string;
  subtitle?: string;
  meta?: Record<string, string>;
}
interface Msg {
  id: string; conversationId: string;
  fromId: string; fromName: string; fromInitials: string; fromColor: string;
  text: string; attachment?: MsgAttachment; status: string; ts: number;
}
interface SellerProduct {
  id: string; name: string; priceCents?: number; status?: string;
  variants?: Array<{ priceCents: number }>;
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
  if (p.priceCents != null) return formatCents(p.priceCents);
  if (p.variants && p.variants.length > 0) return formatCents(p.variants[0].priceCents);
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
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { user } = useUser();
  const myId = user?.id ?? '';
  const { id } = useLocalSearchParams<{ id?: string }>();

  const flatListRef = useRef<FlatList<ListRow>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const generationRef = useRef(0);
  const requestGenerationRef = useRef<number | null>(null);

  const [conv, setConv] = useState<ConvView | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording]         = useState(false);
  const [isUploading, setIsUploading]         = useState(false);
  const [playingVoiceUri, setPlayingVoiceUri] = useState<string | null>(null);
  const [showMediaSheet, setShowMediaSheet]   = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voicePlayer = useAudioPlayer(null);
  const voicePlayerStatus = useAudioPlayerStatus(voicePlayer);

  // Attachment state
  const [pendingAttachment, setPendingAttachment] = useState<MsgAttachment | null>(null);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadMessages = useCallback(async (generation: number) => {
    if (!id) return;
    // Prevent a slow poll from overlapping the next tick in the same focus
    // cycle. This keeps failures attributable to the current request stream.
    if (requestGenerationRef.current === generation) return;
    requestGenerationRef.current = generation;
    try {
      const msgs = await api.conversations.messages(id, 100);
      if (generationRef.current !== generation) return;
      setMessages(msgs as Msg[]);
      consecutiveFailuresRef.current = 0;
    } catch {
      if (generationRef.current !== generation) return;
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3 && pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } finally {
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current = null;
      }
    }
  }, [api, id]);

  const loadAll = useCallback(async (generation: number) => {
    if (!id) { setIsLoading(false); return; }
    try {
      const [c] = await Promise.all([
        api.conversations.get(id),
        loadMessages(generation),
      ]);
      if (generationRef.current !== generation) return;
      setConv(c as ConvView);
    } catch (e) {
      console.error('Failed to load conversation', e);
    } finally {
      if (generationRef.current === generation) setIsLoading(false);
    }
  }, [api, id, loadMessages]);

  useFocusEffect(useCallback(() => {
    const generation = ++generationRef.current;
    consecutiveFailuresRef.current = 0;
    // Mark the thread as read as soon as it opens. This is intentionally
    // independent of loading the conversation/messages so a slow or failed
    // read request cannot leave the seller's inbox badge stale.
    if (id) {
      api.conversations.markRead(id).catch(() => {
        notifyConversationReadFailure(id);
      });
    }
    loadAll(generation);
    pollRef.current = setInterval(() => loadMessages(generation), 15_000);
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [api, id, loadAll, loadMessages]));

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  useEffect(() => {
    if (voicePlayerStatus.didJustFinish) setPlayingVoiceUri(null);
  }, [voicePlayerStatus.didJustFinish]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const other = conv?.participants.find((p) => p.userId !== myId) ?? null;
  const canSend = (text.trim().length > 0 || pendingAttachment != null) && !isSending && !!id;

  // ── Attach helpers ──────────────────────────────────────────────────────────

  async function openAttachPicker() {
    setShowAttachPicker(true);
  }

  // ── Media upload helper ───────────────────────────────────────────────────────

  async function uploadMedia(base64: string, mimeType: string, extension: string): Promise<string> {
    const result = await api.conversations.uploadMedia({ data: base64, mimeType, extension });
    return result.url;
  }

  // ── 1:1 call ─────────────────────────────────────────────────────────────────

  function handleStartCall(mode: 'voice' | 'video') {
    if (!id) return;
    const qs = new URLSearchParams({
      conversationId: id,
      participantName: other?.name ?? 'User',
      participantInitials: other?.initials ?? '?',
      participantColor: other?.color ?? PURPLE,
      mode,
    });
    router.push(('/call-screen?' + qs.toString()) as never);
  }

  // ── Photo / video picker ──────────────────────────────────────────────────────

  async function handlePickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access in Settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 15,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled || !result.assets.length) return;
    setShowMediaSheet(false);
    setIsUploading(true);
    try {
      const urls: string[] = [];
      for (const asset of result.assets) {
        if (!asset.base64) continue;
        urls.push(await uploadMedia(asset.base64, 'image/jpeg', 'jpg'));
      }
      if (!urls.length) return;
      setPendingAttachment({
        type: 'image', uri: urls[0],
        title: urls.length > 1 ? `${urls.length} photos` : 'Photo',
        meta: { photoUris: JSON.stringify(urls) },
      });
    } catch { Alert.alert('Upload failed', 'Could not upload. Please try again.'); }
    finally { setIsUploading(false); }
  }

  async function handlePickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access in Settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 59,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets.length) return;
    const asset = result.assets[0];
    if ((asset.duration ?? 0) > 60000) { Alert.alert('Video too long', 'Choose a video under 1 minute.'); return; }
    if (!asset.base64) { Alert.alert('Error', 'Could not read video file.'); return; }
    setShowMediaSheet(false);
    setIsUploading(true);
    try {
      const ext = (asset.uri.split('.').pop() ?? 'mp4').replace(/\?.*/, '');
      const url = await uploadMedia(asset.base64, 'video/mp4', ext);
      setPendingAttachment({ type: 'video', uri: url, title: 'Video clip', meta: { duration: String(Math.round((asset.duration ?? 0) / 1000)) } });
    } catch { Alert.alert('Upload failed', 'Could not upload video. Please try again.'); }
    finally { setIsUploading(false); }
  }

  // ── Voice recording ───────────────────────────────────────────────────────────

  async function handleToggleRecording() {
    if (isRecording) {
      setIsRecording(false);
      try {
        await recorder.stop();
        const status = recorder.getStatus();
        const uri = recorder.uri ?? status.url;
        if (!uri) return;
        setIsUploading(true);
        const response = await fetch(uri);
        const buf = await response.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const CHUNK = 8192;
        for (let i = 0; i < bytes.byteLength; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength)));
        }
        const url = await uploadMedia(btoa(binary), 'audio/m4a', 'm4a');
        const dur = Math.round(status.durationMillis / 1000);
        setPendingAttachment({ type: 'voice', uri: url, title: 'Voice message', meta: { duration: String(dur) } });
      } catch { Alert.alert('Recording error', 'Could not save voice message. Please try again.'); }
      finally {
        setIsUploading(false);
        void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      }
    } else {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) throw new Error('Microphone permission denied');
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setIsRecording(true);
      } catch { Alert.alert('Mic unavailable', 'Check microphone permissions in Settings.'); }
    }
  }

  // ── Voice playback ────────────────────────────────────────────────────────────

  async function handlePlayVoice(uri: string) {
    if (playingVoiceUri === uri) {
      voicePlayer.pause();
      await voicePlayer.seekTo(0).catch(() => {});
      setPlayingVoiceUri(null);
      return;
    }
    voicePlayer.pause();
    try {
      setPlayingVoiceUri(uri);
      voicePlayer.replace({ uri });
      voicePlayer.play();
    } catch { setPlayingVoiceUri(null); }
  }

  // ── Attachment renderer (media-aware) ─────────────────────────────────────────

  function renderMsgAttachment(att: MsgAttachment) {
    if (att.type === 'image') {
      let uris: string[] = [];
      try { uris = JSON.parse(att.meta?.photoUris ?? '[]'); } catch {}
      if (!uris.length && att.uri) uris = [att.uri];
      if (!uris.length) return null;
      return (
        <View style={s.photoGrid}>
          {uris.slice(0, 4).map((uri, idx) => (
            <View key={idx} style={[s.photoCell, uris.length === 1 && s.photoCellSingle]}>
              <Image source={{ uri }} style={s.photoImg} resizeMode="cover" />
              {idx === 3 && uris.length > 4 && (
                <View style={s.photoMore}><Text style={s.photoMoreText}>+{uris.length - 4}</Text></View>
              )}
            </View>
          ))}
        </View>
      );
    }
    if (att.type === 'video') {
      return (
        <View style={s.videoThumb}>
          {att.uri ? <Image source={{ uri: att.uri }} style={s.videoThumbImg} resizeMode="cover" /> : null}
          <View style={s.videoPlayOverlay}><Feather name="play-circle" size={36} color="#fff" /></View>
          {att.meta?.duration ? <View style={s.videoDurBadge}><Text style={s.videoDurText}>{att.meta.duration}s</Text></View> : null}
        </View>
      );
    }
    if (att.type === 'voice') {
      return (
        <TouchableOpacity style={s.voiceRow} activeOpacity={0.8}
          onPress={() => att.uri && handlePlayVoice(att.uri)}>
          <View style={[s.voicePlayBtn, playingVoiceUri === att.uri && s.voicePlayBtnActive]}>
            <Feather name={playingVoiceUri === att.uri ? 'square' : 'play'} size={14} color="#fff" />
          </View>
          <View style={s.voiceWave}>
            {[...Array(12)].map((_, i) => (
              <View key={i} style={[s.voiceBar, { height: 4 + Math.abs(Math.sin(i * 0.8)) * 14 }]} />
            ))}
          </View>
          <Text style={s.voiceDur}>{att.meta?.duration ? `${att.meta.duration}s` : '…'}</Text>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        style={s.attachCard}
        activeOpacity={att.type === 'product' || att.type === 'order' || att.type === 'post' ? 0.7 : 1}
        onPress={() => {
          if (att.type === 'product') {
            const pid = att.meta?.productId;
            if (pid) router.push(('/buyer-product-detail?productId=' + pid) as never);
          } else if (att.type === 'order') {
            router.push('/seller-orders' as never);
          } else if (att.type === 'post') {
            const postId = att.meta?.postId;
            if (postId) {
              const qs = [
                'postId=' + encodeURIComponent(postId),
                'postAuthorName=' + encodeURIComponent(att.meta?.authorName ?? 'Seller'),
                'postCaption=' + encodeURIComponent(att.title ?? ''),
                'postType=' + encodeURIComponent(att.meta?.mediaType ?? 'photo'),
                'postMediaColor1=' + encodeURIComponent(PURPLE_DIM),
                'postMediaColor2=' + encodeURIComponent(BG),
              ].join('&');
              router.push(('/buyer-post-viewer?' + qs) as never);
            }
          }
        }}
      >
        <Feather name={attachmentIcon(att.type)} size={ICON.sm} color={PURPLE} />
        <View style={{ flex: 1, marginLeft: SP.sm }}>
          {att.title ? <Text style={s.attachTitle} numberOfLines={1}>{att.title}</Text> : null}
          {att.subtitle ? <Text style={s.attachSubtitle} numberOfLines={1}>{att.subtitle}</Text> : null}
        </View>
        {(att.type === 'product' || att.type === 'order' || att.type === 'post') && (
          <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
        )}
      </TouchableOpacity>
    );
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
          {/* Attachment */}
          {msg.attachment && renderMsgAttachment(msg.attachment)}
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
        {id && (
          <>
            <TouchableOpacity
              style={s.headerCallBtn}
              onPress={() => handleStartCall('voice')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="phone" size={ICON.md} color={MUTED} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.headerCallBtn}
              onPress={() => handleStartCall('video')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="video" size={ICON.md} color={MUTED} />
            </TouchableOpacity>
          </>
        )}
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

        {/* Media */}
        <TouchableOpacity
          style={s.attachBtn}
          onPress={() => setShowMediaSheet(true)}
          disabled={isUploading || isSending}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {isUploading
            ? <ActivityIndicator size="small" color={PURPLE} />
            : <Feather name="camera" size={ICON.md} color={MUTED} />
          }
        </TouchableOpacity>

        {/* Voice */}
        <TouchableOpacity
          style={[s.attachBtn, isRecording && s.recordingBtn]}
          onPress={handleToggleRecording}
          disabled={isUploading || isSending}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name={isRecording ? 'stop-circle' : 'mic'} size={ICON.md} color={isRecording ? RED : MUTED} />
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

      {/* ── Media picker sheet ─────────────────────────────────────────────── */}
      <Modal
        visible={showMediaSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMediaSheet(false)}
      >
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowMediaSheet(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>Add to message</Text>
          <TouchableOpacity style={s.sheetOption} onPress={handlePickPhoto}>
            <View style={s.sheetOptionIcon}><Feather name="image" size={ICON.md} color={PURPLE} /></View>
            <View>
              <Text style={s.sheetOptionLabel}>Photos</Text>
              <Text style={s.sheetOptionDesc}>Up to 15 at once</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={s.sheetOption} onPress={handlePickVideo}>
            <View style={s.sheetOptionIcon}><Feather name="video" size={ICON.md} color={PURPLE} /></View>
            <View>
              <Text style={s.sheetOptionLabel}>Video clip</Text>
              <Text style={s.sheetOptionDesc}>Under 1 minute</Text>
            </View>
          </TouchableOpacity>
          <View style={{ height: 20 }} />
        </View>
      </Modal>

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
  root: { flex: 1, backgroundColor: 'transparent' },
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

  // ── Call + media styles ──────────────────────────────────────────────────────
  headerCallBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: SP.xs },
  recordingBtn:  { backgroundColor: 'rgba(255,59,48,0.12)', borderRadius: RADIUS.pill },

  // Photo grid
  photoGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: RADIUS.md, overflow: 'hidden' },
  photoCell:       { width: '48%', aspectRatio: 1, overflow: 'hidden', borderRadius: RADIUS.sm, position: 'relative' },
  photoCellSingle: { width: '100%', aspectRatio: 4 / 3 },
  photoImg:        { width: '100%', height: '100%' },
  photoMore:       { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  photoMoreText:   { color: '#fff', fontSize: FS.lg, fontFamily: FONT.bold },

  // Video thumb
  videoThumb:       { borderRadius: RADIUS.md, overflow: 'hidden', width: 200, height: 130, position: 'relative' },
  videoThumbImg:    { width: '100%', height: '100%' },
  videoPlayOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  videoDurBadge:    { position: 'absolute', bottom: SP.xs, right: SP.xs, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.sm, paddingHorizontal: SP.xs, paddingVertical: 2 },
  videoDurText:     { color: '#fff', fontSize: FS.xs, fontFamily: FONT.medium },

  // Voice player
  voiceRow:          { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs, minWidth: 160 },
  voicePlayBtn:      { width: 28, height: 28, borderRadius: 14, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  voicePlayBtnActive:{ backgroundColor: RED },
  voiceWave:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  voiceBar:          { width: 3, backgroundColor: PURPLE_DIM, borderRadius: 2 },
  voiceDur:          { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
});
