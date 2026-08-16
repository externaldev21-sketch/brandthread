/**
 * Seller Live — active broadcast screen.
 * Uses react-native-agora in host mode. Gracefully degrades when native
 * Agora SDK is unavailable (Expo Go / web preview).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useUser } from '@clerk/expo';
import {
  BG, BORDER, FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';

const LIVE_RED = '#FF3B30';
const { width: W, height: H } = Dimensions.get('window');

// ─── Agora SDK (native-only, gracefully skipped on web/Expo Go) ───────────────
let AgoraModule: any = null;
try {
  AgoraModule = require('react-native-agora');
} catch {}

interface Comment { id: string; display_name: string; message: string; created_at: string; }

export default function SellerLiveScreen() {
  const params = useLocalSearchParams<{
    streamId: string; channelName: string; agoraUid: string;
    agoraAppId: string; token: string; title: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { user } = useUser();

  const [viewerCount, setViewerCount]     = useState(0);
  const [comments, setComments]           = useState<Comment[]>([]);
  const [commentText, setCommentText]     = useState('');
  const [duration, setDuration]           = useState(0);
  const [productTags, setProductTags]     = useState<any[]>([]);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [allProducts, setAllProducts]     = useState<any[]>([]);
  const [ending, setEnding]               = useState(false);
  const [agoraReady, setAgoraReady]       = useState(false);

  const engineRef     = useRef<any>(null);
  const commentsRef   = useRef<ScrollView>(null);
  const pollRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCommentTs = useRef<string>(new Date().toISOString());

  // ─── Init Agora ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!AgoraModule || !params.agoraAppId) return;

    const {
      createAgoraRtcEngine,
      ChannelProfileType,
      ClientRoleType,
    } = AgoraModule;

    try {
      const engine = createAgoraRtcEngine();
      engine.initialize({ appId: params.agoraAppId });
      engine.setChannelProfile(ChannelProfileType.ChannelProfileLiveBroadcasting);
      engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
      engine.enableVideo();
      engine.startPreview();
      engine.registerEventHandler({
        onJoinChannelSuccess: () => setAgoraReady(true),
        onUserJoined:  ()    => setViewerCount(c => c + 1),
        onUserOffline: ()    => setViewerCount(c => Math.max(0, c - 1)),
        onError:       (err: any) => console.warn('[Agora]', err),
      });
      engine.joinChannel(
        params.token || null,
        params.channelName,
        parseInt(params.agoraUid, 10),
        { clientRoleType: AgoraModule.ClientRoleType.ClientRoleBroadcaster },
      );
      engineRef.current = engine;
    } catch (e) {
      console.warn('[Agora init]', e);
    }

    return () => {
      try {
        engineRef.current?.leaveChannel();
        engineRef.current?.release();
      } catch {}
    };
  }, []);

  // ─── Timers: duration + comment polling ──────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    pollRef.current  = setInterval(pollComments, 3000);
    pollComments();
    loadProducts();
    return () => {
      clearInterval(timerRef.current!);
      clearInterval(pollRef.current!);
    };
  }, []);

  async function pollComments() {
    try {
      const data = await (api as any).live.comments(params.streamId, lastCommentTs.current) as any;
      const newComments: Comment[] = (data.comments ?? []).reverse();
      if (newComments.length) {
        lastCommentTs.current = newComments[newComments.length - 1].created_at;
        setComments(prev => [...prev, ...newComments].slice(-80));
        setTimeout(() => commentsRef.current?.scrollToEnd({ animated: true }), 100);
      }
    } catch {}
  }

  async function loadProducts() {
    try {
      const r = await (api as any).products?.list?.() as any;
      setAllProducts(r?.products ?? []);
    } catch {}
  }

  function formatDuration(secs: number) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  async function sendComment() {
    const msg = commentText.trim();
    if (!msg) return;
    setCommentText('');
    try {
      await (api as any).live.comment(params.streamId, {
        message: msg,
        displayName: user?.firstName ?? user?.username ?? 'Host',
      });
    } catch {}
  }

  async function toggleProduct(product: any) {
    Haptics.selectionAsync();
    const exists = productTags.find(t => t.productId === product.id);
    const updated = exists
      ? productTags.filter(t => t.productId !== product.id)
      : [...productTags, {
          productId: product.id,
          productName: product.name,
          price: product.priceCents ? product.priceCents / 100 : 0,
        }];
    setProductTags(updated);
    try {
      await (api as any).live.updateProducts(params.streamId, updated);
    } catch {}
  }

  async function handleEnd() {
    Alert.alert('End stream?', 'Your stream will be saved as a replay in the Thread feed.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'End & save', style: 'destructive',
        onPress: async () => {
          setEnding(true);
          try {
            await (api as any).live.end(params.streamId);
          } catch {}
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/(seller)/(tabs)/home' as any);
        },
      },
    ]);
  }

  const LocalCameraView = AgoraModule
    ? AgoraModule.RtcSurfaceView
    : null;

  return (
    <View style={s.root}>
      {/* Camera preview (Agora host view) */}
      {LocalCameraView ? (
        <LocalCameraView
          canvas={{ uid: 0, renderMode: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.cameraPlaceholder]}>
          <Feather name="video" size={48} color={MUTED} />
          <Text style={s.cameraPlaceholderText}>Camera preview available on device</Text>
        </View>
      )}

      {/* Gradient overlay */}
      <View style={[StyleSheet.absoluteFill, s.overlay]} pointerEvents="none" />

      {/* Top bar */}
      <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={s.topLeft}>
          <View style={[s.livePill, { backgroundColor: LIVE_RED }]}>
            <View style={s.liveDot} />
            <Text style={s.livePillText}>LIVE</Text>
          </View>
          <Text style={s.durationText}>{formatDuration(duration)}</Text>
        </View>
        <TouchableOpacity onPress={handleEnd} disabled={ending} style={s.endBtn}>
          {ending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.endBtnText}>End</Text>}
        </TouchableOpacity>
      </View>

      {/* Viewer count */}
      <View style={[s.viewerRow, { paddingTop: insets.top + 48 }]}>
        <View style={[s.viewerBadge, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <Feather name="eye" size={13} color="#fff" />
          <Text style={s.viewerText}>{viewerCount.toLocaleString()}</Text>
        </View>
      </View>

      {/* Right action rail */}
      <View style={[s.rightRail, { paddingTop: insets.top + 80 }]}>
        {/* Products */}
        <TouchableOpacity onPress={() => setShowProductPicker(true)} style={s.railBtn} activeOpacity={0.7}>
          <Feather name="shopping-bag" size={22} color="#fff" />
          {productTags.length > 0 && (
            <View style={[s.railBadge, { backgroundColor: LIVE_RED }]}>
              <Text style={s.railBadgeText}>{productTags.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        {/* Switch camera */}
        <TouchableOpacity
          style={s.railBtn}
          activeOpacity={0.7}
          onPress={() => engineRef.current?.switchCamera?.()}
        >
          <Feather name="refresh-cw" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Tagged products strip */}
      {productTags.length > 0 && (
        <View style={s.productStrip}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.productStripContent}>
            {productTags.map(tag => (
              <View key={tag.productId} style={[s.productChip, { backgroundColor: 'rgba(0,0,0,0.65)' }]}>
                <Feather name="shopping-bag" size={12} color={LIVE_RED} />
                <Text style={s.productChipText} numberOfLines={1}>{tag.productName}</Text>
                <Text style={s.productChipPrice}>${Number(tag.price).toFixed(0)}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Comments + input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.bottomSection}
      >
        {/* Comments scroll */}
        <ScrollView
          ref={commentsRef}
          style={s.commentScroll}
          contentContainerStyle={s.commentContent}
          showsVerticalScrollIndicator={false}
          pointerEvents="none"
        >
          {comments.map(c => (
            <View key={c.id} style={s.commentBubble}>
              <Text style={s.commentAuthor}>{c.display_name} </Text>
              <Text style={s.commentText}>{c.message}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Comment input */}
        <View style={[s.inputRow, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            value={commentText}
            onChangeText={setCommentText}
            onSubmitEditing={sendComment}
            placeholder="Say something…"
            placeholderTextColor="rgba(255,255,255,0.5)"
            returnKeyType="send"
            style={s.commentInput}
          />
          <TouchableOpacity onPress={sendComment} style={s.sendBtn} activeOpacity={0.7}>
            <Feather name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Product picker modal */}
      {showProductPicker && (
        <View style={[StyleSheet.absoluteFill, s.pickerModal]}>
          <View style={[s.pickerSheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Tag products</Text>
              <TouchableOpacity onPress={() => setShowProductPicker(false)}>
                <Feather name="x" size={22} color={FG} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {allProducts.map(p => {
                const tagged = productTags.some(t => t.productId === p.id);
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => toggleProduct(p)}
                    activeOpacity={0.7}
                    style={[s.pickerRow, tagged && { backgroundColor: `${PURPLE}12` }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.pickerRowName, { color: FG }]} numberOfLines={1}>{p.name}</Text>
                      <Text style={[s.pickerRowPrice, { color: MUTED }]}>${((p.priceCents ?? 0)/100).toFixed(2)}</Text>
                    </View>
                    <View style={[s.checkbox, tagged && { backgroundColor: PURPLE, borderColor: PURPLE }]}>
                      {tagged && <Feather name="check" size={13} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
              {allProducts.length === 0 && (
                <Text style={[s.emptyText, { color: MUTED }]}>No products found</Text>
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: '#000' },
  overlay:          { backgroundColor: 'rgba(0,0,0,0.25)' },
  cameraPlaceholder:{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a', gap: 12 },
  cameraPlaceholderText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingHorizontal: 40 },
  topBar:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topLeft:          { flexDirection: 'row', alignItems: 'center', gap: 10 },
  livePill:         { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 5 },
  liveDot:          { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  livePillText:     { color: '#fff', fontFamily: FONT.bold, fontSize: 12, letterSpacing: 1.5 },
  durationText:     { color: 'rgba(255,255,255,0.85)', fontFamily: FONT.semibold, fontSize: 13 },
  endBtn:           { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.sm, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  endBtnText:       { color: '#fff', fontFamily: FONT.semibold, fontSize: 13 },
  viewerRow:        { position: 'absolute', top: 0, left: 16, zIndex: 9 },
  viewerBadge:      { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 5 },
  viewerText:       { color: '#fff', fontFamily: FONT.semibold, fontSize: 12 },
  rightRail:        { position: 'absolute', right: 12, top: 0, zIndex: 10, gap: 16 },
  railBtn:          { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  railBadge:        { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  railBadgeText:    { color: '#fff', fontFamily: FONT.bold, fontSize: 10 },
  productStrip:     { position: 'absolute', bottom: 160, left: 0, right: 0, zIndex: 8 },
  productStripContent: { paddingHorizontal: 12, gap: 8 },
  productChip:      { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 7 },
  productChipText:  { color: '#fff', fontFamily: FONT.semibold, fontSize: 12, maxWidth: 100 },
  productChipPrice: { color: 'rgba(255,255,255,0.7)', fontFamily: FONT.regular, fontSize: 11 },
  bottomSection:    { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 },
  commentScroll:    { maxHeight: 200, marginHorizontal: 12 },
  commentContent:   { gap: 4, paddingBottom: 8 },
  commentBubble:    { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingVertical: 4 },
  commentAuthor:    { color: '#fff', fontFamily: FONT.bold, fontSize: 12 },
  commentText:      { color: 'rgba(255,255,255,0.9)', fontFamily: FONT.regular, fontSize: 12 },
  inputRow:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 8 },
  commentInput:     { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: RADIUS.pill, paddingHorizontal: 16, paddingVertical: 9, color: '#fff', fontFamily: FONT.regular, fontSize: FS.sm },
  sendBtn:          { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  // Product picker
  pickerModal:      { backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 20, justifyContent: 'flex-end' },
  pickerSheet:      { backgroundColor: BG, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%' },
  pickerHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  pickerTitle:      { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  pickerRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  pickerRowName:    { fontSize: FS.sm, fontFamily: FONT.semibold },
  pickerRowPrice:   { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  checkbox:         { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  emptyText:        { textAlign: 'center', padding: 24, fontFamily: FONT.regular, fontSize: FS.sm },
});
