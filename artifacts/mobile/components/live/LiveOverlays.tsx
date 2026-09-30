/**
 * Overlay pieces for a LIVE pager page — compact, monochrome, TikTok-LIVE
 * style. Red is used only for the LIVE marker itself.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Animated, Easing, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS, RADIUS, ON_DARK_MUTED } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { TABULAR_NUMS } from '@/constants/typography';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { LIVE_CHAT_VISIBLE, formatViewerCount } from '@/lib/live/liveOrdering';
import type { LiveChatMessage, LiveHost, LiveProduct, LiveViewerAvatar } from '@/lib/live/types';
import { ThreadCashBill } from '@/components/thread-cash/ThreadCashBill';
import { a11yHidden } from '@/lib/a11yHidden';
import { Glass } from '@/components/ui/Glass';
import { LIVE_RED } from './LiveAvatarRing';

const ND = Platform.OS !== 'web';
/** One consistent rail-icon treatment (point 4): every icon the same size on
 *  the same translucent circle — no bare icons mixed with disc'd ones. */
const RAIL_ICON_SIZE = 28;
const RAIL_ICON_CIRCLE = 44;

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
      <Glass variant="regular" tint="dark" radius={RADIUS.pill} style={StyleSheet.absoluteFill} />
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
            {host.verified && <Feather name="check-circle" size={12} color="#fff" style={{ marginLeft: 3 }} />}
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
        {following && <Glass variant="regular" tint="dark" radius={RADIUS.pill} style={StyleSheet.absoluteFill} />}
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
    <View style={styles.viewerStack} {...a11yHidden(true)}>
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

/** The numeric count next to the top-right viewer-avatar stack — distinct
 *  from the host pill's own LIVE-row count, matching TikTok's top-right
 *  cluster (avatars, then a count, then close). */
export function LiveViewerCount({ count }: { count: number }) {
  return (
    <View style={styles.viewerCountPill} testID="live-top-viewer-count">
      <Text style={[styles.viewerCountText, TABULAR_NUMS]}>{formatViewerCount(count)}</Text>
    </View>
  );
}

// ─── Chat (bottom-left) ──────────────────────────────────────────────────────

const FADE = [0.28, 0.5, 0.7, 0.88, 1];

/** System-ish events (someone joined, someone bought) get one consistent
 *  subtle pill; ordinary chat/host messages get no bubble at all — plain
 *  white text with a soft shadow directly over the video, TikTok-style. */
