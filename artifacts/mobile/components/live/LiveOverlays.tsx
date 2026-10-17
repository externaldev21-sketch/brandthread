/**
 * Overlay pieces for a live show page, laid out 1:1 with Whatnot's show
 * screen (https://mobbin.com/flows/ed55f754-472f-46f8-914b-ce7cb7345c7b,
 * "Watching a livestream" frame 3) and reskinned to black/white/silver:
 *
 *   top-left   host avatar · name, Follow pill under the name
 *   top-right  viewer-count pill · round chevron-down to leave
 *   right      More · Share · Shop (icon over a small label)
 *   bottom     chat rows (avatar, name, message) · "Say something..."
 *              · the item being sold · one full-width Buy now pill
 *
 * Whatnot's yellow becomes white with black text; red is used only for the
 * LIVE marker. Hearts are TikTok LIVE's tap-to-like burst
 * (https://mobbin.com/flows/7824af04-b028-4359-8f08-59ca894677ad).
 * Shared by the buyer viewer (app/live.tsx) and the host's own controls
 * (app/seller-live.tsx), so both sides look the same.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Animated, Easing, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS, MEDIA } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { TABULAR_NUMS } from '@/constants/typography';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { LIVE_CHAT_VISIBLE, formatViewerCount } from '@/lib/live/liveOrdering';
import type { LiveChatMessage, LiveHost, LiveProduct } from '@/lib/live/types';
import { LIVE_RED } from './LiveAvatarRing';

const ND = Platform.OS !== 'web';
const SHADOW = { textShadowColor: MEDIA.scrim, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;

// ─── Host (top-left) ─────────────────────────────────────────────────────────

export function LiveHostAvatar({ host, size }: { host: LiveHost; size: number }) {
  return (
    <View style={[styles.hostAvatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: host.avatarColor }]}>
      {host.avatarUri ? (
        <CachedImage source={{ uri: host.avatarUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Text style={[styles.hostInitials, { fontSize: Math.round(size * 0.38) }]}>{host.initials}</Text>
      )}
    </View>
  );
}

export function LiveHostRow({
  host, following, onFollow, onOpenHost,
}: {
  host: LiveHost;
  following: boolean;
  /** Omitted on the host's own screen — you don't follow yourself. */
  onFollow?: () => void;
  onOpenHost?: () => void;
}) {
  return (
    <View style={styles.hostRow} testID="live-host-row">
      <Pressable onPress={onOpenHost} disabled={!onOpenHost} accessibilityRole="button" accessibilityLabel={`${host.name}. Open profile`} hitSlop={4}>
        <LiveHostAvatar host={host} size={34} />
      </Pressable>
      <View style={styles.hostText}>
        <Pressable onPress={onOpenHost} disabled={!onOpenHost} hitSlop={4}>
          <View style={styles.hostNameRow}>
            <Text style={styles.hostName} numberOfLines={1}>{host.handle.replace(/^@/, '') || host.name}</Text>
            {host.verified && <Feather name="check-circle" size={12} color={MEDIA.fg} style={{ marginLeft: 4 }} />}
          </View>
        </Pressable>
        {onFollow ? (
          <Pressable
            onPress={() => { hapticSelection(); onFollow(); }}
            style={[styles.followBtn, following && styles.followBtnOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: following }}
            accessibilityLabel={following ? `Following ${host.name}` : `Follow ${host.name}`}
            hitSlop={6}
            testID="live-follow"
          >
            <Text style={[styles.followText, following && styles.followTextOn]}>{following ? 'Following' : 'Follow'}</Text>
          </Pressable>
        ) : (
          <View style={styles.liveTag}><Text style={styles.liveTagText}>LIVE</Text></View>
        )}
      </View>
    </View>
  );
}

// ─── Viewer count + leave (top-right) ────────────────────────────────────────

