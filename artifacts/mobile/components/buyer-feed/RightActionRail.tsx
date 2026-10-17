/**
 * Buyer Threads Home feed — right action rail (TikTok/Reels-quality pass).
 *
 * Avatar (48pt, thin white ring, live ring integration) + follow badge,
 * like, comment, repost, save, share. Custom filled SVG glyphs (RailGlyph),
 * counts below (formatRailCount: exact 0-999, compact K/M, always shows 0). All motion runs on the
 * UI thread via Reanimated shared values and respects `reduceMotion`.
 *
 * Purely visual: the parent owns persistence, rollback, toasts and haptic
 * invocation. Active states always reflect the `engagement` prop — nothing
 * is optimistically faked here, so a parent rollback simply re-renders.
 */
import React from 'react';
import { Pressable, Text, View, StyleSheet, Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, withSequence, withDelay, runOnJS, Easing,
} from 'react-native-reanimated';

import { CachedImage as Image } from '@/components/CachedImage';
import { ON_DARK, ON_DARK_MUTED } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { LiveHostRing } from '@/components/live/LiveAvatarRing';
import { useLiveStreamForHost } from '@/lib/live/useLiveDirectory';
import { RailGlyph, type RailGlyphName } from './RailGlyph';

export const RAIL_ICON_SIZE = 32;
/** Visual gap between complete icon+count groups. */
export const RAIL_ITEM_GAP = 12;
/** Glyph box bottom -> count text top. */
export const RAIL_COUNT_GAP = 1;
/** Avatar circle bottom -> Like glyph box top. */
export const RAIL_AVATAR_TO_LIKE = 16;
export const RAIL_WIDTH = 48;
const AVATAR = 48;
// Brandthread Woven `color.dark.destructive` (#E5484D). The mobile artifact
// doesn't depend on @workspace/brandthread-woven yet, so it's mirrored here.
const HEART_RED = '#E5484D';
const SILVER = ON_DARK_MUTED;
const BADGE = 20;

export interface RailEngagement {
  liked?: boolean;
  likes?: number;
  saved?: boolean;
  saves?: number;
  reposted?: boolean;
  reposts?: number;
  following?: boolean;
}

/** Always visible: zero/non-finite/invalid/negative -> '0'; exact 1-999, then 1.2K / 3.4M. Never a blank spacer. */
export function formatRailCount(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return '0';
  if (n < 1_000) return String(Math.trunc(n));
  const [unit, suffix] = n < 1_000_000 ? [1_000, 'K'] : [1_000_000, 'M'];
  const v = n / unit;
  // One truncated decimal at every magnitude: 1.2K, 123.1K, 3.4M (never rounds up).
  const t = Math.floor(v * 10) / 10;
  if (unit === 1_000 && t >= 1_000) return '1M';
  return `${Number.isInteger(t) ? t : t.toFixed(1)}${suffix}`;
}

type Kind = 'pop' | 'bounce' | 'rotate' | 'none';