function ChatRow({ msg, opacity }: { msg: LiveChatMessage; opacity: number }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
  }, [enter]);
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const animatedStyle = [styles.chatRow, { opacity: Animated.multiply(enter, opacity), transform: [{ translateY }] }];

  if (msg.kind === 'join' || msg.kind === 'purchase') {
    return (
      <Animated.View style={animatedStyle}>
        <View style={styles.eventPill}>
          {/* Chat rows accumulate/scroll during a live stream — a real blur
              per row would be a live BlurView per message, exactly what this
              sweep's own performance guidance rules out. `noBlur` keeps the
              specular edge + translucent fill (still reads as glass) without
              the per-row blur cost. */}
          <Glass variant="regular" tint="dark" radius={RADIUS.pill} noBlur style={StyleSheet.absoluteFill} />
          <Text style={styles.eventPillText} numberOfLines={1}>
            {msg.kind === 'purchase' ? '🛍️ ' : ''}
            <Text style={styles.chatUserMuted}>{msg.username}</Text>
            {msg.kind === 'purchase' ? ` ${msg.text}` : ' joined'}
          </Text>
        </View>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={animatedStyle}>
      {/* One nested-Text tree, not a row View splitting username/tag/message
          into separate flex items — a row wraps each item as a whole to the
          next line (the username+tag stranded on their own line, the message
          starting a new line with the row's gap read as leading spaces).
          Nested Text reflows word by word like any other inline text. */}
      <Text style={styles.chatText} numberOfLines={3}>
        <Text style={styles.chatUser}>{msg.username}</Text>
        {msg.kind === 'host' && <Text style={styles.hostTagText}> HOST </Text>}
        {' '}{msg.text}
      </Text>
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
    // withTiming/ease-out, not a spring — a bouncy overshoot here read as
    // exactly the kind of "bounce" polish is meant to remove.
    Animated.timing(swap, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
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

// forwardRef so the like button can be measured for the heart-burst origin
// without wrapping it in an extra plain View — every rail item (mute, heart,
// cart, share) is now built through this exact same call, with no
// per-item structural difference that could make one look inconsistent.
const RailButton = forwardRef<View, {
  icon: React.ReactNode; label: string; count?: string; onPress: () => void; testID?: string; badge?: number;
}>(function RailButton({ icon, label, count, onPress, testID, badge }, ref) {
  return (
    <Pressable ref={ref} onPress={onPress} style={styles.railBtn} accessibilityRole="button" accessibilityLabel={label} testID={testID} hitSlop={4}>
      <View style={styles.railIcon}>
        <Glass variant="regular" tint="dark" radius={RAIL_ICON_CIRCLE / 2} style={StyleSheet.absoluteFill} />
        {icon}
        {badge != null && badge > 0 && (
          <View style={styles.railBadge}><Text style={styles.railBadgeText}>{badge}</Text></View>
        )}
      </View>
      {count != null && <Text style={[styles.railCount, TABULAR_NUMS]}>{count}</Text>}
    </Pressable>
  );
});

export function LiveRail({
  likeCount, liked, productCount, muted, onLike, onShare, onOpenBag, onToggleSound,
}: {
  likeCount: number; liked: boolean; productCount: number; muted: boolean;
  onLike: (e: { x: number; y: number }) => void; onShare: () => void; onOpenBag: () => void; onToggleSound: () => void;
}) {
  const likeRef = useRef<View>(null);
  const pop = useRef(new Animated.Value(1)).current;
  const handleLike = () => {
    hapticLight();
    pop.setValue(0.75);
    Animated.timing(pop, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
    likeRef.current?.measureInWindow?.((x, y, w) => onLike({ x: x + w / 2, y }));
  };
  return (
    <View style={styles.rail} testID="live-rail">
      <RailButton
        testID="live-sound"
        label={muted ? 'Turn sound on' : 'Mute'}
        onPress={onToggleSound}
        icon={<Feather name={muted ? 'volume-x' : 'volume-2'} size={RAIL_ICON_SIZE} color="#fff" />}
      />
      <RailButton
        ref={likeRef}
        testID="live-like"
        label={`Like, ${formatViewerCount(likeCount)} likes`}
        count={formatViewerCount(likeCount)}
        onPress={handleLike}
        icon={<Animated.View style={{ transform: [{ scale: pop }] }}>{liked ? <FontAwesome name="heart" size={RAIL_ICON_SIZE} color="#fff" /> : <Feather name="heart" size={RAIL_ICON_SIZE} color="#fff" />}</Animated.View>}
      />
      <RailButton testID="live-bag" label={`Products in this live, ${productCount}`} onPress={onOpenBag} badge={productCount} icon={<Feather name="shopping-bag" size={RAIL_ICON_SIZE} color="#fff" />} />
      <RailButton testID="live-share" label="Share this live" onPress={onShare} icon={<Feather name="send" size={RAIL_ICON_SIZE} color="#fff" />} />
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
            <FontAwesome name="heart" size={h.size} color="#fff" />
          </Animated.View>
        ))}
      </View>
    );
  },
);

// ─── Comment bar (bottom) ────────────────────────────────────────────────────

