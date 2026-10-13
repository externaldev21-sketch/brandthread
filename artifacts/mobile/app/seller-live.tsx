/**
 * Seller Live — active broadcast screen.
 * Uses react-native-agora in host mode. Gracefully degrades when native
 * Agora SDK is unavailable (Expo Go / web preview).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, Platform, ActivityIndicator, Dimensions } from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { haptics } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import { useUser } from '@clerk/expo';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import NativeOnlyFeature from '@/components/NativeOnlyFeature';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useLiveSocket, type LiveSocketEvent } from '@/lib/live/useLiveSocket';
import Composer from '@/components/ui/Composer';
import { LIVE_RED } from '@/components/live/LiveAvatarRing';
import { LiveCodesHostSheet } from '@/components/live/LiveCodesHostSheet';
import { useLiveModeration } from '@/lib/live/useLiveModeration';
import { PinnedCommentBar, CohostTiles } from '@/components/live/LiveModerationOverlays';
import { LiveCommentActionsSheet, type CommentAction, type CommentActionTarget } from '@/components/live/LiveCommentActionsSheet';
import { radius } from '@/constants/radii';
import { loadAgoraModule } from '@/lib/agoraAvailability';

const { width: W, height: H } = Dimensions.get('window');

// ─── Agora SDK (native-only, gracefully skipped on web/Expo Go) ───────────────
const AgoraModule = loadAgoraModule();

interface Comment { id: string; user_id?: string; display_name: string; message: string; created_at: string; }

export default function SellerLiveScreen() {
  if (Platform.OS === 'web') {
    return (
      <NativeOnlyFeature
        icon="video-off"
        title="Broadcasting is mobile-only"
        description="Start and manage a Brandthread live broadcast from the iOS or Android app, where camera, microphone, and live-stream controls are available."
      />
    );
  }
  return <SellerLiveNativeScreen />;
}

function SellerLiveNativeScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE } = theme;
  const BG = theme.background;
  const BORDER = theme.border;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SUBTLE = theme.subtle;
  const PURPLE_DIM = theme.accentDim;
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const params = useLocalSearchParams<{
    streamId: string; channelName: string; agoraUid: string;
    agoraAppId: string; token: string; title: string; facing?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const api = useApi();
  const { user } = useUser();

  const [viewerCount, setViewerCount]     = useState(0);
  const [comments, setComments]           = useState<Comment[]>([]);
  const [commentText, setCommentText]     = useState('');
  const [duration, setDuration]           = useState(0);
  const [productTags, setProductTags]     = useState<any[]>([]);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showLiveCodes, setShowLiveCodes]   = useState(false);
  const [allProducts, setAllProducts]     = useState<any[]>([]);
  const [ending, setEnding]               = useState(false);
  const [agoraReady, setAgoraReady]       = useState(false);
  // Host-only tips total; stays null (and renders nothing) while the
  // `live_tips` flag is OFF or the call fails.
  const liveTipsEnabled = useFeatureFlag('live_tips');
  const [tipsTotalCents, setTipsTotalCents] = useState<number | null>(null);
  useEffect(() => {
    if (!liveTipsEnabled || !params.streamId) return undefined;
    let cancelled = false;
    const load = () => {
      api.liveTips.total(params.streamId)
        .then(r => { if (!cancelled) setTipsTotalCents(r.enabled ? r.totalCents : null); })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, liveTipsEnabled, params.streamId]);

  // Moderation + co-host (pinned comment, co-host tiles, comment actions sheet).
  const mod = useLiveModeration(params.streamId);
  const [actionComment, setActionComment] = useState<CommentActionTarget | null>(null);

  const engineRef     = useRef<any>(null);
  const commentsRef   = useRef<ScrollView>(null);
  // Slow-polling fallback loop — only runs when the WebSocket genuinely
  // can't connect (see useLiveSocket's onFallback below).
  const fallbackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const generationRef = useRef(0);
  const requestGenerationRef = useRef<number | null>(null);
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
      // Agora's local preview starts on the rear camera; match whichever
      // camera the go-live setup screen was already previewing on.
      if (params.facing === 'front') {
        try { engine.switchCamera(); } catch {}
      }
      engine.startPreview();
      engine.registerEventHandler({
        onJoinChannelSuccess: () => setAgoraReady(true),
        // viewerCount is now a real presence count broadcast over the
        // live WebSocket (see the useLiveSocket call below /
        // jobs/liveViewersPresence.ts) — not derived from Agora's own
        // channel-membership events, which only ever went up.
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

  // ─── Duration timer + initial data ─────────────────────────────────────────
  useEffect(() => {
    generationRef.current += 1;
    consecutiveFailuresRef.current = 0;
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    loadProducts();
    return () => {
      clearInterval(timerRef.current!);
      if (fallbackPollRef.current) { clearInterval(fallbackPollRef.current); fallbackPollRef.current = null; }
    };
  }, []);

  // ─── Realtime: WebSocket room for this stream, replacing the old 3s poll ──────
  const handleLiveEvent = React.useCallback((event: LiveSocketEvent) => {
    if (event.type === 'comment') {
      lastCommentTs.current = event.comment.created_at;
      setComments(prev => [...prev, event.comment].slice(-80));
      setTimeout(() => commentsRef.current?.scrollToEnd({ animated: true }), 100);
    } else if (event.type === 'products') {
      setProductTags(event.productTags);
    } else if (event.type === 'viewerCount') {
      setViewerCount(event.count);
    } else if (event.type === 'comment_removed') {
      setComments(prev => prev.filter(c => c.id !== event.commentId));
      mod.handleEvent(event);
    } else {
      mod.handleEvent(event);
    }
  }, [mod.handleEvent]);

  const startFallbackPolling = React.useCallback((active: boolean) => {
    if (fallbackPollRef.current) { clearInterval(fallbackPollRef.current); fallbackPollRef.current = null; }
    if (!active) return;
    fallbackPollRef.current = setInterval(() => { void pollComments(generationRef.current); }, 15000);
  }, []);

  useLiveSocket({
    streamId: params.streamId,
    enabled: !!params.streamId,
    asHost: true,
    onEvent: handleLiveEvent,
    onConnected: () => { void pollComments(generationRef.current); mod.refresh(); },
    onFallback: startFallbackPolling,
  });

  /** One-shot HTTP backfill — used on WebSocket connect/reconnect, and as
   * the fallback loop's refresh when the socket can't connect at all. */
  async function pollComments(generation: number) {
    if (requestGenerationRef.current === generation) return;
    requestGenerationRef.current = generation;
    try {
      const data = await (api as any).live.comments(params.streamId, lastCommentTs.current) as any;
      if (generationRef.current !== generation) return;
      const newComments: Comment[] = (data.comments ?? []).reverse();
      if (newComments.length) {
        lastCommentTs.current = newComments[newComments.length - 1].created_at;
        setComments(prev => [...prev, ...newComments].slice(-80));
        setTimeout(() => commentsRef.current?.scrollToEnd({ animated: true }), 100);
      }
      consecutiveFailuresRef.current = 0;
    } catch {
      consecutiveFailuresRef.current += 1;
    } finally {
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current = null;
      }
    }
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
    haptics.selection();
    const exists = productTags.find(t => t.productId === product.id);
    const updated = exists
      ? productTags.filter(t => t.productId !== product.id)
      : [...productTags, {
          productId: product.id,
          productName: product.name,
          priceCents: product.priceCents ?? 0,
        }];
    setProductTags(updated);
    try {
      await (api as any).live.updateProducts(params.streamId, updated);
    } catch {}
  }

  async function highlightProduct(productId: string) {
    haptics.selection();
    // Tapping the featured product again unpins it. The pin is stored and
    // broadcast by the server (POST /api/live/:id/pin), which also keeps the
    // legacy `highlighted` flag in step.
    const alreadyPinned = productTags.find(tag => tag.productId === productId)?.highlighted === true;
    const updated = productTags.map(tag => ({
      ...tag,
      highlighted: !alreadyPinned && tag.productId === productId,
    }));
    setProductTags(updated);
    try {
      await (api as any).live.pin(params.streamId, alreadyPinned ? null : productId);
    } catch {
      Alert.alert('Could not feature product', 'The product highlight did not reach viewers. Please try again.');
    }
  }

  async function runCommentAction(action: CommentAction, c: CommentActionTarget) {
    const id = params.streamId;
    try {
      if (action === 'pin') await (api as any).liveMod.pin(id, c.id);
      else if (action === 'unpin') await (api as any).liveMod.pin(id, null);
      else if (action === 'remove') await (api as any).liveMod.removeComment(id, c.id);
      else if (action === 'mute' && c.user_id) await (api as any).liveMod.mute(id, c.user_id);
      else if (action === 'ban' && c.user_id) await (api as any).liveMod.ban(id, c.user_id);
      if (action === 'ban' && c.user_id) setComments(prev => prev.filter(x => x.user_id !== c.user_id));
      if (action === 'remove') setComments(prev => prev.filter(x => x.id !== c.id));
    } catch {
      Alert.alert('Couldn’t update', 'That action did not go through. Try again.');
    }
  }

  async function handleEnd() {
    Alert.alert('End stream?', "We'll try to save your stream as a replay in the Thread feed. This can take a few minutes, and isn't guaranteed.", [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'End & save', style: 'destructive',
        onPress: async () => {
          setEnding(true);
          try {
            await (api as any).live.end(params.streamId);
          } catch {}
          haptics.success();
          router.dismissTo('/(tabs)/' as any);
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
      <View style={[s.topBar, { paddingTop: headerTopInset + 8 }]}>
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
      <View style={[s.viewerRow, { paddingTop: headerTopInset + 48 }]}>
        <View style={[s.viewerBadge, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <Feather name="eye" size={13} color="#fff" />
          <Text style={s.viewerText}>{viewerCount.toLocaleString()}</Text>
        </View>
      </View>

      {/* Tips total (live_tips flag ON and at least one tip) */}
      {tipsTotalCents != null && tipsTotalCents > 0 && (
        <View style={[s.tipsRow, { paddingTop: headerTopInset + 78 }]} pointerEvents="none">
          <View style={[s.viewerBadge, { backgroundColor: 'rgba(0,0,0,0.5)' }]} testID="seller-live-tips-total">
            <Feather name="gift" size={13} color="#fff" />
            <Text style={s.viewerText}>{formatCents(tipsTotalCents)} in tips</Text>
          </View>
        </View>
      )}

      {/* Right action rail */}
      <View style={[s.rightRail, { paddingTop: headerTopInset + 80 }]}>
        {/* Products */}
        <TouchableOpacity onPress={() => setShowProductPicker(true)} style={s.railBtn} activeOpacity={0.7}>
          <Feather name="shopping-bag" size={22} color="#fff" />
          {productTags.length > 0 && (
            <View style={[s.railBadge, { backgroundColor: LIVE_RED }]}>
              <Text style={s.railBadgeText}>{productTags.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        {/* Live-only discount codes */}
        <TouchableOpacity onPress={() => setShowLiveCodes(true)} style={s.railBtn} activeOpacity={0.7} accessibilityLabel="Live codes">
          <Feather name="tag" size={21} color="#fff" />
        </TouchableOpacity>
        {/* Switch camera */}
        <TouchableOpacity
          style={s.railBtn}
          activeOpacity={0.7}
          onPress={() => engineRef.current?.switchCamera?.()}
        >
          <Feather name="refresh-cw" size={20} color="#fff" />
        </TouchableOpacity>
        {/* Moderation */}
        <TouchableOpacity
          style={s.railBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Moderation"
          onPress={() => router.push({ pathname: '/live-moderation', params: { streamId: params.streamId } } as any)}
        >
          <Feather name="shield" size={20} color="#fff" />
        </TouchableOpacity>
        {/* Co-host */}
        <TouchableOpacity
          style={s.railBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Invite a co-host"
          onPress={() => router.push({ pathname: '/live-cohost', params: { streamId: params.streamId } } as any)}
        >
          <Feather name="user-plus" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Co-host tiles */}
      <CohostTiles cohosts={mod.cohosts} RtcSurfaceView={AgoraModule?.RtcSurfaceView ?? null} top={headerTopInset + 86} />

      {/* Tagged products strip */}
      {productTags.length > 0 && (
        <View style={s.productStrip}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.productStripContent}>
            {productTags.map(tag => (
              <TouchableOpacity
                key={tag.productId}
                onPress={() => highlightProduct(tag.productId)}
                activeOpacity={0.8}
                style={[
                  s.productChip,
                  { backgroundColor: tag.highlighted ? LIVE_RED : 'rgba(0,0,0,0.65)' },
                ]}
              >
                <Feather name="shopping-bag" size={12} color={LIVE_RED} />
                <Text style={s.productChipText} numberOfLines={1}>{tag.productName}</Text>
                <Text style={s.productChipPrice}>{formatCents(tag.priceCents ?? 0)}</Text>
                {tag.highlighted && <Text style={s.featuredLabel}>FEATURED</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Comments + input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.bottomSection}
      >
        {/* Pinned comment */}
        <PinnedCommentBar comment={mod.pinned} />

        {/* Comments scroll — tap or long-press a viewer comment for Pin / Remove / Mute / Ban */}
        <ScrollView
          ref={commentsRef}
          style={s.commentScroll}
          contentContainerStyle={s.commentContent}
          showsVerticalScrollIndicator={false}
        >
          {comments.map(c => (
            <TouchableOpacity
              key={c.id}
              activeOpacity={0.8}
              disabled={!c.user_id || c.user_id === user?.id}
              onPress={() => setActionComment(c)}
              onLongPress={() => setActionComment(c)}
              accessibilityRole="button"
              accessibilityHint="Opens moderation actions"
              style={s.commentBubble}
            >
              <Text style={s.commentAuthor}>{c.display_name} </Text>
              <Text style={s.commentText}>{c.message}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Comment input */}
        <Composer
          overMedia
          value={commentText}
          onChangeText={setCommentText}
          onSend={sendComment}
          placeholder="Say something…"
          hideTabBar={false}
          testID="seller-live-composer"
        />
      </KeyboardAvoidingView>

      {showLiveCodes && <LiveCodesHostSheet streamId={params.streamId} onClose={() => setShowLiveCodes(false)} />}
      <LiveCommentActionsSheet
        comment={actionComment}
        pinned={!!actionComment && mod.pinned?.id === actionComment.id}
        onClose={() => setActionComment(null)}
        onAction={(action, c) => { void runCommentAction(action, c); }}
      />

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
                       <Text style={[s.pickerRowPrice, { color: MUTED }]}>{formatCents(p.priceCents ?? 0)}</Text>
                    </View>
                    <View style={[s.checkbox, tagged && { backgroundColor: PURPLE, borderColor: PURPLE }]}>
                      {tagged && <Feather name="check" size={13} color={theme.onAccent} />}
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

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const BG = theme.background;
  const BORDER = theme.border;
  const FG = theme.text;
  const MUTED = theme.muted;
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  const RED = LIVE_RED;
  return StyleSheet.create({
  root:             { flex: 1, backgroundColor: 'transparent' },
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
  tipsRow:          { position: 'absolute', top: 0, left: 16, zIndex: 9 },
  viewerBadge:      { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 5 },
  viewerText:       { color: '#fff', fontFamily: FONT.semibold, fontSize: 12 },
  rightRail:        { position: 'absolute', right: 12, top: 0, zIndex: 10, gap: 16 },
  railBtn:          { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  railBadge:        { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  railBadgeText:    { color: '#fff', fontFamily: FONT.bold, fontSize: FS.xs },
  productStrip:     { position: 'absolute', bottom: 160, left: 0, right: 0, zIndex: 8 },
  productStripContent: { paddingHorizontal: 12, gap: 8 },
  productChip:      { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 7 },
  productChipText:  { color: '#fff', fontFamily: FONT.semibold, fontSize: 12, maxWidth: 100 },
  productChipPrice: { color: 'rgba(255,255,255,0.7)', fontFamily: FONT.regular, fontSize: 11 },
  featuredLabel: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 0.8 },
  bottomSection:    { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 },
  commentScroll:    { maxHeight: 200, marginHorizontal: 12 },
  commentContent:   { gap: 4, paddingBottom: 8 },
  commentBubble:    { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingVertical: 4 },
  commentAuthor:    { color: '#fff', fontFamily: FONT.bold, fontSize: 12 },
  commentText:      { color: 'rgba(255,255,255,0.9)', fontFamily: FONT.regular, fontSize: 12 },
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
};
