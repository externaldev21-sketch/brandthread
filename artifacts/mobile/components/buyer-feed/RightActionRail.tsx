/**
 * Buyer Threads Home feed — right action rail, TikTok's stack exactly:
 * creator avatar (+ follow badge), Like, Comment, Save, Share, then the
 * spinning sound disc. Repost is not on the rail any more; it's the first
 * action in the share sheet, where TikTok has it (components/
 * ThreadShareSheet.tsx).
 *
 * Fixed geometry. Every row has a fixed height (RAIL_LAYOUT below) and the
 * caller pins the rail's `bottom` to one constant above the tab bar, so the
 * rail is pixel-identical on every post — video or slideshow, long or short
 * caption, Shop button or not. Nothing here measures itself or the post.
 * Counts reserve their line even when 0, and the avatar placeholder is the
 * same size as the photo, so nothing changes size while data loads.
 *
 * Measured from TikTok iOS For You frames on Mobbin, scaled to 390x844
 * (see docs/screenshots/tiktok-rail/README.md): avatar top at y=374, icon
 * pitch 65pt (Like/Comment/Save/Share glyph tops at 452/516/581/646), the
 * disc's bottom at y=747 (just above the progress line), glyph centre 30pt in from the
 * right edge.
 *
 * Purely visual: the feed owns persistence, rollback, toasts and haptics.
 * When the feed swaps the post the rail is bound to (it renders once, above
 * the pager), values change in place with no animation.
 */
import React from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { formatCount } from '@/lib/engagementUtils';
import { hapticLight } from '@/lib/haptics';
import { FONT, ON_DARK } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { LiveHostRing } from '@/components/live/LiveAvatarRing';
import { useLiveStreamForHost } from '@/lib/live/useLiveDirectory';

/** Fixed row heights. The rail's total height never depends on the post. */
export const RAIL_LAYOUT = {
  width: 48,
  avatar: 48,
  badge: 20,
  /** Avatar top -> Like icon box top (avatar + the follow badge's half below it + air). */
  avatarBlock: 73,
  /** One action: icon box + count line + the space to the next row's icon. */
  item: 65,
  icon: 32,
  countLine: 15,
  disc: 40,
} as const;
export const RAIL_HEIGHT = RAIL_LAYOUT.avatarBlock + RAIL_LAYOUT.item * 4 + RAIL_LAYOUT.disc;
/** Rail's right inset: puts the glyph centre 30pt in from the screen edge (TikTok). */
export const RAIL_RIGHT = 6;
/** The disc's bottom edge sits this far above the progress line's top (TikTok: disc bottom at y=747 of 844). */
export const RAIL_DISC_TO_PROGRESS = 12;

const LIKE_RED = '#EF4444';
// TikTok's saved-bookmark yellow.
const SAVE_YELLOW = '#FACE15';

/** Counts always show, starting at "0" (never a blank line). */
export function formatRailCount(n: number | undefined): string {
  return formatCount(Number(n) || 0) || '0';
}

export interface RailEngagement {
  liked?: boolean;
  likes?: number;
  saved?: boolean;
  saves?: number;
  following?: boolean;
}

export interface RailAnims {
  heartScale: Animated.Value;
  likeRing: Animated.Value;
  saveDrop: Animated.Value;
  saveScale: Animated.Value;
}

function RailAction({
  icon, size, count, color, label, checked, onPress, testID, scale, translateY, children,
}: {
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  size: number;
  count: number;
  color: string;
  label: string;
  checked?: boolean;
  onPress: () => void;
  testID: string;
  scale?: Animated.Value;
  translateY?: Animated.AnimatedInterpolation<number>;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.item}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={checked === undefined ? undefined : { checked }}
        testID={testID}
      >
        <View style={styles.iconBox}>
          {children}
          <Animated.View style={{ transform: [{ scale: scale ?? 1 }, { translateY: translateY ?? 0 }] }}>
            <FontAwesome name={icon} size={size} color={color} style={styles.iconShadow} />
          </Animated.View>
        </View>
        <Text style={styles.count} numberOfLines={1}>{formatRailCount(count)}</Text>
      </Pressable>
    </View>
  );
}