export function LiveCommentBar({
  onSend, disabled, onGift, onShare, onMore,
}: {
  onSend: (text: string) => Promise<void> | void;
  disabled?: boolean;
  /** Quick icons to the right of the pill, TikTok-style (gift/Thread Cash,
   *  share, report/block overflow) — each omitted has no effect on the pill itself. */
  onGift?: () => void;
  onShare?: () => void;
  onMore?: () => void;
}) {
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
    <View style={styles.commentRow}>
      {/* Plain translucent fill, no BlurView: on web an absolutely-positioned
          blur layer paints above the (unpositioned) <input> and its
          backdrop-filter blurred the typed text and placeholder. */}
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
      {onGift && (
        <Pressable onPress={onGift} style={styles.quickIconBtn} accessibilityRole="button" accessibilityLabel="Send Thread Cash" hitSlop={4} testID="live-gift">
          <ThreadCashBill width={26} />
        </Pressable>
      )}
      {onShare && (
        <Pressable onPress={onShare} style={styles.quickIconBtn} accessibilityRole="button" accessibilityLabel="Share this live" hitSlop={4} testID="live-comment-share">
          <Feather name="share" size={22} color="#fff" />
        </Pressable>
      )}
      {onMore && (
        <Pressable onPress={onMore} style={styles.quickIconBtn} accessibilityRole="button" accessibilityLabel="Live stream options" hitSlop={4} testID="live-comment-more">
          <Feather name="more-horizontal" size={22} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hostAvatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#999999' },
  hostInitials: { color: '#fff', fontFamily: FONT.bold },
  // flexShrink so this compresses (its own text truncates via numberOfLines)
  // before the viewer stack/count/close button on the other side of the row
  // ever overlap it — neither side shrinks by default in RN's flexbox, so
  // without this the two sides overflowed into each other on narrower
  // screens once the viewer stack + count + close button reached their
  // combined natural width.
  hostPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 3, paddingRight: 4, paddingVertical: 3,
    borderRadius: RADIUS.pill, overflow: 'hidden', maxWidth: 250, flexShrink: 1, minWidth: 0,
  },
  hostTap: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  hostText: { flexShrink: 1, minWidth: 0 },
  hostNameRow: { flexDirection: 'row', alignItems: 'center' },
  hostName: { color: '#fff', fontFamily: FONT.bold, fontSize: 13, flexShrink: 1 },
  hostMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  hostMeta: { color: 'rgba(255,255,255,0.85)', fontFamily: FONT.semibold, fontSize: 11 },
  liveBadge: { backgroundColor: LIVE_RED, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2 },
  liveBadgeText: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 0.8 },
  followBtn: {
    minWidth: 58, height: 32, paddingHorizontal: 12, borderRadius: RADIUS.pill,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  followBtnOn: { backgroundColor: 'transparent', overflow: 'hidden', minWidth: 34, paddingHorizontal: 0, width: 32 },
  followText: { color: '#000', fontFamily: FONT.bold, fontSize: 12 },

  // Fixed width (24 + 2×16 = 56 for up to 3 overlapping 24pt avatars, each
  // overlapping the last by 8) and flexShrink: 0 so the flex row never
  // compresses it — without an explicit width the row shrank to fit
  // whatever space the host pill left, clipping/squishing the last avatar
  // against the viewer count next to it.
  viewerStack: { flexDirection: 'row', alignItems: 'center', width: 56, flexShrink: 0 },
  viewerDot: {
    width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#000000', overflow: 'hidden', flexShrink: 0,
  },
  viewerInitials: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.xs },
  viewerCountPill: { marginLeft: 6 },
  viewerCountText: { color: '#fff', fontFamily: FONT.semibold, fontSize: 12, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3 },

  // Chat: capped at ~70% width so a long line never runs under the right
  // rail, no bubble on ordinary messages (plain text over video, TikTok
  // style), and one consistent subtle pill for system/purchase events only.
  chatList: { gap: 5, justifyContent: 'flex-end', maxWidth: '70%', alignSelf: 'flex-start' },
  chatRow: { alignSelf: 'flex-start', maxWidth: '100%' },
  chatText: {
    color: '#fff', fontFamily: FONT.regular, fontSize: 13, lineHeight: 17,
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  chatUser: {
    color: '#fff', fontFamily: FONT.semibold, fontSize: 13,
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  // Nested inside the chat Text (not a row View) so "username HOST message"
  // flows and wraps as one line of text instead of the tag forcing a break.
  hostTagText: {
    color: '#000', backgroundColor: '#fff', fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 0.6,
    borderRadius: 3,
  },
  eventPill: {
    borderRadius: RADIUS.pill, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5,
  },
  eventPillText: { color: 'rgba(255,255,255,0.9)', fontFamily: FONT.regular, fontSize: 12 },
  chatUserMuted: { fontFamily: FONT.semibold, color: '#fff' },

  pinned: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 64, paddingHorizontal: 8, paddingRight: 10,
    borderRadius: 12, backgroundColor: 'rgba(20,20,20,0.72)',
  },
  pinnedTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  pinnedThumb: { width: 48, height: 48, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  // Solid opaque greys (ON_DARK_MUTED), not translucent white — a sub-1-alpha
  // text color subpixel-antialiases against the live video underneath, which
  // reads as a soft/smudgy mid-grey rather than a crisp silver (see
  // lib/theme.ts's ON_DARK_MUTED doc comment).
  pinnedEyebrow: { color: ON_DARK_MUTED, fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 0.6 },
  pinnedName: { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: 1 },
  pinnedPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 1 },
  pinnedPrice: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.sm },
  pinnedCompare: { color: ON_DARK_MUTED, fontFamily: FONT.regular, fontSize: 11, textDecorationLine: 'line-through' },
  buyBtn: { height: 32, paddingHorizontal: 16, borderRadius: RADIUS.pill, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  buyText: { color: '#000', fontFamily: FONT.bold, fontSize: FS.sm },

  rail: { alignItems: 'center', gap: 14 },
  railBtn: { alignItems: 'center', minWidth: 44 },
  railIcon: {
    width: RAIL_ICON_CIRCLE, height: RAIL_ICON_CIRCLE, borderRadius: RAIL_ICON_CIRCLE / 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  railCount: { color: '#fff', fontFamily: FONT.semibold, fontSize: 11, marginTop: 3, textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 3 },
  railBadge: {
    position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 3,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  railBadgeText: { color: '#000', fontFamily: FONT.bold, fontSize: FS.xs },

  commentRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentPill: {
    flex: 1, height: 44, borderRadius: RADIUS.pill, overflow: 'hidden', flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  commentInput: {
    flex: 1, height: 44, paddingHorizontal: 16, color: '#fff', fontFamily: FONT.regular, fontSize: FS.sm,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  sendBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  quickIconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
