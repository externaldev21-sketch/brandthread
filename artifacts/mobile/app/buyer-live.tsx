/**
 * Buyer Live — viewer screen for an active live stream.
 * Joins the Agora channel as audience. Falls back to a demo/placeholder
 * on Expo Go / web where the native SDK is unavailable.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import { useUser } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  BG, BORDER, FG, MUTED, SUBTLE, RED,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { formatCents } from '@/lib/money';
import * as WebBrowser from 'expo-web-browser';
import NativeOnlyFeature from '@/components/NativeOnlyFeature';
import { apiErrorMessage, confirmBlock, reportHref } from '@/lib/safety';
import { PressableScale } from '@/components/BrandthreadUI';
import { IconButton } from '@/components/ui/IconButton';
import { Snackbar } from '@/components/ui/Snackbar';
import { hapticLight, hapticPrimaryAction, hapticSuccessAction } from '@/lib/haptics';

const LIVE_RED = '#FF3B30';
const { width: W, height: H } = Dimensions.get('window');

// ─── Agora SDK (native-only) ──────────────────────────────────────────────────
let AgoraModule: any = null;
try { AgoraModule = require('react-native-agora'); } catch {}

interface Comment { id: string; user_id?: string; display_name: string; message: string; created_at: string; }
interface ProductTag { productId: string; productName: string; priceCents: number; highlighted?: boolean; }

export default function BuyerLiveScreen() {
  if (Platform.OS === 'web') {
    return (
      <NativeOnlyFeature
        icon="video-off"
        title="Live video is available in the mobile app"
        description="Live video works in the Brandthread app. Product pages and standard checkout remain available on web."
      />
    );
  }
  return <BuyerLiveNativeScreen />;
}

function BuyerLiveNativeScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary;
  const s = makeStyles(theme);
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
  const [purchaseTag, setPurchaseTag]     = useState<ProductTag | null>(null);
  const [purchaseProduct, setPurchaseProduct] = useState<any>(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [checkoutBusy, setCheckoutBusy]   = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [orderSnackbar, setOrderSnackbar] = useState('');
  const [buyerEmail, setBuyerEmail]       = useState(user?.primaryEmailAddress?.emailAddress ?? '');
  const [buyerName, setBuyerName]         = useState(user?.fullName ?? '');
  const [buyerPhone, setBuyerPhone]       = useState('');
  const [street, setStreet]               = useState('');
  const [city, setCity]                   = useState('');
  const [region, setRegion]               = useState('');
  const [postalCode, setPostalCode]       = useState('');
  const lastHighlightedRef = useRef<string | null>(null);

  const engineRef   = useRef<any>(null);
  const scrollRef   = useRef<ScrollView>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTs      = useRef<string>(new Date().toISOString());

  useEffect(() => {
    if (!orderSnackbar) return;
    const t = setTimeout(() => setOrderSnackbar(''), 2500);
    return () => clearTimeout(t);
  }, [orderSnackbar]);

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
            onUserOffline: () => { setEnded(true); },
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
      Alert.alert('Couldn’t join the live', 'Try again.');
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
      const nextTags: ProductTag[] = streamData.stream?.product_tags ?? [];
      setProductTags(nextTags);
      const highlighted = nextTags.find(tag => tag.highlighted);
      if (highlighted && highlighted.productId !== lastHighlightedRef.current) {
        lastHighlightedRef.current = highlighted.productId;
        void openPurchase(highlighted);
      }
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
    } catch (error) {
      // Live chat can't wait for review, so filtered messages are withdrawn
      // with the reason and the draft restored for editing.
      setComments(prev => prev.filter(c => c.id !== optimistic.id));
      setCommentText(msg);
      Alert.alert('Message not sent', apiErrorMessage(error, 'Check your connection and try again.'));
    }
  }

  function openStreamOptions() {
    const sellerId: string | undefined = stream?.seller_id;
    const sellerName: string = stream?.brand_name ?? stream?.seller_name ?? 'this seller';
    Alert.alert(sellerName, undefined, [
      {
        text: 'Report live stream',
        onPress: () => router.push(reportHref({
          targetType: 'live',
          targetId: params.streamId,
          label: stream?.title ?? `${sellerName} live`,
          ownerId: sellerId,
          ownerName: sellerName,
        }) as never),
      },
      ...(sellerId ? [{
        text: `Block ${sellerName}`,
        style: 'destructive' as const,
        onPress: async () => {
          if (await confirmBlock({ userId: sellerId, name: sellerName }, api.social.block)) handleLeave(true);
        },
      }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  function openChatMessageOptions(comment: Comment) {
    if (!comment.user_id || comment.user_id === user?.id) return;
    const authorId = comment.user_id;
    Alert.alert(comment.display_name, comment.message, [
      {
        text: 'Report message',
        onPress: () => router.push(reportHref({
          targetType: 'live_comment',
          targetId: comment.id,
          label: `${comment.display_name}: “${comment.message.slice(0, 80)}”`,
          ownerId: authorId,
          ownerName: comment.display_name,
        }) as never),
      },
      {
        text: `Block ${comment.display_name}`,
        style: 'destructive',
        onPress: async () => {
          if (await confirmBlock({ userId: authorId, name: comment.display_name }, api.social.block)) {
            setComments(prev => prev.filter(c => c.user_id !== authorId));
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function openPurchase(tag: ProductTag) {
    setPurchaseTag(tag);
    setPurchaseProduct(null);
    setSelectedVariantId('');
    setCheckoutError('');
    setPurchaseLoading(true);
    try {
      const product = await api.publicProducts.get(tag.productId);
      if (product?.sellerVacationMode) {
        setCheckoutError(product.sellerVacationMessage ?? 'This seller is currently away and is not accepting purchases.');
      }
      setPurchaseProduct(product);
      const firstAvailable = (product?.variants ?? []).find((variant: any) => (variant.stock ?? 0) > 0);
      setSelectedVariantId(firstAvailable?.id ?? '');
    } catch (error: any) {
      setCheckoutError('Couldn’t load this piece.');
    } finally {
      setPurchaseLoading(false);
    }
  }

  async function checkoutInStream() {
    if (!purchaseProduct || !selectedVariantId) {
      setCheckoutError('Choose an available option first.');
      return;
    }
    if (!buyerEmail.trim() || !buyerName.trim() || !/^[0-9+(). -]{7,32}$/.test(buyerPhone.trim()) || !street.trim() || !city.trim() || !region.trim() || !postalCode.trim()) {
      setCheckoutError('Add your name, email, phone number, and shipping address to continue.');
      return;
    }
    setCheckoutBusy(true);
    setCheckoutError('');
    try {
      const result = await api.buyer.checkout.createSession(
        [{ variantId: selectedVariantId, productId: purchaseProduct.id, quantity: 1 }],
        {
          contactEmail: buyerEmail.trim(),
          contactPhone: buyerPhone.trim(),
          shippingAddress: {
            recipientName: buyerName.trim(),
            street: street.trim(),
            city: city.trim(),
            state: region.trim(),
            postalCode: postalCode.trim(),
            country: 'US',
            phone: buyerPhone.trim(),
          },
          clientIdempotencyKey: `live_${params.streamId}_${purchaseProduct.id}_${Date.now()}`,
        },
      );
      const browser = await WebBrowser.openBrowserAsync(result.url);
      if (browser.type === 'cancel' || browser.type === 'dismiss') {
        setCheckoutError('Payment was cancelled. The live stream is still playing.');
        return;
      }
      let verification: any = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        verification = await api.buyer.checkout.verifySession(result.sessionId);
        if (verification?.paymentStatus === 'paid' || verification?.orderNumber) break;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (verification?.paymentStatus !== 'paid') {
        setCheckoutError(verification?.declineReason ?? 'Payment is still pending. Please check your orders shortly.');
        return;
      }
      hapticSuccessAction();
      setOrderSnackbar(verification.orderNumber
        ? `Order ${verification.orderNumber} confirmed`
        : 'Order confirmed');
      setPurchaseTag(null);
    } catch (error: any) {
      setCheckoutError('Couldn’t start checkout. Try again.');
    } finally {
      setCheckoutBusy(false);
    }
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
        <PressableScale onPress={() => router.back()} style={[s.backBtn, { backgroundColor: LIVE_RED }]}>
          <Text style={s.backBtnText}>Back to feed</Text>
        </PressableScale>
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
            {AgoraModule ? 'Connecting…' : 'Live video works in the Brandthread app.'}
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
          <IconButton
            name="more-horizontal"
            onPress={openStreamOptions}
            variant="plain"
            color="#fff"
            accessibilityLabel="Live stream options"
          />
          <IconButton
            name="x"
            onPress={() => handleLeave(true)}
            variant="plain"
            color="#fff"
            accessibilityLabel="Leave live stream"
          />
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
              <PressableScale
                key={tag.productId}
                onPress={() => { hapticLight(); openPurchase(tag); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Shop ${tag.productName}, ${formatCents(tag.priceCents)}`}
                style={[s.productChip, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
              >
                <Feather name="shopping-bag" size={12} color={LIVE_RED} />
                <Text style={s.productChipName} numberOfLines={1}>{tag.productName}</Text>
                <Text style={s.productChipPrice}>{formatCents(tag.priceCents)}</Text>
              </PressableScale>
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
          pointerEvents="box-none"
        >
          {comments.map(c => (
            <PressableScale
              key={c.id}
              style={s.commentRow}
              activeOpacity={0.85}
              onLongPress={() => openChatMessageOptions(c)}
              delayLongPress={350}
              accessibilityHint="Long press to report or block"
            >
              <Text style={s.commentName}>{c.display_name} </Text>
              <Text style={s.commentMsg}>{c.message}</Text>
            </PressableScale>
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
          <PressableScale
            onPress={() => { hapticLight(); sendComment(); }}
            activeOpacity={0.7}
            style={s.sendBtn}
            accessibilityRole="button"
            accessibilityLabel="Send comment"
          >
            <Feather name="send" size={18} color="#fff" />
          </PressableScale>
        </View>
      </KeyboardAvoidingView>

      {purchaseTag && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[s.purchaseSheet, { paddingBottom: insets.bottom + SP.sm }]}
        >
          <View style={s.purchaseHandle} />
          <View style={s.purchaseHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.purchaseEyebrow}>Buy without leaving</Text>
              <Text style={s.purchaseTitle} numberOfLines={1}>{purchaseTag.productName}</Text>
            </View>
            <PressableScale
              onPress={() => { hapticLight(); setPurchaseTag(null); }}
              style={s.purchaseClose}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Close purchase sheet"
            >
              <Feather name="x" size={20} color={FG} />
            </PressableScale>
          </View>
          {purchaseLoading ? (
            <ActivityIndicator color={PURPLE} style={{ marginVertical: SP.lg }} />
          ) : (
            <ScrollView
              style={s.purchaseScroll}
              contentContainerStyle={s.purchaseContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.purchasePrice}>
                {formatCents(
                  (purchaseProduct?.variants ?? []).find((variant: any) => variant.id === selectedVariantId)?.priceCents
                    ?? purchaseTag.priceCents,
                )}
              </Text>
              <Text style={s.fieldLabel}>Option</Text>
              <View style={s.variantRow}>
                {(purchaseProduct?.variants ?? []).map((variant: any) => {
                  const available = (variant.stock ?? 0) > 0;
                  const label = [variant.size, variant.color].filter(Boolean).join(' / ') || 'Default';
                  return (
                    <PressableScale
                      key={variant.id}
                      disabled={!available}
                      onPress={() => { hapticLight(); setSelectedVariantId(variant.id); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedVariantId === variant.id, disabled: !available }}
                      style={[
                        s.variantChip,
                        selectedVariantId === variant.id && { borderColor: PURPLE },
                        !available && s.variantDisabled,
                      ]}
                    >
                      <Text style={s.variantText}>{label}</Text>
                    </PressableScale>
                  );
                })}
              </View>
              <Text style={s.fieldLabel}>Delivery</Text>
              <TextInput value={buyerEmail} onChangeText={setBuyerEmail} placeholder="Email" placeholderTextColor={SUBTLE} keyboardType="email-address" autoCapitalize="none" style={s.purchaseInput} />
              <TextInput value={buyerName} onChangeText={setBuyerName} placeholder="Full name" placeholderTextColor={SUBTLE} style={s.purchaseInput} />
              <TextInput value={buyerPhone} onChangeText={setBuyerPhone} placeholder="Phone number" placeholderTextColor={SUBTLE} keyboardType="phone-pad" style={s.purchaseInput} />
              <TextInput value={street} onChangeText={setStreet} placeholder="Street address" placeholderTextColor={SUBTLE} style={s.purchaseInput} />
              <View style={s.addressRow}>
                <TextInput value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={SUBTLE} style={[s.purchaseInput, { flex: 1 }]} />
                <TextInput value={region} onChangeText={setRegion} placeholder="State" placeholderTextColor={SUBTLE} autoCapitalize="characters" style={[s.purchaseInput, s.regionInput]} />
                <TextInput value={postalCode} onChangeText={setPostalCode} placeholder="ZIP" placeholderTextColor={SUBTLE} keyboardType="numbers-and-punctuation" style={[s.purchaseInput, s.postalInput]} />
              </View>
              {checkoutError ? <Text style={s.checkoutError}>{checkoutError}</Text> : null}
              <PressableScale
                onPress={() => { hapticPrimaryAction(); checkoutInStream(); }}
                disabled={checkoutBusy || !!purchaseProduct?.sellerVacationMode}
                accessibilityRole="button"
                style={[s.buyNowButton, { backgroundColor: PURPLE }, (checkoutBusy || purchaseProduct?.sellerVacationMode) && s.buyNowDisabled]}
              >
                {checkoutBusy ? <ActivityIndicator color={BG} /> : (
                  <Text style={s.buyNowText}>
                    {purchaseProduct?.sellerVacationMode ? 'Seller is away' : 'Buy now'}
                  </Text>
                )}
              </PressableScale>
              <Text style={s.purchaseFootnote}>Secure payment opens over the live stream. Return here when finished.</Text>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      )}

      <Snackbar
        visible={!!orderSnackbar}
        message={orderSnackbar}
        onDismiss={() => setOrderSnackbar('')}
      />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  return StyleSheet.create({
  root:             { flex: 1, backgroundColor: 'transparent' },
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
  purchaseSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30,
    maxHeight: H * 0.78, backgroundColor: BG, borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingTop: SP.xs,
  },
  purchaseHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.md },
  purchaseHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  purchaseEyebrow: { color: LIVE_RED, fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1.1, marginBottom: 4 },
  purchaseTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg },
  purchaseClose: { width: 38, height: 38, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: BORDER },
  purchaseScroll: { marginTop: SP.sm },
  purchaseContent: { paddingBottom: SP.md, gap: SP.sm },
  purchasePrice: { color: FG, fontFamily: FONT.bold, fontSize: FS.xl },
  fieldLabel: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: SP.xs },
  variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs },
  variantChip: { borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: SP.xs },
  variantDisabled: { opacity: 0.35 },
  variantText: { color: FG, fontFamily: FONT.medium, fontSize: FS.xs },
  purchaseInput: { minHeight: 44, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, paddingHorizontal: SP.sm, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },
  addressRow: { flexDirection: 'row', gap: SP.xs },
  regionInput: { width: 72 },
  postalInput: { width: 88 },
  checkoutError: { color: RED, fontFamily: FONT.medium, fontSize: FS.xs, lineHeight: 17 },
  buyNowButton: { minHeight: 48, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SP.xs },
  buyNowDisabled: { opacity: 0.45 },
  buyNowText: { color: BG, fontFamily: FONT.bold, fontSize: FS.sm },
  purchaseFootnote: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, textAlign: 'center', lineHeight: 15 },
  // Ended
  endedIcon:        { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  endedTitle:       { fontSize: FS.lg, fontFamily: FONT.bold },
  endedSub:         { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },
  backBtn:          { marginTop: 24, borderRadius: RADIUS.pill, paddingHorizontal: 28, paddingVertical: 12 },
  backBtnText:      { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.sm },
  });
};