export function LiveTopRight({ viewerCount, onLeave, leaveLabel = 'Leave show', leaveIcon = 'chevron-down' }: {
  viewerCount: number;
  onLeave: () => void;
  leaveLabel?: string;
  leaveIcon?: 'chevron-down' | 'x';
}) {
  return (
    <View style={styles.topRight}>
      <View style={styles.viewerPill} accessibilityLabel={`${formatViewerCount(viewerCount)} watching`}>
        <View style={styles.liveDot} />
        <Feather name="eye" size={13} color={MEDIA.fg} />
        <Text style={[styles.viewerText, TABULAR_NUMS]} testID="live-viewer-count">{formatViewerCount(viewerCount)}</Text>
      </View>
      <Pressable onPress={onLeave} style={styles.leaveBtn} accessibilityRole="button" accessibilityLabel={leaveLabel} hitSlop={8} testID="live-close">
        <Feather name={leaveIcon} size={20} color={MEDIA.fg} />
      </Pressable>
    </View>
  );
}

// ─── Right rail ──────────────────────────────────────────────────────────────

function RailItem({ icon, label, onPress, testID, badge }: {
  icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; testID?: string; badge?: number;
}) {
  return (
    <Pressable onPress={() => { hapticLight(); onPress(); }} style={styles.railItem} accessibilityRole="button" accessibilityLabel={label} testID={testID} hitSlop={4}>
      <View>
        <Feather name={icon} size={23} color={MEDIA.fg} style={SHADOW as never} />
        {badge != null && badge > 0 && (
          <View style={styles.railBadge}><Text style={[styles.railBadgeText, TABULAR_NUMS]}>{badge}</Text></View>
        )}
      </View>
      <Text style={styles.railLabel}>{label.split(',')[0]}</Text>
    </Pressable>
  );
}

export function LiveRail({ productCount, onMore, onShare, onFlip, onOpenShop }: {
  productCount: number;
  onMore: () => void;
  onShare?: () => void;
  /** Host only: switch cameras. */
  onFlip?: () => void;
  onOpenShop: () => void;
}) {
  return (
    <View style={styles.rail} testID="live-rail">
      <RailItem icon="more-horizontal" label="More" onPress={onMore} testID="live-more" />
      {onShare && <RailItem icon="share" label="Share" onPress={onShare} testID="live-share" />}
      {onFlip && <RailItem icon="refresh-cw" label="Flip" onPress={onFlip} testID="live-flip" />}
      <RailItem icon="shopping-bag" label={`Shop, ${productCount} items`} onPress={onOpenShop} badge={productCount} testID="live-bag" />
    </View>
  );
}

// ─── Chat (bottom-left) ──────────────────────────────────────────────────────

function chatInitial(name: string) {
  return (name.trim()[0] ?? '•').toUpperCase();
}

function ChatRow({ msg, onLongPress }: { msg: LiveChatMessage; onLongPress?: (m: LiveChatMessage) => void }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
  }, [enter]);
  const style = [styles.chatRow, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }];
  if (msg.kind === 'join') {
    return (
      <Animated.View style={style}>
        <Text style={styles.chatEvent} numberOfLines={1}>{msg.username} joined</Text>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={style}>
      <Pressable
        onLongPress={onLongPress ? () => { hapticLight(); onLongPress(msg); } : undefined}
        disabled={!onLongPress}
        delayLongPress={350}
        style={styles.chatPress}
        accessibilityHint={onLongPress ? 'Long press to report or block' : undefined}
      >
      <View style={styles.chatAvatar}><Text style={styles.chatAvatarText}>{chatInitial(msg.username)}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.chatUser} numberOfLines={1}>
          {msg.username}{msg.kind === 'host' ? '  ' : ''}
          {msg.kind === 'host' && <Text style={styles.hostTag}> Host </Text>}
        </Text>
        <Text style={styles.chatText} numberOfLines={3}>
          {msg.kind === 'purchase' ? `bought ${msg.text}` : msg.text}
        </Text>
      </View>
      </Pressable>
    </Animated.View>
  );
}

