import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Alert, Platform, StyleSheet, Dimensions,
  ListRenderItemInfo, Modal, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import {
  BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE,
  ORANGE, RED, ON_DARK, FONT, FS, SP, RADIUS, COMP, ICON,
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
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@clerk/expo';
import { apiErrorMessage, confirmBlock, confirmUnblock, reportHref } from '@/lib/safety';
import { BlockedComposer, type DmMessagingState } from '@/components/safety/DmSafety';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';

// ─── Types ────────────────────────────────────────────────────────────────────

type SellerProduct = {
  id: string;
  name: string;
  images?: string[] | null;
  variants?: Array<{ priceCents?: number | null }>;
  category?: string | null;
};

type SellerPost = {
  id: string;
  userId: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  caption?: string | null;
  displayName?: string | null;
};

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
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = colors.accent, CYAN = theme.secondary, CYAN_DIM = theme.secondaryDim;
  const BORDER_ACTIVE = `${theme.accent}73`;
  const GRAD_PRIMARY = theme.primaryGradient;
  const s = makeStyles(theme);
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
  const api = useApi();
  const { userId } = useAuth();
  /** The signed-in Clerk user; legacy local records used the literal 'me'. */
  const myId = userId ?? MY_USER_ID;
  const [messaging, setMessaging] = useState<DmMessagingState>({ blockedByMe: false, unavailable: false });

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);
  const [isRecording, setIsRecording]         = useState(false);
  const [isUploading, setIsUploading]         = useState(false);
  const [playingVoiceUri, setPlayingVoiceUri] = useState<string | null>(null);
  const [showMediaSheet, setShowMediaSheet]   = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voicePlayer = useAudioPlayer(null);
  const voicePlayerStatus = useAudioPlayerStatus(voicePlayer);

  // Attachment state
  const [selectedAttachment, setSelectedAttachment] = useState<MessageAttachment | null>(null);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [attachmentTab, setAttachmentTab] = useState<'product' | 'post'>('product');
  const [sellerProducts, setSellerProducts] = useState<SellerProduct[]>([]);
  const [sellerPosts, setSellerPosts] = useState<SellerPost[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [postsLoading, setPostsLoading] = useState(false);

  // ── Load conversation + messages ────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!userId) {
      setConv(null);
      setMessages([]);
      setIsLoading(false);
      return;
    }
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
      const safety = (loadedConv as { messaging?: DmMessagingState } | null)?.messaging;
      setMessaging({ blockedByMe: !!safety?.blockedByMe, unavailable: !!safety?.unavailable });
      if (loadedConv) {
        const msgs = await getMessages(loadedConv.id);
        setMessages(msgs);
      }
    } catch (e) {
      console.error('Failed to load conversation', e);
    } finally {
      setIsLoading(false);
    }
  }, [params.id, params.participantId, userId]);

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

  useEffect(() => {
    if (voicePlayerStatus.didJustFinish) setPlayingVoiceUri(null);
  }, [voicePlayerStatus.didJustFinish]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  // API conversations include both participants, and SQL does not guarantee their
  // order. Resolve the seller explicitly so attachment pickers never load the
  // buyer's own catalog.
  const participant = conv?.participants.find(
    (p) => p.accountType === 'seller' && p.userId !== myId && p.userId !== MY_USER_ID,
  ) ?? conv?.participants.find((p) => p.accountType === 'seller')
    ?? conv?.participants.find((p) => p.userId !== myId && p.userId !== MY_USER_ID)
    ?? conv?.participants[0]
    ?? null;
  const displayName = participant?.name ?? params.participantName ?? 'Unknown';
  const displayHandle = participant?.handle ?? params.participantHandle ?? '';
  const isDisabled = conv?.isFriendshipActive === false;
  const canSend = (text.trim().length > 0 || selectedAttachment != null) && !isDisabled && !isSending;

  // Show "View store" button for any seller conversation (resolved or pre-created)
  const convType = conv?.type ?? params.type ?? '';
  const isSellerConv = convType === 'buyer_to_seller'
    || convType === 'buyer_to_seller_product'
    || convType === 'buyer_to_seller_order';
  const sellerUserId = participant?.userId ?? params.participantId ?? '';

  // ── Load seller products for attachment picker ───────────────────────────────

  async function loadSellerProducts() {
    if (!sellerUserId) return;
    setProductsLoading(true);
    try {
      const data = await api.products.publicList(sellerUserId);
      setSellerProducts(data ?? []);
    } catch {
      setSellerProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }

  async function loadSellerPosts() {
    if (!sellerUserId) return;
    setPostsLoading(true);
    try {
      const data = await api.posts.publicList(sellerUserId);
      setSellerPosts(data ?? []);
    } catch {
      setSellerPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }

  function openAttachmentPicker() {
    if (!isSellerConv || !sellerUserId) {
      Alert.alert('Attachments', 'You can attach products or posts when messaging a seller.');
      return;
    }
    setShowAttachmentPicker(true);
    if (sellerProducts.length === 0) {
      loadSellerProducts();
    }
    if (sellerPosts.length === 0) {
      loadSellerPosts();
    }
  }

  // ── Media upload helper ───────────────────────────────────────────────────────

  async function uploadMedia(base64: string, mimeType: string, extension: string): Promise<string> {
    const result = await api.conversations.uploadMedia({ data: base64, mimeType, extension });
    return result.url;
  }

  // ── 1:1 voice / video call ────────────────────────────────────────────────────

  function handleStartCall(mode: 'voice' | 'video') {
    if (!conv) { Alert.alert('Not ready', 'Wait for the conversation to load.'); return; }
    const p = participant;
    const qs = new URLSearchParams({
      conversationId: conv.id,
      participantName: displayName,
      participantInitials: p?.initials ?? '?',
      participantColor: p?.color ?? PURPLE,
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
      setSelectedAttachment({
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
      setSelectedAttachment({
        type: 'video', uri: url,
        title: 'Video clip',
        meta: { duration: String(Math.round((asset.duration ?? 0) / 1000)) },
      });
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
        setSelectedAttachment({ type: 'voice', uri: url, title: 'Voice message', meta: { duration: String(dur) } });
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
      } catch { Alert.alert('Mic unavailable', 'Could not access microphone. Check permissions in Settings.'); }
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

  // ── Attachment renderer (handles image / video / voice inline) ────────────────

  function renderAttachment(att: MessageAttachment) {
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
    // Default: product / order / post / profile card
    return (
      <TouchableOpacity
        style={s.attachCard}
        activeOpacity={att.type === 'product' || att.type === 'order' || att.type === 'post' ? 0.7 : 1}
        onPress={() => {
          if (att.type === 'product') {
            const pid = att.meta?.productId;
            if (pid) router.push(('/buyer-product-detail?productId=' + pid) as never);
            else if (participant) router.push(('/seller-profile?id=' + participant.userId) as never);
          } else if (att.type === 'order') {
            router.push('/(buyer)/orders' as never);
          } else if (att.type === 'post') {
            const postId = att.meta?.postId;
            if (postId) {
              const postAuthorName = att.meta?.authorName ?? participant?.name ?? 'Seller';
              const qs = [
                'postId=' + encodeURIComponent(postId),
                'postAuthorName=' + encodeURIComponent(postAuthorName),
                'postAuthorInitials=' + encodeURIComponent(participant?.initials ?? '?'),
                'postAuthorColor=' + encodeURIComponent(participant?.color ?? PURPLE),
                'postCaption=' + encodeURIComponent(att.title ?? ''),
                'postMediaColor1=' + encodeURIComponent(PURPLE_DIM),
                'postMediaColor2=' + encodeURIComponent(BG),
                'postType=' + encodeURIComponent(att.meta?.mediaType ?? 'photo'),
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
          <Feather name="chevron-right" size={ICON.xs} color={MUTED} />
        )}
      </TouchableOpacity>
    );
  }

  function pickProduct(product: SellerProduct) {
    const prices = (product.variants ?? [])
      .map((variant) => variant.priceCents ?? 0)
      .filter((price) => price > 0);
    const lowestPriceCents = prices.length > 0 ? Math.min(...prices) : null;
    const attachment: MessageAttachment = {
      type: 'product',
      title: product.name,
      subtitle: `${lowestPriceCents == null ? 'Product' : formatCents(lowestPriceCents)}${product.category ? ` · ${product.category}` : ''}`,
      accentColor: PURPLE,
      uri: product.images?.[0] ?? undefined,
      meta: { productId: product.id },
    };
    setSelectedAttachment(attachment);
    setShowAttachmentPicker(false);
  }

  function pickPost(post: SellerPost) {
    const attachment: MessageAttachment = {
      type: 'post',
      title: post.caption?.trim() || 'Seller post',
      subtitle: `${displayName} · ${post.mediaType ?? 'post'}`,
      accentColor: PURPLE,
      uri: post.mediaUrl ?? undefined,
      meta: {
        postId: post.id,
        authorName: post.displayName ?? displayName,
        mediaType: post.mediaType ?? 'photo',
      },
    };
    setSelectedAttachment(attachment);
    setShowAttachmentPicker(false);
  }

  // ── Send message ────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!conv || !canSend) return;
    const t = text.trim();
    const att = selectedAttachment;
    const replyingTo = replyTo;
    setText('');
    setSelectedAttachment(null);
    setReplyTo(null);
    setIsSending(true);
    try {
      await sendMessage(conv.id, t, att ?? undefined, replyingTo?.id);
      const msgs = await getMessages(conv.id);
      setMessages(msgs);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      Alert.alert('Message not sent', apiErrorMessage(e, 'Please check your connection and try again.'));
      setText(t);
      setSelectedAttachment(att);
      setReplyTo(replyingTo);
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
      messaging.blockedByMe
        ? {
            text: `Unblock ${participant.name}`,
            onPress: async () => {
              if (await confirmUnblock({ userId: participant.userId, name: participant.name }, api.social.unblock)) {
                setMessaging((current) => ({ ...current, blockedByMe: false }));
              }
            },
          }
        : {
            text: `Block ${participant.name}`,
            style: 'destructive' as const,
            onPress: async () => {
              if (await confirmBlock({ userId: participant.userId, name: participant.name }, api.social.block)) {
                setMessaging((current) => ({ ...current, blockedByMe: true }));
              }
            },
          },
      {
        text: `Report ${participant.name}`,
        onPress: () => {
          router.push(reportHref({
            targetType: 'profile',
            targetId: participant.userId,
            label: participant.name,
            ownerId: participant.userId,
            ownerName: participant.name,
          }) as never);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Message long press ──────────────────────────────────────────────────────

  function longPressMessage(msg: Message) {
    const isOwn = msg.fromId === myId || msg.fromId === MY_USER_ID;
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
          Clipboard.setStringAsync(msg.text);
          setCopiedToast(true);
          setTimeout(() => setCopiedToast(false), 1600);
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
    if (!isOwn) {
      options.push({
        text: 'Report message',
        onPress: () => {
          router.push(reportHref({
            targetType: 'message',
            targetId: msg.id,
            label: participant ? `Message from ${participant.name}` : 'Message',
            ownerId: participant?.userId,
            ownerName: participant?.name,
          }) as never);
        },
      });
    }
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
    const isOwn = msg.fromId === myId || msg.fromId === MY_USER_ID;

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
          {/* Quoted reply */}
          {msg.replyToId ? (
            <View style={s.replyQuote}>
              <Text style={s.replyQuoteText} numberOfLines={1}>
                {msg.replyPreview ?? messages.find(m => m.id === msg.replyToId)?.text ?? 'Message'}
              </Text>
            </View>
          ) : null}

          {/* Attachment */}
          {msg.attachment && renderAttachment(msg.attachment)}

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

        {conv && (
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
      {participant && (messaging.blockedByMe || messaging.unavailable) ? (
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
      ) : !isDisabled ? (
        <View>
          {selectedAttachment && (
            <View style={s.selectedAttachment}>
              <Feather
                name={
                  selectedAttachment.type === 'image' ? 'image' :
                  selectedAttachment.type === 'video' ? 'video' :
                  selectedAttachment.type === 'voice' ? 'mic' :
                  selectedAttachment.type === 'post'  ? 'image' : 'shopping-bag'
                }
                size={ICON.sm}
                color={PURPLE}
              />
              <View style={{ flex: 1, marginLeft: SP.sm }}>
                <Text style={s.selectedAttachmentLabel}>
                  {
                    selectedAttachment.type === 'image' ? 'Photo attached' :
                    selectedAttachment.type === 'video' ? 'Video attached' :
                    selectedAttachment.type === 'voice' ? 'Voice message' :
                    selectedAttachment.type === 'post'  ? 'Post attached'  : 'Product attached'
                  }
                </Text>
                <Text style={s.selectedAttachmentTitle} numberOfLines={1}>
                  {selectedAttachment.title}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedAttachment(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={ICON.sm} color={MUTED} />
              </TouchableOpacity>
            </View>
          )}
          <View style={[s.inputRow, { paddingBottom: insets.bottom + SP.sm }]}>
          {/* Attach */}
          <TouchableOpacity
            onPress={openAttachmentPicker}
            style={s.attachBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="paperclip" size={ICON.lg} color={MUTED} />
          </TouchableOpacity>

          {/* Media */}
          <TouchableOpacity
            onPress={() => setShowMediaSheet(true)}
            style={s.attachBtn}
            disabled={isUploading || isSending}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isUploading
              ? <ActivityIndicator size="small" color={PURPLE} />
              : <Feather name="camera" size={ICON.lg} color={MUTED} />
            }
          </TouchableOpacity>

          {/* Voice */}
          <TouchableOpacity
            onPress={handleToggleRecording}
            style={[s.attachBtn, isRecording && s.recordingBtn]}
            disabled={isUploading || isSending}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name={isRecording ? 'stop-circle' : 'mic'} size={ICON.lg} color={isRecording ? RED : MUTED} />
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
        </View>
      ) : (
        <View style={[s.inputRow, s.disabledInputRow, { paddingBottom: insets.bottom + SP.sm }]}>
          <Text style={s.disabledInputText}>Messaging disabled</Text>
        </View>
      )}

      {/* ── Media picker sheet ─────────────────────────────────────────────── */}
      <Modal
        visible={showMediaSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMediaSheet(false)}
      >
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowMediaSheet(false)} />
        <View style={s.mediaSheet}>
          <View style={s.mediaSheetHandle} />
          <Text style={s.mediaSheetTitle}>Add to message</Text>
          <TouchableOpacity style={s.mediaSheetOption} onPress={handlePickPhoto}>
            <View style={s.mediaSheetIcon}><Feather name="image" size={ICON.md} color={PURPLE} /></View>
            <View>
              <Text style={s.mediaSheetLabel}>Photos</Text>
              <Text style={s.mediaSheetDesc}>Up to 15 at once</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={s.mediaSheetOption} onPress={handlePickVideo}>
            <View style={s.mediaSheetIcon}><Feather name="video" size={ICON.md} color={PURPLE} /></View>
            <View>
              <Text style={s.mediaSheetLabel}>Video clip</Text>
              <Text style={s.mediaSheetDesc}>Under 1 minute</Text>
            </View>
          </TouchableOpacity>
          <View style={{ height: 20 }} />
        </View>
      </Modal>

      <Modal
        visible={showAttachmentPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAttachmentPicker(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.productPicker}>
            <View style={s.pickerHeader}>
              <View>
                <Text style={s.pickerTitle}>Attach to message</Text>
                <Text style={s.pickerSubtitle}>Choose from {displayName}'s store</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowAttachmentPicker(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={ICON.md} color={MUTED} />
              </TouchableOpacity>
            </View>
            <View style={s.attachmentTabs}>
              <TouchableOpacity
                style={[s.attachmentTab, attachmentTab === 'product' && s.attachmentTabActive]}
                onPress={() => setAttachmentTab('product')}
              >
                <Feather name="shopping-bag" size={ICON.sm} color={attachmentTab === 'product' ? PURPLE : MUTED} />
                <Text style={[s.attachmentTabText, attachmentTab === 'product' && s.attachmentTabTextActive]}>
                  Products
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.attachmentTab, attachmentTab === 'post' && s.attachmentTabActive]}
                onPress={() => setAttachmentTab('post')}
              >
                <Feather name="image" size={ICON.sm} color={attachmentTab === 'post' ? PURPLE : MUTED} />
                <Text style={[s.attachmentTabText, attachmentTab === 'post' && s.attachmentTabTextActive]}>
                  Posts
                </Text>
              </TouchableOpacity>
            </View>
            {attachmentTab === 'product' ? (
              productsLoading ? (
                <View style={s.pickerLoading}>
                  <ActivityIndicator color={PURPLE} />
                  <Text style={s.pickerEmptyText}>Loading products…</Text>
                </View>
              ) : sellerProducts.length === 0 ? (
                <View style={s.pickerLoading}>
                  <Feather name="shopping-bag" size={ICON.lg} color={SUBTLE} />
                  <Text style={s.pickerEmptyText}>No active products available.</Text>
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={s.productList}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {sellerProducts.map((product) => {
                    const prices = (product.variants ?? [])
                      .map((variant) => variant.priceCents ?? 0)
                      .filter((price) => price > 0);
                    const lowestPriceCents = prices.length > 0 ? Math.min(...prices) : null;
                    return (
                      <TouchableOpacity
                        key={product.id}
                        style={s.productOption}
                        onPress={() => pickProduct(product)}
                        activeOpacity={0.75}
                      >
                        {product.images?.[0] ? (
                          <Image source={{ uri: product.images[0] }} style={s.productThumb} />
                        ) : (
                          <View style={s.productThumbPlaceholder}>
                            <Feather name="shopping-bag" size={ICON.md} color={PURPLE} />
                          </View>
                        )}
                        <View style={{ flex: 1, marginLeft: SP.sm }}>
                          <Text style={s.productOptionName} numberOfLines={1}>{product.name}</Text>
                          <Text style={s.productOptionMeta} numberOfLines={1}>
                            {lowestPriceCents == null ? 'Product' : formatCents(lowestPriceCents)}
                            {product.category ? ` · ${product.category}` : ''}
                          </Text>
                        </View>
                        <Feather name="plus-circle" size={ICON.md} color={PURPLE} />
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )
            ) : (
              postsLoading ? (
                <View style={s.pickerLoading}>
                  <ActivityIndicator color={PURPLE} />
                  <Text style={s.pickerEmptyText}>Loading posts…</Text>
                </View>
              ) : sellerPosts.length === 0 ? (
                <View style={s.pickerLoading}>
                  <Feather name="image" size={ICON.lg} color={SUBTLE} />
                  <Text style={s.pickerEmptyText}>No published posts available.</Text>
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={s.productList}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {sellerPosts.map((post) => (
                    <TouchableOpacity
                      key={post.id}
                      style={s.productOption}
                      onPress={() => pickPost(post)}
                      activeOpacity={0.75}
                    >
                      {post.mediaUrl ? (
                        <Image source={{ uri: post.mediaUrl }} style={s.productThumb} />
                      ) : (
                        <View style={s.productThumbPlaceholder}>
                          <Feather name="image" size={ICON.md} color={PURPLE} />
                        </View>
                      )}
                      <View style={{ flex: 1, marginLeft: SP.sm }}>
                        <Text style={s.productOptionName} numberOfLines={2}>
                          {post.caption?.trim() || 'Seller post'}
                        </Text>
                        <Text style={s.productOptionMeta} numberOfLines={1}>
                          {post.mediaType ?? 'post'} · {displayName}
                        </Text>
                      </View>
                      <Feather name="plus-circle" size={ICON.md} color={PURPLE} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )
            )}
          </View>
        </View>
      </Modal>

      {copiedToast && (
        <View pointerEvents="none" style={s.copiedToast} accessibilityLiveRegion="polite">
          <Text style={s.copiedToastText}>Copied</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = theme.accentDim, CYAN = theme.secondary, CYAN_DIM = theme.secondaryDim;
  const BORDER_ACTIVE = `${theme.accent}73`;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },

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
    color: ON_DARK,
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
    color: ON_DARK,
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
  selectedAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  selectedAttachmentLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE,
  },
  selectedAttachmentTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
    marginTop: 1,
  },

  // Message text
  msgText: {
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
  },

  copiedToast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 96,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
  },
  copiedToastText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },

  // Quoted reply snippet
  replyQuote: {
    borderLeftWidth: 2,
    borderLeftColor: BORDER_ACTIVE,
    paddingLeft: 8,
    marginBottom: 4,
  },
  replyQuoteText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
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
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  productPicker: {
    maxHeight: '78%',
    backgroundColor: BG,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1,
    borderColor: BORDER,
    paddingBottom: SP.xl,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  pickerTitle: {
    fontSize: FS.lg,
    fontFamily: FONT.semibold,
    color: FG,
  },
  pickerSubtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 2,
  },
  attachmentTabs: {
    flexDirection: 'row',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
  },
  attachmentTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.md,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  attachmentTabActive: {
    backgroundColor: PURPLE_DIM,
    borderColor: BORDER_ACTIVE,
  },
  attachmentTabText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  attachmentTabTextActive: {
    color: PURPLE,
  },
  pickerLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 150,
    gap: SP.sm,
  },
  pickerEmptyText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  productList: {
    padding: SP.md,
    gap: SP.sm,
  },
  productOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  productThumb: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD_ELEVATED,
  },
  productThumbPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.sm,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productOptionName: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  productOptionMeta: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 3,
  },

  // ── Call + media styles ──────────────────────────────────────────────────────
  headerCallBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: SP.xs },
  recordingBtn:  { backgroundColor: 'rgba(255,59,48,0.12)', borderRadius: RADIUS.pill },
  mediaSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg,
    paddingHorizontal: SP.md, paddingTop: SP.sm,
  },
  mediaSheetHandle: { width: 36, height: 4, backgroundColor: BORDER, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  mediaSheetTitle:  { fontSize: FS.lg, fontFamily: FONT.semibold, color: FG, marginBottom: SP.md },
  mediaSheetOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.md, gap: SP.sm },
  mediaSheetIcon:   { width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  mediaSheetLabel:  { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  mediaSheetDesc:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  // Photo grid
  photoGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: RADIUS.md, overflow: 'hidden' },
  photoCell:      { width: '48%', aspectRatio: 1, overflow: 'hidden', borderRadius: RADIUS.sm, position: 'relative' },
  photoCellSingle:{ width: '100%', aspectRatio: 4 / 3 },
  photoImg:       { width: '100%', height: '100%' },
  photoMore:      { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  photoMoreText:  { color: '#fff', fontSize: FS.lg, fontFamily: FONT.bold },

  // Video thumb
  videoThumb:       { borderRadius: RADIUS.md, overflow: 'hidden', width: 200, height: 130, position: 'relative' },
  videoThumbImg:    { width: '100%', height: '100%' },
  videoPlayOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  videoDurBadge:    { position: 'absolute', bottom: SP.xs, right: SP.xs, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.sm, paddingHorizontal: SP.xs, paddingVertical: 2 },
  videoDurText:     { color: '#fff', fontSize: FS.xs, fontFamily: FONT.medium },

  // Voice player
  voiceRow:         { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs, minWidth: 160 },
  voicePlayBtn:     { width: 28, height: 28, borderRadius: 14, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  voicePlayBtnActive: { backgroundColor: RED },
  voiceWave:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  voiceBar:         { width: 3, backgroundColor: PURPLE_DIM, borderRadius: 2 },
  voiceDur:         { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

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
};
