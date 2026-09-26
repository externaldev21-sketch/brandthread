/**
 * Overlay pieces for a LIVE pager page — compact, monochrome, TikTok-LIVE
 * style. Red is used only for the LIVE marker itself.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Animated, Easing, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS, RADIUS } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { TABULAR_NUMS } from '@/constants/typography';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { LIVE_CHAT_VISIBLE, formatViewerCount } from '@/lib/live/liveOrdering';
import type { LiveChatMessage, LiveHost, LiveProduct, LiveViewerAvatar } from '@/lib/live/types';
import { LIVE_RED } from './LiveAvatarRing';

const ND = Platform.OS !== 'web';
const GLASS = 'rgba(0,0,0,0.38)';

// ─── Host pill (top-left) ─────────────────────────────────────────────────────

export function LiveHostAvatar({ host, size }: { host: LiveHost; size: number }) {
  return (
    <View style={[styles.hostAvatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: host.avatarColor }]}>
      {host.avatarUri ? (
        <CachedImage source={{ uri: host.avatarUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Text style={[styles.hostInitials, { fontSize: Math.round(size * 0.36) }]}>{host.initials}</Text>
      )}
    </View>
  );
}

export function LiveHostPill({
  host, viewerCount, following, onFollow, onOpenHost,
}: {
  host: LiveHost;
  viewerCount: number;
  following: boolean;
  onFollow: () => void;
  onOpenHost: () => void;
}) {
  return (
    <View style={styles.hostPill} testID="live-host-pill">
      <Pressable
        onPress={onOpenHost}
        style={styles.hostTap}
        accessibilityRole="button"
        accessibilityLabel={`${host.name}${host.verified ? ', verified' : ''}. ${formatViewerCount(viewerCount)} watching. Open profile`}
      >
        <LiveHostAvatar host={host} size={32} />
        <View style={styles.hostText}>
          <View style={styles.hostNameRow}>
            <Text style={styles.hostName} numberOfLines={1}>{host.name}</Text>
            {host.verified && <Ionicons name="checkmark-circle" size={12} color="#fff" style={{ marginLeft: 3 }} />}
          </View>
          <View style={styles.hostMetaRow}>
            <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE</Text></View>
            <Feather name="eye" size={10} color="rgba(255,255,255,0.8)" />
            <Text style={[styles.hostMeta, TABULAR_NUMS]} testID="live-viewer-count">{formatViewerCount(viewerCount)}</Text>
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={() => { hapticSelection(); onFollow(); }}
        style={[styles.followBtn, following && styles.followBtnOn]}
        accessibilityRole="button"
        accessibilityState={{ selected: following }}
        accessibilityLabel={following ? `Following ${host.name}` : `Follow ${host.name}`}
        hitSlop={6}
        testID="live-follow"
      >
        {following
          ? <Feather name="check" size={14} color="#fff" />
          : <Text style={styles.followText}>Follow</Text>}
      </Pressable>
    </View>
  );
}

// ─── Viewer avatar stack (top-right) ─────────────────────────────────────────

export function LiveViewerStack({ viewers }: { viewers: LiveViewerAvatar[] }) {
  if (viewers.length === 0) return null;
  return (
    <View style={styles.viewerStack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {viewers.slice(0, 3).map((v, i) => (
        <View key={v.id} style={[styles.viewerDot, { backgroundColor: v.color, marginLeft: i === 0 ? 0 : -8, zIndex: 3 - i }]}>
          {v.uri
            ? <CachedImage source={{ uri: v.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            : <Text style={styles.viewerInitials}>{v.initials}</Text>}
        </View>
      ))}
    </View>
  );
}

// ─── Chat (bottom-left) ──────────────────────────────────────────────────────

const FADE = [0.28, 0.5, 0.7, 0.88, 1];

function ChatRow({ msg, opacity }: { msg: LiveChatMessage; opacity: number }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
  }, [enter]);
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  if (msg.kind === 'join') {
    return (
      <Animated.View style={[styles.chatRow, { opacity: Animated.multiply(enter, opacity), transform: [{ translateY }] }]}>
        <Text style={styles.chatJoin} numberOfLines={1}><Text style={styles.chatUserMuted}>{msg.username}</Text> joined</Text>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={[styles.chatRow, { opacity: Animated.multiply(enter, opacity), transform: [{ translateY }] }]}>
      <View style={[styles.chatBubble, msg.kind === 'purchase' && styles.chatBubblePurchase]}>
        <Text style={styles.chatText} numberOfLines={3}>
          {msg.kind === 'purchase' && <Text>🛍️ </Text>}
          <Text style={styles.chatUser}>{msg.username}</Text>
          {msg.kind === 'host' && <Text style={styles.chatHostTag}>  HOST</Text>}
          {'  '}{msg.text}
        </Text>
      </View>
    </Animated.View>
  );
}

export function LiveChatList({ messages }: { messages: LiveChatMessage[] }) {
  const visible = messages.slice(-LIVE_CHAT_VISIBLE);
  const offset = FADE.length - visible.length;
  return (
    <View style={styles.chatList} pointerEvents="none" testID="live-chat" accessibilityLiveRegion="polite">
      {visible.map((m, i) => <ChatRow key={m.id} msg={m} opacity={FADE[offset + i]} />)}
    </View>
  );
}

// ─── Pinned product (bottom) ─────────────────────────────────────────────────

export function LivePinnedProductCard({
  product, onBuy, onOpenBag,
}: {
  product: LiveProduct;
  onBuy: () => void;
  onOpenBag: () => void;
}) {
  const swap = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    swap.setValue(0);
    Animated.spring(swap, { toValue: 1, speed: 16, bounciness: 6, useNativeDriver: ND }).start();
  }, [product.productId, swap]);
  const onSale = product.compareAtPriceCents != null && product.compareAtPriceCents > product.priceCents;
  return (
    <Animated.View
      style={[styles.pinned, { opacity: swap, transform: [{ translateY: swap.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}
      testID="live-pinned-product"
    >
      <Pressable onPress={onOpenBag} style={styles.pinnedTap} accessibilityRole="button" accessibilityLabel={`Now selling ${product.name}, ${formatCents(product.priceCents)}. See all products`}>
        <View style={styles.pinnedThumb}>
          {product.imageUri
            ? <CachedImage source={{ uri: product.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            : <Feather name="shopping-bag" size={18} color="#111" />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.pinnedEyebrow}>NOW SELLING{product.remainingUnits != null ? ` · ${product.remainingUnits} LEFT` : ''}</Text>
          <Text style={styles.pinnedName} numberOfLines={1}>{product.name}</Text>
          <View style={styles.pinnedPriceRow}>
            <Text style={[styles.pinnedPrice, TABULAR_NUMS]}>{formatCents(product.priceCents)}</Text>
            {onSale && <Text style={[styles.pinnedCompare, TABULAR_NUMS]}>{formatCents(product.compareAtPriceCents!)}</Text>}
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={() => { hapticLight(); onBuy(); }}
        style={styles.buyBtn}
        accessibilityRole="button"
        accessibilityLabel={`Buy ${product.name}`}
        testID="live-buy"
      >
        <Text style={styles.buyText}>Buy</Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Right rail ──────────────────────────────────────────────────────────────

function RailButton({
  icon, label, count, onPress, testID, badge,
}: {
  icon: React.ReactNode; label: string; count?: string; onPress: () => void; testID?: string; badge?: number;
}) {
  return (
    <Pressable onPress={onPress} style={styles.railBtn} accessibilityRole="button" accessibilityLabel={label} testID={testID} hitSlop={4}>
      <View style={styles.railIcon}>
        {icon}
        {badge != null && badge > 0 && (
          <View style={styles.railBadge}><Text style={styles.railBadgeText}>{badge}</Text></View>
        )}
      </View>
      {count != null && <Text style={[styles.railCount, TABULAR_NUMS]}>{count}</Text>}
    </Pressable>
  );
}

export function LiveRail({
  likeCount, liked, productCount, onLike, onShare, onOpenBag,
}: {
  likeCount: number; liked: boolean; productCount: number;
  onLike: (e: { x: number; y: number }) => void; onShare: () => void; onOpenBag: () => void;
}) {
  const likeRef = useRef<View>(null);
  const pop = useRef(new Animated.Value(1)).current;
  const handleLike = () => {
    hapticLight();
    pop.setValue(0.75);
    Animated.spring(pop, { toValue: 1, speed: 30, bounciness: 14, useNativeDriver: ND }).start();
    likeRef.current?.measureInWindow?.((x, y, w) => onLike({ x: x + w / 2, y }));
  };
  return (
    <View style={styles.rail} testID="live-rail">
      <View ref={likeRef} collapsable={false}>
        <RailButton
          testID="live-like"
          label={`Like, ${formatViewerCount(likeCount)} likes`}
          count={formatViewerCount(likeCount)}
          onPress={handleLike}
          icon={<Animated.View style={{ transform: [{ scale: pop }] }}><Ionicons name={liked ? 'heart' : 'heart-outline'} size={27} color="#fff" /></Animated.View>}
        />
      </View>
      <RailButton testID="live-bag" label={`Products in this live, ${productCount}`} onPress={onOpenBag} badge={productCount} icon={<Feather name="shopping-bag" size={23} color="#fff" />} />
      <RailButton testID="live-share" label="Share this live" onPress={onShare} icon={<Feather name="send" size={22} color="#fff" />} />
    </View>
  );
}

// ─── Heart burst layer ───────────────────────────────────────────────────────

export interface LiveHeartLayerHandle { burst: (x: number, y: number, count?: number) => void }

interface Heart { id: number; x: number; y: number; drift: number; size: number; anim: Animated.Value }

export const LiveHeartLayer = forwardRef<LiveHeartLayerHandle, { originOffset?: { x: number; y: number } }>(
  function LiveHeartLayer({ originOffset }, ref) {
    const [hearts, setHearts] = useState<Heart[]>([]);
    const seq = useRef(0);
    const burst = useCallback((x: number, y: number, count = 3) => {
      const ox = originOffset?.x ?? 0;
      const oy = originOffset?.y ?? 0;
      const made: Heart[] = Array.from({ length: count }, (_, i) => ({
        id: ++seq.current,
        x: x - ox,
        y: y - oy,
        drift: (Math.random() - 0.5) * 70,
        size: 22 + Math.random() * 14 + (i === 0 ? 6 : 0),
        anim: new Animated.Value(0),
      }));
      setHearts(prev => [...prev.slice(-24), ...made]);
      made.forEach((h, i) => {
        Animated.timing(h.anim, {
          toValue: 1, duration: 1150 + i * 120, delay: i * 70,
          easing: Easing.out(Easing.quad), useNativeDriver: ND,
        }).start(() => setHearts(prev => prev.filter(p => p.id !== h.id)));
      });
    }, [originOffset?.x, originOffset?.y]);
    useImperativeHandle(ref, () => ({ burst }), [burst]);
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="live-heart-layer">
        {hearts.map(h => (
          <Animated.View
            key={h.id}
            style={{
              position: 'absolute',
              left: h.x - h.size / 2,
              top: h.y - h.size / 2,
              opacity: h.anim.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 0.9, 0] }),
              transform: [
                { translateY: h.anim.interpolate({ inputRange: [0, 1], outputRange: [0, -190] }) },
                { translateX: h.anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, h.drift * 0.6, h.drift] }) },
                { scale: h.anim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.4, 1.15, 0.9] }) },
              ],
            }}
          >
            <Ionicons name="heart" size={h.size} color="#fff" />
          </Animated.View>
        ))}
      </View>
    );
  },
);

// ─── Comment bar (bottom) ────────────────────────────────────────────────────

export function LiveCommentBar({ onSend, disabled }: { onSend: (text: string) => Promise<void> | void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText('');
    try { await onSend(t); } catch { setText(t); } finally { setBusy(false); }
  };
  return (
    // Plain translucent fill, no BlurView: on web an absolutely-positioned
    // blur layer paints above the (unpositioned) <input> and its
    // backdrop-filter blurred the typed text and placeholder.
    <View style={styles.commentPill}>
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        editable={!disabled}
        placeholder="Add comment..."
        placeholderTextColor="rgba(255,255,255,0.62)"
        returnKeyType="send"
        maxLength={300}
        style={styles.commentInput}
        accessibilityLabel="Add a comment to the live chat"
        testID="live-comment-input"
      />
      {text.trim().length > 0 && (
        <Pressable onPress={submit} style={styles.sendBtn} accessibilityRole="button" accessibilityLabel="Send comment" hitSlop={6}>
          <Feather name="arrow-up" size={16} color="#000" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hostAvatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  hostInitials: { color: '#fff', fontFamily: FONT.bold },
  hostPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 3, paddingRight: 4, paddingVertical: 3,
    borderRadius: RADIUS.pill, overflow: 'hidden', backgroundColor: GLASS, maxWidth: 250,
  },
  hostTap: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  hostText: { flexShrink: 1, minWidth: 0 },
  hostNameRow: { flexDirection: 'row', alignItems: 'center' },
  hostName: { color: '#fff', fontFamily: FONT.bold, fontSize: 13, flexShrink: 1 },
  hostMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  hostMeta: { color: 'rgba(255,255,255,0.85)', fontFamily: FONT.semibold, fontSize: 11 },
  liveBadge: { backgroundColor: LIVE_RED, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 0.5 },
  liveBadgeText: { color: '#fff', fontFamily: FONT.bold, fontSize: 8.5, letterSpacing: 0.8 },
  followBtn: {
    minWidth: 58, height: 28, paddingHorizontal: 12, borderRadius: RADIUS.pill,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  followBtnOn: { backgroundColor: 'rgba(255,255,255,0.18)', minWidth: 34, paddingHorizontal: 0, width: 28 },
  followText: { color: '#000', fontFamily: FONT.bold, fontSize: 12 },

  viewerStack: { flexDirection: 'row', alignItems: 'center' },
  viewerDot: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.6)', overflow: 'hidden',
  },
  viewerInitials: { color: '#fff', fontFamily: FONT.bold, fontSize: 9 },

  chatList: { gap: 4, justifyContent: 'flex-end' },
  chatRow: { alignSelf: 'flex-start', maxWidth: '100%' },
  chatBubble: { backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 },
  chatBubblePurchase: { backgroundColor: 'rgba(255,255,255,0.16)' },
  chatText: { color: 'rgba(255,255,255,0.95)', fontFamily: FONT.regular, fontSize: 13, lineHeight: 17 },
  chatUser: { color: '#fff', fontFamily: FONT.bold },
  chatHostTag: { color: '#000', fontFamily: FONT.bold, fontSize: 9, letterSpacing: 0.6, backgroundColor: '#fff' },
  chatJoin: { color: 'rgba(255,255,255,0.72)', fontFamily: FONT.regular, fontSize: 12, paddingHorizontal: 9 },
  chatUserMuted: { fontFamily: FONT.semibold, color: 'rgba(255,255,255,0.86)' },

  pinned: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, paddingRight: 10,
    borderRadius: RADIUS.md, backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  pinnedTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  pinnedThumb: { width: 46, height: 46, borderRadius: RADIUS.xs, overflow: 'hidden', backgroundColor: '#E9E9EA', alignItems: 'center', justifyContent: 'center' },
  pinnedEyebrow: { color: '#6B6B70', fontFamily: FONT.bold, fontSize: 9, letterSpacing: 0.8 },
  pinnedName: { color: '#0A0A0B', fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: 1 },
  pinnedPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 1 },
  pinnedPrice: { color: '#0A0A0B', fontFamily: FONT.bold, fontSize: FS.sm },
  pinnedCompare: { color: '#8E8E93', fontFamily: FONT.regular, fontSize: 11, textDecorationLine: 'line-through' },
  buyBtn: { height: 34, paddingHorizontal: 18, borderRadius: RADIUS.pill, backgroundColor: '#0A0A0B', alignItems: 'center', justifyContent: 'center' },
  buyText: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.sm },

  rail: { alignItems: 'center', gap: 14 },
  railBtn: { alignItems: 'center', minWidth: 44 },
  railIcon: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.26)',
  },
  railCount: { color: '#fff', fontFamily: FONT.semibold, fontSize: 11, marginTop: 3, textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 3 },
  railBadge: {
    position: 'absolute', top: -2, right: -4, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  railBadgeText: { color: '#000', fontFamily: FONT.bold, fontSize: 10 },

  commentPill: {
    flex: 1, height: 40, borderRadius: RADIUS.pill, overflow: 'hidden', flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.24)',
  },
  commentInput: {
    flex: 1, height: 40, paddingHorizontal: 16, color: '#fff', fontFamily: FONT.regular, fontSize: FS.sm,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  sendBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 5 },
});