export function LiveChatList({ messages, onLongPressMessage }: {
  messages: LiveChatMessage[];
  /** Report / block (viewer) or moderate (host) one message. */
  onLongPressMessage?: (m: LiveChatMessage) => void;
}) {
  const visible = messages.slice(-LIVE_CHAT_VISIBLE);
  return (
    <View style={styles.chatList} pointerEvents={onLongPressMessage ? 'box-none' : 'none'} testID="live-chat" accessibilityLiveRegion="polite">
      {visible.map(m => <ChatRow key={m.id} msg={m} onLongPress={onLongPressMessage} />)}
    </View>
  );
}

// ─── "Say something..." ─────────────────────────────────────────────────────

export function LiveChatInput({ onSend, disabled }: { onSend: (text: string) => Promise<void> | void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText('');
    try { await onSend(t); } catch { setText(t); } finally { setBusy(false); }
  };
  const canSend = text.trim().length > 0 && !busy;
  return (
    <View style={styles.inputPill} testID="live-comment">
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => { void submit(); }}
        placeholder="Say something..."
        placeholderTextColor={MEDIA.fgMuted}
        editable={!disabled}
        maxLength={300}
        returnKeyType="send"
        blurOnSubmit={false}
        style={styles.input}
        accessibilityLabel="Say something in the live chat"
        testID="live-comment-input"
      />
      {canSend && (
        <Pressable onPress={() => { void submit(); }} style={styles.sendBtn} accessibilityRole="button" accessibilityLabel="Send" hitSlop={6} testID="live-comment-send">
          <Feather name="arrow-up" size={16} color={MEDIA.onFg} />
        </Pressable>
      )}
    </View>
  );
}

// ─── The item being sold + Buy now (bottom) ──────────────────────────────────

