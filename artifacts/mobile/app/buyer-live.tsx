/**
 * Buyer Live — viewer screen for an active live stream.
 * Joins the Agora channel as audience. Falls back to a demo/placeholder
 * on Expo Go / web where the native SDK is unavailable.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import { useUser } from '@clerk/expo';
import {
  BG, BORDER, FG, MUTED, SUBTLE, PURPLE, RED,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';

const LIVE_RED = '#FF3B30';
const { width: W, height: H } = Dimensions.get('window');

// ─── Agora SDK (native-only) ──────────────────────────────────────────────────
let AgoraModule: any = null;
try { AgoraModule = require('react-native-agora'); } catch {}

interface Comment { id: string; display_name: string; message: string; created_at: string; }
interface ProductTag { productId: string; productName: string; price: number; }

export default function BuyerLiveScreen() {
  const params = useLocalSearchParams<{ streamId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { user } = useUser();

  const [stream, setStream]               = useState<any>(null);
  const [loading, setLoading]             = useState(true);
  const [ended, setEnded]                 = useState(false);
  const [comments, setComments]           = useState<Comment[]>([]);
  const [commentText, setCommentText]     = useState('');
  const [productTags, setProductTags]     = useState<ProductTag[]>([]);
  const [viewerCount, setViewerCount]     = useState(0);
  const [broadcastUid, setBroadcastUid]   = useState<number | null>(null);
  const [agoraReady, setAgoraReady]       = useState(false);

  const engineRef   = useRef<any>(null);
  const scrollRef   = useRef<ScrollView>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTs      = useRef<string>(new Date().toISOString());

  // ─── Load stream + join ──────────────────────────────────────────────────────
  useEffect(() => {
    init();
    return () => {
      handleLeave(false);
      clearInterval(pollRef.current!);
    };
  }, []);

  async function init() {
    try {
      // Get stream details
      const streamData = await (api as any).live.get(params.streamId) as any;
      const s = streamData.stream;
      if (!s || s.status !== 'live') { setEnded(true); setLoading(false); return; }
      setStream(s);
      setViewerCount(s.viewer_count ?? 0);
      setProductTags(Array.isArray(s.product_tags) ? s.product_tags : []);

      // Join — get Agora token
      const joinData = await (api as any).live.join(params.streamId) as any;

      // Init Agora if available
      if (AgoraModule && joinData.agoraAppId) {
        const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = AgoraModule;
        try {
          const engine = createAgoraRtcEngine();
          engine.initialize({ appId: joinData.agoraAppId });
          engine.setChannelProfile(ChannelProfileType.ChannelProfileLiveBroadcasting);
          engine.setClientRole(ClientRoleType.ClientRoleAudience);
          engine.enableVideo();
          engine.registerEventHandler({
            onUserJoined: (uid: number) => { setBroadcastUid(uid); setAgoraReady(true); },
            onUserOffline: () => { setEnded(true); Alert.alert('Stream ended', 'The seller has ended the live stream.'); },
            onJoinChannelSuccess: () => {},
            onError: (err: any) => console.warn('[Agora viewer]', err),
          });
          engine.joinChannel(
            joinData.token || null,
            joinData.channelName,
            joinData.agoraUid,
            { clientRoleType: AgoraModule.ClientRoleType.ClientRoleAudience },
          );
          engineRef.current = engine;
        } catch (e) {
          console.warn('[Agora viewer init]', e);
        }
      }
    } catch (e: any) {
      Alert.alert('Could not join stream', e?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }

    // Start polling comments + viewer count
    pollRef.current = setInterval(poll, 3000);
    poll();
  }

  async function poll() {
    try {
      const [commData, streamData] = await Promise.all([
        (api as any).live.comments(params.streamId, lastTs.current) as Promise<any>,
        (api as any).live.get(params.streamId) as Promise<any>,
      ]);
      const fresh: Comment[] = (commData.comments ?? []).reverse();
      if (fresh.length) {
        lastTs.current = fresh[fresh.length - 1].created_at;
        setComments(prev => [...prev, ...fresh].slice(-80));
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      }
      if (streamData.stream?.status !== 'live') setEnded(true);
      setViewerCount(streamData.stream?.viewer_count ?? 0);
      setProductTags(streamData.stream?.product_tags ?? []);
    } catch {}
  }

  async function handleLeave(navigate = true) {
    clearInterval(pollRef.current!);
    try { await (api as any).live.leave(params.streamId); } catch {}
    try { engineRef.current?.leaveChannel(); engineRef.current?.release(); } catch {}
    if (navigate) router.back();
  }

  async function sendComment() {
    const msg = commentText.trim();
    if (!msg) return;
    setCommentText('');
    // Optimistic update
    const optimistic: Comment = {
      id: Date.now().toString(),
      display_name: user?.firstName ?? user?.username ?? 'You',
      message: msg,
      created_at: new Date().toISOString(),
    };
    setComments(prev => [...prev, optimistic].slice(-80));
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      await (api as any).live.comment(params.streamId, {
        message: msg,
        displayName: user?.firstName ?? user?.username ?? 'Viewer',
      });
    } catch {}
  }

  function handleShop(tag: ProductTag) {
    router.push(`/buyer-product-detail?productId=${encodeURIComponent(tag.productId)}` as any);
  }

  const RemoteVideoView = AgoraModule ? AgoraModule.RtcSurfaceView : null;

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={LIVE_RED} size="large" />
        <Text style={[s.loadingText, { color: MUTED }]}>Joining stream…</Text>
      </View>
    );
  }

  if (ended) {
    return (
      <View style={[s.root, s.center]}>
        <View style={[s.endedIcon, { backgroundColor: `${LIVE_RED}20` }]}>
          <Feather name="video-off" size={32} color={LIVE_RED} />
        </View>
        <Text style={[s.endedTitle, { color: FG }]}>Stream ended</Text>
        <Text style={[s.endedSub, { color: MUTED }]}>The replay will appear in the feed shortly.</Text>
        <TouchableOpacity onPress={() => router.back()} style={[s.backBtn, { backgroundColor: LIVE_RED }]}>
          <Text style={s.backBtnText}>Back to feed</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.root}>
      {/* Video — Agora remote view or placeholder */}
      {RemoteVideoView && broadcastUid != null ? (
        <RemoteVideoView
          canvas={{ uid: broadcastUid, renderMode: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.videoPlaceholder]}>
          <Feather name="video" size={40} color={MUTED} />
          <Text style={s.videoPlaceholderText}>
            {AgoraModule ? 'Connecting to stream…' : 'Live video available on device'}
          </Text>
        </View>
      )}

      {/* Dark overlay */}
      <View style={[StyleSheet.absoluteFill, s.overlay]} pointerEvents="none" />

      {/* Top bar */}
      <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={s.topLeft}>
          <View style={[s.livePill, { backgroundColor: LIVE_RED }]}>
            <View style={s.liveDot} />
            <Text style={s.livePillText}>LIVE</Text>
          </View>
          <Text style={s.sellerName} numberOfLines={1}>
            {stream?.brand_name ?? stream?.seller_name ?? 'Live'}
          </Text>
        </View>
        <View style={s.topRight}>
          <View style={[s.viewerBadge, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <Feather name="eye" size={13} color="#fff" />
            <Text style={s.viewerText}>{viewerCount.toLocaleString()}</Text>
          </View>
          <TouchableOpacity onPress={() => handleLeave(true)} style={s.leaveBtn}>
            <Feather name="x" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Stream title */}
      <View style={[s.titleRow, { paddingTop: insets.top + 48 }]}>
        <Text style={s.streamTitle} numberOfLines={2}>{stream?.title}</Text>
      </View>

      {/* Product tags strip */}
      {productTags.length > 0 && (
        <View style={s.productStrip}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.productStripInner}>
            {productTags.map(tag => (
              <TouchableOpacity
                key={tag.productId}
                onPress={() => handleShop(tag)}
                activeOpacity={0.8}
                style={[s.productChip, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
              >
                <Feather name="shopping-bag" size={12} color={LIVE_RED} />
                <Text style={s.productChipName} numberOfLines={1}>{tag.productName}</Text>
                <Text style={s.productChipPrice}>${Number(tag.price).toFixed(0)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Comments + input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.bottom}
      >
        <ScrollView
          ref={scrollRef}
          style={s.commentScroll}
          contentContainerStyle={s.commentContent}
          showsVerticalScrollIndicator={false}
          pointerEvents="none"
        >
          {comments.map(c => (
            <View key={c.id} style={s.commentRow}>
              <Text style={s.commentName}>{c.display_name} </Text>
              <Text style={s.commentMsg}>{c.message}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={[s.inputRow, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            value={commentText}
            onChangeText={setCommentText}
            onSubmitEditing={sendComment}
            placeholder="Add a comment…"
            placeholderTextColor="rgba(255,255,255,0.45)"
            returnKeyType="send"
            style={s.textInput}
          />
          <TouchableOpacity onPress={sendComment} activeOpacity={0.7} style={s.sendBtn}>
            <Feather name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: '#000' },
  center:           { alignItems: 'center', justifyContent: 'center', gap: 12 },
  overlay:          { backgroundColor: 'rgba(0,0,0,0.2)' },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a', gap: 12 },
  videoPlaceholderText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingHorizontal: 40 },
  loadingText:      { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 8 },
  topBar:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topLeft:          { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  topRight:         { flexDirection: 'row', alignItems: 'center', gap: 10 },
  livePill:         { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 4 },
  liveDot:          { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  livePillText:     { color: '#fff', fontFamily: FONT.bold, fontSize: 11, letterSpacing: 1.2 },
  sellerName:       { color: '#fff', fontFamily: FONT.semibold, fontSize: 13, flex: 1 },
  viewerBadge:      { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 4 },
  viewerText:       { color: '#fff', fontFamily: FONT.semibold, fontSize: 12 },
  leaveBtn:         { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  titleRow:         { position: 'absolute', top: 0, left: 14, right: 60, zIndex: 9 },
  streamTitle:      { color: 'rgba(255,255,255,0.85)', fontFamily: FONT.medium, fontSize: 13 },
  productStrip:     { position: 'absolute', bottom: 155, left: 0, right: 0, zIndex: 8 },
  productStripInner:{ paddingHorizontal: 12, gap: 8 },
  productChip:      { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 7 },
  productChipName:  { color: '#fff', fontFamily: FONT.semibold, fontSize: 12, maxWidth: 90 },
  productChipPrice: { color: 'rgba(255,255,255,0.7)', fontFamily: FONT.regular, fontSize: 11 },
  bottom:           { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 },
  commentScroll:    { maxHeight: 185, marginHorizontal: 12 },
  commentContent:   { gap: 3, paddingBottom: 6 },
  commentRow:       { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingVertical: 3 },
  commentName:      { color: '#fff', fontFamily: FONT.bold, fontSize: 12 },
  commentMsg:       { color: 'rgba(255,255,255,0.88)', fontFamily: FONT.regular, fontSize: 12 },
  inputRow:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 6 },
  textInput:        { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: RADIUS.pill, paddingHorizontal: 15, paddingVertical: 9, color: '#fff', fontFamily: FONT.regular, fontSize: FS.sm },
  sendBtn:          { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  // Ended
  endedIcon:        { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  endedTitle:       { fontSize: FS.lg, fontFamily: FONT.bold },
  endedSub:         { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },
  backBtn:          { marginTop: 24, borderRadius: RADIUS.pill, paddingHorizontal: 28, paddingVertical: 12 },
  backBtnText:      { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.sm },
});