function RailAction({
  glyph, activeGlyph, count, active, activeColor, kind, reduceMotion, onPress, onLongPress, label, checked, testID, disabled,
}: {
  glyph: RailGlyphName; activeGlyph?: RailGlyphName; count: number; active: boolean; activeColor: string;
  kind: Kind; reduceMotion?: boolean; onPress: () => unknown; label: string; checked?: boolean;
  testID?: string; disabled?: boolean;
  onLongPress?: () => void;
}) {
  const scale = useSharedValue(1);
  const rot = useSharedValue(0);
  const prev = React.useRef(active);

  React.useEffect(() => {
    if (prev.current === active) return;
    prev.current = active;
    if (reduceMotion || kind === 'none') return;
    if (kind === 'pop') {
      scale.value = active
        ? withSequence(withTiming(0.8, { duration: 70 }), withSpring(1.25, { damping: 6, stiffness: 400 }), withSpring(1, { damping: 12, stiffness: 300 }))
        : withSequence(withTiming(0.82, { duration: 110 }), withSpring(1, { damping: 14, stiffness: 320 }));
    } else if (kind === 'bounce') {
      scale.value = active
        ? withSequence(withTiming(0.85, { duration: 80 }), withSpring(1.15, { damping: 5, stiffness: 380 }), withSpring(1))
        : withSequence(withTiming(0.9, { duration: 90 }), withSpring(1));
    } else if (kind === 'rotate') {
      rot.value = 0;
      if (active) rot.value = withTiming(180, { duration: 380, easing: Easing.out(Easing.cubic) });
      scale.value = withSequence(withTiming(0.9, { duration: 90 }), withSpring(1));
    }
  }, [active, kind, reduceMotion, scale, rot]);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${rot.value}deg` }],
  }));
  const text = formatRailCount(count);

  return (
    <Pressable
      onPress={() => { void onPress(); }}
      onLongPress={onLongPress}
      delayLongPress={350}
      disabled={disabled}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={checked === undefined ? { disabled } : { checked, disabled }}
      testID={testID}
    >
      <Animated.View style={aStyle}>
        <RailGlyph name={active && activeGlyph ? activeGlyph : glyph} size={RAIL_ICON_SIZE} color={active ? activeColor : ON_DARK} />
      </Animated.View>
      <Text style={styles.count} numberOfLines={1}>{text}</Text>
    </Pressable>
  );
}

export function RightActionRail({
  creator, hostId, avatarColor, avatarUri, avatarSource, initials,
  engagement, commentsCount, shares, saves,
  onOpenCreator, onPressInCreator, onFollow, onLike, onOpenComments, onRepost, onSave, onSaveLongPress, onShare,
  style, testIdBase, reduceMotion, isOfficial, isSelf, followPending, showFollow = true, footerSlot, shareBottom,
}: {
  creator: string;
  hostId?: string;
  avatarColor: string;
  avatarUri?: string;
  /** Bundled avatar image (official @brandthread silver B); wins over `avatarUri`. */
  avatarSource?: number;
  initials: string;
  /** Legacy; rail is monochrome + semantic red now. */
  accentColor?: string;
  engagement: RailEngagement | undefined;
  commentsCount: number;
  shares: number;
  saves: number;
  onOpenCreator: () => void;
  onPressInCreator?: () => void;
  onFollow: () => Promise<void> | void;
  onLike: () => Promise<void> | void;
  onOpenComments: () => void;
  onRepost: () => Promise<void> | void;
  onSave: () => Promise<void> | void;
  onSaveLongPress?: () => void;
  onShare: () => void;
  /** Legacy RN Animated values — ignored (motion is Reanimated now). */
  heartScale?: unknown;
  repostScale?: unknown;
  saveScale?: unknown;
  style?: StyleProp<ViewStyle>;
  testIdBase: string;
  reduceMotion?: boolean;
  /** Shows a small "Official" label under the avatar. */
  isOfficial?: boolean;
  /** Viewer's own post — no follow badge. */
  isSelf?: boolean;
  /** Parent-controlled pending follow; disables the badge meanwhile. */
  followPending?: boolean;
  /** Hide the follow badge entirely (surfaces without follow wiring). */
  showFollow?: boolean;
  /** Rendered under Share (the spinning sound disc). */
  footerSlot?: React.ReactNode;
  /** Distance from the page bottom to the caption text's last line bottom. */
  shareBottom?: number;
}) {
  const [footerHeight, setFooterHeight] = React.useState(footerSlot ? 44 : 0);
  // Live ring owns the avatar's bottom edge (LIVE pill) — suppress the
  // competing follow badge while the creator is live.
  const isLive = !!useLiveStreamForHost(hostId);
  const following = !!engagement?.following;

  const [badgeVisible, setBadgeVisible] = React.useState(!following);
  const [showCheck, setShowCheck] = React.useState(following);
  const [localPending, setLocalPending] = React.useState(false);
  const wasFollowing = React.useRef(following);
  const badgeOpacity = useSharedValue(following ? 0 : 1);
  const badgeScale = useSharedValue(1);
  const badgeFill = useSharedValue(following ? 1 : 0);

  React.useEffect(() => {
    if (following === wasFollowing.current) return;
    wasFollowing.current = following;
    if (!following) {
      // Unfollow or parent rollback: badge returns instantly as "+".
      setShowCheck(false);
      setBadgeVisible(true);
      badgeOpacity.value = 1; badgeScale.value = 1; badgeFill.value = 0;
      return;
    }
    setShowCheck(true);
    if (reduceMotion) {
      badgeOpacity.value = 0;
      setBadgeVisible(false);
      return;
    }
    badgeFill.value = withTiming(1, { duration: 120 });
    badgeScale.value = withSequence(withTiming(0.8, { duration: 80 }), withSpring(1.1, { damping: 8 }), withSpring(1));
    badgeOpacity.value = withDelay(650, withTiming(0, { duration: 220 }, (done) => {
      if (done) runOnJS(setBadgeVisible)(false);
    }));
  }, [following, reduceMotion, badgeOpacity, badgeScale, badgeFill]);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badgeOpacity.value,
    transform: [{ scale: badgeScale.value }],
    backgroundColor: badgeFill.value > 0.5 ? ON_DARK : HEART_RED,
  }));

  const pending = !!followPending || localPending;
  const handleFollow = async () => {
    if (pending || following) return;
    setLocalPending(true);
    try { await onFollow(); } catch { /* parent owns toast/rollback */ } finally { setLocalPending(false); }
  };

  const likes = engagement?.likes ?? 0;
  const reposts = engagement?.reposts ?? 0;
  const saveCount = engagement?.saves ?? saves;
  const liked = !!engagement?.liked;
  const saved = !!engagement?.saved;
  const reposted = !!engagement?.reposted;

  return (
    <View style={[styles.rail, style, shareBottom === undefined ? undefined : {
      bottom: shareBottom - (footerSlot ? footerHeight + RAIL_ITEM_GAP : 0),
    }]} pointerEvents="box-none">
      <View style={styles.avatarWrap}>
        <Pressable
          onPress={onOpenCreator}
          onPressIn={onPressInCreator}
          style={({ pressed }) => [styles.avatarHit, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`View ${creator}'s profile${isOfficial ? ', official account' : ''}`}
          testID={`avatar-btn-${testIdBase}`}
        >
          <LiveHostRing hostId={hostId} size={AVATAR} ringGap={1.5} ringWidth={2}>
            {avatarSource ? (
              <View style={[styles.avatar, styles.avatarBlack]}>
                <Image source={avatarSource} style={styles.fill} resizeMode="cover" testID="rail-official-avatar" />
              </View>
            ) : avatarUri ? (
              <Image cachePolicy="memory-disk" source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
          </LiveHostRing>
        </Pressable>
        {badgeVisible && showFollow && !isLive && !isSelf && (
          <Animated.View style={[styles.badge, badgeStyle]}>
            <Pressable
              onPress={handleFollow}
              disabled={pending || following}
              hitSlop={12}
              style={styles.badgeHit}
              accessibilityRole="button"
              accessibilityLabel={following ? `Following ${creator}` : `Follow ${creator}`}
              accessibilityState={{ disabled: pending || following, busy: pending }}
              testID={`follow-btn-${testIdBase}`}
            >
              <RailGlyph name={showCheck ? 'check' : 'plus'} size={14} color={showCheck ? HEART_RED : ON_DARK} shadow={false} />
            </Pressable>
          </Animated.View>
        )}
        {isOfficial && <Text style={styles.official} numberOfLines={1} testID={`official-label-${testIdBase}`}>Official</Text>}
      </View>

      <RailAction
        glyph="heart" count={likes} active={liked} activeColor={HEART_RED} kind="pop" reduceMotion={reduceMotion}
        onPress={onLike} label={`${liked ? 'Unlike' : 'Like'}, ${likes} likes`} checked={liked} testID={`like-btn-${testIdBase}`}
      />
      <RailAction
        glyph="comment" count={commentsCount} active={false} activeColor={ON_DARK} kind="none"
        onPress={onOpenComments} label={`Comments, ${commentsCount}`} testID={`comment-btn-${testIdBase}`}
      />
      <RailAction
        glyph="repost" count={reposts} active={reposted} activeColor={SILVER} kind="rotate" reduceMotion={reduceMotion}
        onPress={onRepost} label={`${reposted ? 'Undo repost' : 'Repost'}, ${reposts} reposts`} checked={reposted} testID={`repost-btn-${testIdBase}`}
      />
      <RailAction
        glyph="bookmark" count={saveCount} active={saved} activeColor={SILVER} kind="bounce" reduceMotion={reduceMotion}
        onPress={onSave} onLongPress={onSaveLongPress} label={`${saved ? 'Unsave' : 'Save'}, ${saveCount} saves`} checked={saved} testID={`save-btn-${testIdBase}`}
      />
      <RailAction
        glyph="share" count={shares} active={false} activeColor={ON_DARK} kind="none"
        onPress={onShare} label="Share post" testID={`share-btn-${testIdBase}`}
      />
      {footerSlot ? <View onLayout={e => setFooterHeight(e.nativeEvent.layout.height)}>{footerSlot}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', right: 6, width: RAIL_WIDTH, alignItems: 'center', gap: RAIL_ITEM_GAP },
  // Height pinned to the avatar so badge/Official never stretch spacing;
  // both live absolutely in the reserved avatar->Like interstitial.
  avatarWrap: { alignItems: 'center', height: AVATAR, marginBottom: RAIL_AVATAR_TO_LIKE - RAIL_ITEM_GAP },
  avatarHit: { width: AVATAR, height: AVATAR, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: AVATAR, height: AVATAR, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 3, borderColor: ON_DARK, overflow: 'hidden',
  },
  avatarBlack: { backgroundColor: '#000' },
  fill: { width: '100%', height: '100%' },
  avatarText: { fontSize: 15, fontWeight: '700', color: ON_DARK },
  badge: {
    position: 'absolute', top: AVATAR - BADGE / 2, width: BADGE, height: BADGE, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 3,
  },
  badgeHit: { width: BADGE, height: BADGE, alignItems: 'center', justifyContent: 'center' },
  // Sits just below the follow badge's bottom edge (AVATAR + BADGE/2).
  official: {
    position: 'absolute', top: AVATAR + BADGE / 2, width: 64, textAlign: 'center',
    fontSize: 10, lineHeight: 10, fontWeight: '600', color: SILVER, letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  action: { minWidth: 44, minHeight: 0, alignItems: 'center', justifyContent: 'center', gap: RAIL_COUNT_GAP },
  pressed: { opacity: 0.7 },
  count: Platform.select({
    web: {
      fontSize: 12, lineHeight: 14, fontWeight: '600', color: ON_DARK, ...TABULAR_NUMS,
      textShadow: '0px 1px 2px rgba(0,0,0,0.6)',
    } as object,
    default: {
      fontSize: 12, lineHeight: 14, fontWeight: '600', color: ON_DARK, ...TABULAR_NUMS,
      textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
    },
  }) as object,
});