export function LiveProductCard({
  product, onPress, action,
}: {
  product: LiveProduct;
  /** Opens the shop sheet. */
  onPress: () => void;
  /** The full-width pill under the item: Buy now (buyer) or Unpin (host). */
  action: { label: string; onPress: () => void; testID?: string; disabled?: boolean };
}) {
  const swap = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    swap.setValue(0);
    Animated.timing(swap, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
  }, [product.productId, swap]);
  const onSale = product.compareAtPriceCents != null && product.compareAtPriceCents > product.priceCents;
  return (
    <Animated.View
      style={{ opacity: swap, transform: [{ translateY: swap.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}
      testID="live-pinned-product"
    >
      <Pressable onPress={onPress} style={styles.productRow} accessibilityRole="button" accessibilityLabel={`${product.name}, ${formatCents(product.priceCents)}. See all items`}>
        <View style={styles.productThumb}>
          {product.imageUri
            ? <CachedImage source={{ uri: product.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            : <Feather name="shopping-bag" size={20} color={MEDIA.fg} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
          <Text style={styles.productMeta} numberOfLines={1}>
            {product.remainingUnits != null ? `${product.remainingUnits} left` : 'Buy now'}
            {product.sizes?.length ? ` · ${product.sizes.length} sizes` : ''}
          </Text>
        </View>
        <View style={styles.productPriceCol}>
          <Text style={[styles.productPrice, TABULAR_NUMS]}>{formatCents(product.priceCents)}</Text>
          {onSale && <Text style={[styles.productCompare, TABULAR_NUMS]}>{formatCents(product.compareAtPriceCents!)}</Text>}
        </View>
      </Pressable>
      <Pressable
        onPress={() => { hapticLight(); action.onPress(); }}
        disabled={action.disabled}
        style={[styles.buyBtn, action.disabled && { opacity: 0.5 }]}
        accessibilityRole="button"
        accessibilityLabel={`${action.label}: ${product.name}`}
        testID={action.testID ?? 'live-buy'}
      >
        <Text style={styles.buyText}>{action.label}</Text>
      </Pressable>
    </Animated.View>
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
            <FontAwesome name="heart" size={h.size} color={MEDIA.fg} />
          </Animated.View>
        ))}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  hostAvatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  hostInitials: { color: MEDIA.fg, fontFamily: FONT.bold },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  hostText: { flexShrink: 1, minWidth: 0, gap: 3, alignItems: 'flex-start' },
  hostNameRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  hostName: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: 15, lineHeight: 18, flexShrink: 1, ...SHADOW },
  followBtn: { height: 22, paddingHorizontal: 10, borderRadius: 11, backgroundColor: MEDIA.fg, alignItems: 'center', justifyContent: 'center' },
  followBtnOn: { backgroundColor: MEDIA.chip },
  followText: { color: MEDIA.onFg, fontFamily: FONT.bold, fontSize: FS.meta },
  followTextOn: { color: MEDIA.fg },
  liveTag: { backgroundColor: LIVE_RED, borderRadius: 4, paddingHorizontal: 6, height: 20, justifyContent: 'center' },
  liveTagText: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 0.6 },

  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewerPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 11, borderRadius: 16, backgroundColor: MEDIA.chip },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LIVE_RED },
  viewerText: { color: MEDIA.fg, fontFamily: FONT.semibold, fontSize: FS.sm },
  leaveBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: MEDIA.chip, alignItems: 'center', justifyContent: 'center' },

  rail: { alignItems: 'center', gap: 16 },
  railItem: { alignItems: 'center', minWidth: 44, gap: 3 },
  railLabel: { color: MEDIA.fg, fontFamily: FONT.semibold, fontSize: FS.xs, ...SHADOW },
  railBadge: {
    position: 'absolute', top: -6, right: -10, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: MEDIA.fg, alignItems: 'center', justifyContent: 'center',
  },
  railBadgeText: { color: MEDIA.onFg, fontFamily: FONT.bold, fontSize: 10 },

  chatList: { gap: 8, justifyContent: 'flex-end' },
  chatRow: { alignSelf: 'stretch' },
  chatPress: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  chatAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: MEDIA.chip, borderWidth: StyleSheet.hairlineWidth, borderColor: MEDIA.hairline, alignItems: 'center', justifyContent: 'center' },
  chatAvatarText: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: FS.xs },
  chatUser: { color: MEDIA.fgMuted, fontFamily: FONT.semibold, fontSize: FS.meta, lineHeight: 15, ...SHADOW },
  hostTag: { color: MEDIA.onFg, backgroundColor: MEDIA.fg, fontFamily: FONT.bold, fontSize: 10 },
  chatText: { color: MEDIA.fg, fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 18, ...SHADOW },
  chatEvent: { color: MEDIA.fgMuted, fontFamily: FONT.medium, fontSize: FS.meta, marginLeft: 34, ...SHADOW },

  inputPill: {
    flexDirection: 'row', alignItems: 'center', height: 40, borderRadius: 20, paddingLeft: 14, paddingRight: 5,
    backgroundColor: MEDIA.chip, borderWidth: 1, borderColor: MEDIA.hairline,
  },
  input: { flex: 1, color: MEDIA.fg, fontFamily: FONT.regular, fontSize: 14, height: 40, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : null) },
  sendBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: MEDIA.fg, alignItems: 'center', justifyContent: 'center' },

  productRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  productThumb: {
    width: 56, height: 56, borderRadius: 8, overflow: 'hidden', backgroundColor: MEDIA.chip,
    alignItems: 'center', justifyContent: 'center',
  },
  productName: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: 15, lineHeight: 19, ...SHADOW },
  productMeta: { color: MEDIA.fgMuted, fontFamily: FONT.medium, fontSize: FS.meta, marginTop: 2, ...SHADOW },
  productPriceCol: { alignItems: 'flex-end' },
  productPrice: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: 17, ...SHADOW },
  productCompare: { color: MEDIA.fgMuted, fontFamily: FONT.regular, fontSize: FS.meta, textDecorationLine: 'line-through' },
  buyBtn: { height: 48, borderRadius: 24, backgroundColor: MEDIA.fg, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  buyText: { color: MEDIA.onFg, fontFamily: FONT.bold, fontSize: 16 },
});