/** TikTok's spinning record: the creator's avatar on a dark disc. Decorative. */
function SoundDisc({
  sound, avatarUri, avatarColor, initials, spinning, testID,
}: {
  sound?: string;
  avatarUri?: string;
  avatarColor: string;
  initials: string;
  spinning: boolean;
  testID: string;
}) {
  const spin = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!spinning) return undefined;
    spin.setValue(0);
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spinning, spin]);
  return (
    <View
      style={styles.discSlot}
      accessible
      accessibilityRole="image"
      accessibilityLabel={sound ? `Sound: ${sound}` : 'Original sound'}
      testID={testID}
    >
      <Animated.View style={[styles.disc, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
        <View style={[styles.discArt, { backgroundColor: avatarColor }]}>
          {avatarUri
            ? <Image source={{ uri: avatarUri }} style={styles.discArtImage} />
            : <Text style={styles.discInitials}>{initials.slice(0, 2)}</Text>}
        </View>
      </Animated.View>
    </View>
  );
}

export function RightActionRail({
  creator, hostId, avatarColor, avatarUri, initials, sound,
  engagement, commentsCount, shares, saves,
  onOpenCreator, onFollow, onLike, onOpenComments, onSave, onShare,
  anims, discSpinning = true, style, testIdBase, reduceMotion,
}: {
  creator: string;
  /** The post's seller id — shows the live ring when that seller is live. */
  hostId?: string;
  avatarColor: string;
  /** Seller avatar photo; the initials swatch (same size) shows until/unless it loads. */
  avatarUri?: string;
  initials: string;
  /** Sound name, for the disc's accessibility label. */
  sound?: string;
  engagement: RailEngagement | undefined;
  commentsCount: number;
  shares: number;
  saves: number;
  onOpenCreator: () => void;
  onFollow: () => Promise<void> | void;
  onLike: () => Promise<void> | void;
  onOpenComments: () => void;
  onSave: () => Promise<void> | void;
  onShare: () => void;
  anims: RailAnims;
  /** False while the post is paused, so the disc stops with the video. */
  discSpinning?: boolean;
  style?: any;
  /** The bound post's id — test ids, and the "post changed" signal below. */
  testIdBase: string;
  /** Skips the follow badge's rotate/fill/fade and the disc spin. */
  reduceMotion?: boolean;
}) {
  // While the creator is live, the LIVE pill owns the avatar's bottom edge,
  // so the follow badge stays hidden until the stream ends.
  const isLive = !!useLiveStreamForHost(hostId);
  const following = !!engagement?.following;
  const [badgeVisible, setBadgeVisible] = React.useState(!following);
  const [showCheck, setShowCheck] = React.useState(following);
  const shown = React.useRef({ postId: testIdBase, following });
  const badgeRotate = React.useRef(new Animated.Value(following ? 1 : 0)).current;
  const badgeFill = React.useRef(new Animated.Value(following ? 1 : 0)).current;
  const badgeOpacity = React.useRef(new Animated.Value(following ? 0 : 1)).current;

  React.useEffect(() => {
    const prev = shown.current;
    shown.current = { postId: testIdBase, following };
    if (prev.postId === testIdBase && prev.following === following) return;
    // A different post (swipe), an unfollow or a rollback: jump straight to
    // the resting state. Only following the creator of the post on screen
    // plays the + -> check animation.
    if (prev.postId !== testIdBase || !following || reduceMotion) {
      badgeRotate.setValue(following ? 1 : 0);
      badgeFill.setValue(following ? 1 : 0);
      badgeOpacity.setValue(following ? 0 : 1);
      setShowCheck(following);
      setBadgeVisible(!following);
      return;
    }
    Animated.timing(badgeRotate, { toValue: 1, duration: 150, useNativeDriver: true }).start(() => {
      setShowCheck(true);
      Animated.timing(badgeFill, { toValue: 1, duration: 100, useNativeDriver: false }).start(() => {
        Animated.timing(badgeOpacity, { toValue: 0, duration: 200, delay: 250, useNativeDriver: true }).start(({ finished }) => {
          if (finished && shown.current.following) setBadgeVisible(false);
        });
      });
    });
  }, [testIdBase, following, reduceMotion, badgeRotate, badgeFill, badgeOpacity]);

  const likes = engagement?.likes ?? 0;
  const liked = !!engagement?.liked;
  const saveCount = engagement?.saves ?? saves;
  const saved = !!engagement?.saved;

  return (
    <View style={[styles.rail, style]} pointerEvents="box-none" testID="thread-action-rail">
      <View style={styles.avatarBlock}>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenCreator(); }}
          style={({ pressed }) => pressed && styles.pressed}
          accessibilityRole="button"
          accessibilityLabel={`View ${creator}'s profile`}
          testID={`avatar-btn-${testIdBase}`}
        >
          <LiveHostRing hostId={hostId} size={RAIL_LAYOUT.avatar} ringGap={1.5} ringWidth={2}>
            {/* Seamless: the photo just clips to a circle — no border, ring
                or outline. The initials swatch underneath is the same size,
                so a slow avatar never changes the rail's layout. */}
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{initials}</Text>
              {avatarUri ? <Image source={{ uri: avatarUri }} style={StyleSheet.absoluteFill} /> : null}
            </View>
          </LiveHostRing>
        </Pressable>
        {badgeVisible && !isLive && (
          <Animated.View
            style={[
              styles.followBadge,
              {
                opacity: badgeOpacity,
                backgroundColor: badgeFill.interpolate({ inputRange: [0, 1], outputRange: [ON_DARK, '#000000'] }),
                transform: [{ rotate: badgeRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }],
              },
            ]}
          >
            <Pressable
              style={styles.followBadgeTouchable}
              disabled={following}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Follow ${creator}`}
              onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await onFollow(); }}
              testID={`follow-btn-${testIdBase}`}
            >
              <Feather name={showCheck ? 'check' : 'plus'} size={13} color={showCheck ? ON_DARK : '#000000'} />
            </Pressable>
          </Animated.View>
        )}
      </View>

      <RailAction
        icon="heart"
        size={29}
        count={likes}
        color={liked ? LIKE_RED : ON_DARK}
        label={`${liked ? 'Unlike' : 'Like'}, ${likes} likes`}
        checked={liked}
        scale={anims.heartScale}
        // Light haptic in the same tick the heart's bump starts (the feed's
        // onLike runs bumpRailHeart before awaiting the request).
        onPress={() => { hapticLight(); void onLike(); }}
        testID={`like-btn-${testIdBase}`}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.likeRing,
            {
              opacity: anims.likeRing.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
              transform: [{ scale: anims.likeRing.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }],
            },
          ]}
        />
      </RailAction>

      <RailAction
        icon="commenting"
        size={29}
        count={commentsCount}
        color={ON_DARK}
        label={`Comments, ${commentsCount}`}
        onPress={onOpenComments}
        testID={`comment-btn-${testIdBase}`}
      />

      <RailAction
        icon="bookmark"
        size={28}
        count={saveCount}
        color={saved ? SAVE_YELLOW : ON_DARK}
        label={`${saved ? 'Unsave' : 'Save'}, ${saveCount} saves`}
        checked={saved}
        scale={anims.saveScale}
        translateY={anims.saveDrop.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, -6, 0] })}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void onSave(); }}
        testID={`save-btn-${testIdBase}`}
      />

      <RailAction
        icon="share"
        size={28}
        count={shares}
        color={ON_DARK}
        label={`Share, ${shares} shares`}
        onPress={onShare}
        testID={`share-btn-${testIdBase}`}
      />

      <SoundDisc
        sound={sound}
        avatarUri={avatarUri}
        avatarColor={avatarColor}
        initials={initials}
        spinning={discSpinning && !reduceMotion}
        testID={`sound-disc-${testIdBase}`}
      />
    </View>
  );
}

const shadowText = Platform.select({
  web: { textShadow: '0px 1px 2px rgba(0,0,0,0.45), 0px 0px 8px rgba(0,0,0,0.25)' } as object,
  default: { textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
});

const styles = StyleSheet.create({
  rail: { position: 'absolute', width: RAIL_LAYOUT.width, height: RAIL_HEIGHT, alignItems: 'center' },
  avatarBlock: { width: RAIL_LAYOUT.width, height: RAIL_LAYOUT.avatarBlock, alignItems: 'center' },
  avatar: {
    width: RAIL_LAYOUT.avatar, height: RAIL_LAYOUT.avatar, borderRadius: RADII.pill, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontFamily: FONT.bold, color: ON_DARK },
  // Centred on the avatar's bottom edge, TikTok-style. No border: it must
  // never draw a ring onto the avatar.
  followBadge: {
    position: 'absolute', top: RAIL_LAYOUT.avatar - RAIL_LAYOUT.badge / 2,
    width: RAIL_LAYOUT.badge, height: RAIL_LAYOUT.badge, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 3,
  },
  followBadgeTouchable: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  item: { width: RAIL_LAYOUT.width, height: RAIL_LAYOUT.item, alignItems: 'center' },
  action: { width: RAIL_LAYOUT.width, alignItems: 'center' },
  pressed: { opacity: 0.7 },
  iconBox: { width: RAIL_LAYOUT.icon + 8, height: RAIL_LAYOUT.icon, alignItems: 'center', justifyContent: 'center' },
  iconShadow: shadowText,
  likeRing: {
    position: 'absolute', width: 34, height: 34, borderRadius: RADII.pill, borderWidth: 2, borderColor: LIKE_RED,
  },
  // 13pt semibold white with a shadow; fixed line height + tabular digits so
  // a count changing (or loading) never moves anything.
  count: {
    width: 64, height: RAIL_LAYOUT.countLine, marginTop: 1, textAlign: 'center',
    fontSize: 13, lineHeight: RAIL_LAYOUT.countLine, fontFamily: FONT.semibold, color: ON_DARK,
    ...TABULAR_NUMS, ...shadowText,
  },
  discSlot: { width: RAIL_LAYOUT.width, height: RAIL_LAYOUT.disc, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: RAIL_LAYOUT.disc, height: RAIL_LAYOUT.disc, borderRadius: RADII.pill, backgroundColor: '#161616',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.35, shadowRadius: 3, elevation: 3,
  },
  discArt: { width: 24, height: 24, borderRadius: RADII.pill, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  discArtImage: { width: 24, height: 24 },
  discInitials: { fontSize: 9, fontFamily: FONT.bold, color: ON_DARK },
});
