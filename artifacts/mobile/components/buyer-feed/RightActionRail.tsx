/**
 * Buyer Threads Home feed — right action rail.
 *
 * avatar+follow badge, like, comment, repost, save, share, and a spinning
 * sound disc (TikTok's music-disc affordance) — solid white icons with a
 * subtle drop shadow, evenly spaced, real counts underneath. Positioned off
 * the same `bottomClearance` the caption block and tab bar use, so it never
 * overlaps the tab bar at any viewport.
 *
 * Sizing/placement (26pt icons, 38pt avatar/action-column width) ported
 * from dev PR #133 ("shrink feed rail/caption below pre-#129 sizes —
 * smaller, tighter"), which supersedes PR #129's own 34pt/44pt pass and the
 * earlier PR #88 sizing this rail originally shipped with. Icon drop
 * shadows are from PR #122 (rail icon shadows) — see `iconShadow` below and
 * `EngagementButton`'s own `iconShadow` style, applied to every
 * EngagementButton-driven icon here (like/repost/save/follow).
 */
import React from 'react';
import { Animated, Image, Text, TouchableOpacity, View, StyleSheet, Platform } from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { EngagementButton } from '@/components/EngagementButton';
import { formatCount } from '@/lib/engagementUtils';
import { hapticLight } from '@/lib/haptics';
import { FONT, FS, GOLD, ON_DARK } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { LiveHostRing } from '@/components/live/LiveAvatarRing';
import { useLiveStreamForHost } from '@/lib/live/useLiveDirectory';
import { useHitAreaBoost } from '@/hooks/useHitAreaBoost';

export interface RailEngagement {
  liked?: boolean;
  likes?: number;
  saved?: boolean;
  saves?: number;
  reposted?: boolean;
  reposts?: number;
  following?: boolean;
}

export function RightActionRail({
  creator, hostId, avatarColor, avatarUri, initials, accentColor,
  engagement, commentsCount, shares, saves,
  onOpenCreator, onFollow, onLike, onOpenComments, onRepost, onSave, onShare,
  heartScale, likeRing, repostSpin, repostScale, saveDrop, saveScale,
  style, testIdBase, reduceMotion,
}: {
  creator: string;
  /** The video's host/seller id — used to show a live ring around the
   *  avatar (see LiveHostRing) when that seller is currently live. */
  hostId?: string;
  avatarColor: string;
  /** Seller avatar photo. Falls back to the initials swatch below when
   *  absent — none of the bundled demo posts have one yet, so this is a
   *  no-op there; real posts with a seller avatar URL will pick it up. */
  avatarUri?: string;
  initials: string;
  accentColor: string;
  engagement: RailEngagement | undefined;
  commentsCount: number;
  shares: number;
  saves: number;
  onOpenCreator: () => void;
  onFollow: () => Promise<void> | void;
  onLike: () => Promise<void> | void;
  onOpenComments: () => void;
  onRepost: () => Promise<void> | void;
  onSave: () => Promise<void> | void;
  onShare: () => void;
  heartScale: Animated.Value;
  likeRing: Animated.Value;
  repostSpin: Animated.Value;
  repostScale: Animated.Value;
  saveDrop: Animated.Value;
  saveScale: Animated.Value;
  style?: any;
  testIdBase: string;
  /** Skips the follow badge's rotate/color-fill/fade sub-steps and just
   *  jumps to its resting state — same "disable non-essential motion"
   *  gate the rest of the feed's motion pass respects. */
  reduceMotion?: boolean;
}) {
  // Bug fix (urgent rail-fixes pass): when this creator is currently live,
  // the small "LIVE" pill from LiveHostRing/LiveAvatarRing (PR #288) sits
  // anchored at the ring's bottom edge — the same spot the follow "+"
  // badge below used to occupy, so the two collided/stacked when a live
  // creator wasn't yet followed. IG's own avatar treatment doesn't show a
  // competing follow badge over a live ring, so the "+" badge is simply
  // suppressed for the duration this creator is live — the LIVE pill's own
  // position/styling (from #288) is untouched, and the badge reappears in
  // its normal spot the moment the stream ends.
  const isLive = !!useLiveStreamForHost(hostId);
  // Pads each plain (non-EngagementButton) rail control's real tap area up
  // to 44x44 without growing its visible footprint — see
  // useHitAreaBoost's doc comment. The EngagementButton-driven icons
  // (like/repost/save) get the same treatment inside that component itself.
  const avatarHit = useHitAreaBoost();
  const commentHit = useHitAreaBoost();
  const shareHit = useHitAreaBoost();
  const [badgeVisible, setBadgeVisible] = React.useState(!engagement?.following);
  const [showCheck, setShowCheck] = React.useState(!!engagement?.following);
  const wasFollowing = React.useRef(!!engagement?.following);
  const followBadgeRotate = React.useRef(new Animated.Value(engagement?.following ? 1 : 0)).current;
  const followBadgeColor = React.useRef(new Animated.Value(engagement?.following ? 1 : 0)).current;
  const followBadgeOpacity = React.useRef(new Animated.Value(engagement?.following ? 0 : 1)).current;

  React.useEffect(() => {
    const isFollowing = !!engagement?.following;
    if (isFollowing === wasFollowing.current) return;
    wasFollowing.current = isFollowing;

    if (!isFollowing) {
      // Unfollowed again (or reset) — badge comes straight back, no replay
      // of the follow animation.
      setBadgeVisible(true);
      setShowCheck(false);
      followBadgeRotate.setValue(0);
      followBadgeColor.setValue(0);
      followBadgeOpacity.setValue(1);
      return;
    }

    if (reduceMotion) {
      setBadgeVisible(false);
      return;
    }

    // Sub-steps per the motion pass: '+' rotates into a checkmark (150ms),
    // the badge fills from white to black (100ms), holds briefly, then
    // fades out (200ms) before unmounting.
    Animated.timing(followBadgeRotate, { toValue: 1, duration: 150, useNativeDriver: true }).start(() => {
      setShowCheck(true);
      Animated.timing(followBadgeColor, { toValue: 1, duration: 100, useNativeDriver: false }).start(() => {
        Animated.timing(followBadgeOpacity, { toValue: 0, duration: 200, delay: 250, useNativeDriver: true }).start(() => {
          setBadgeVisible(false);
        });
      });
    });
  }, [engagement?.following, reduceMotion, followBadgeRotate, followBadgeColor, followBadgeOpacity]);

  return (
    <Animated.View style={[styles.rail, style]}>
      <View style={styles.avatarWrap}>
        <TouchableOpacity
          style={avatarHit.boostStyle}
          onLayout={avatarHit.onLayout}
          activeOpacity={0.8}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenCreator(); }}
          accessibilityRole="button"
          accessibilityLabel={`View ${creator}'s profile`}
        >
          {/* ringGap 1.5 (was the component's own default, 3) — that
              default was the "dark gap between the photo and the ring"
              the owner flagged; the ring now hugs the avatar with only a
              1.5pt gap, plus ringWidth 2.

              showTag intentionally left at its default (true): the red
              ring only ever renders when this host is genuinely live
              (LiveHostRing checks the live directory itself), so the
              "LIVE" tag must always accompany it. This previously read
              `showTag={!!engagement?.following}`, which tied the tag to
              whether the viewer follows the creator — wiring left over
              from the follow badge above and unrelated to live status.
              That produced a real, undiagnosed bug: a genuinely-live
              creator the viewer doesn't follow got the red ring with no
              LIVE tag, which reads as an unexplained red ring on a
              non-live post. Every other LiveHostRing/LiveAvatarRing call
              site in the app (profile, inbox row, story tray) already
              uses the default. */}
          <LiveHostRing hostId={hostId} size={38} ringGap={1.5} ringWidth={2}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
          </LiveHostRing>
        </TouchableOpacity>
        {badgeVisible && !isLive && (
          // Plain TouchableOpacity, not EngagementButton — EngagementButton
          // applies the `style` prop passed to it to its *inner* content
          // view, not the outer touchable wrapper, so a positioning style
          // like this one landed on a zero-size outer box and only
          // happened to look roughly right by flow-layout coincidence.
          // That's what let it drift onto the ring/initials; this needs
          // exact placement (see the math in the PR description), so it's
          // a plain absolutely-positioned button instead. The animated
          // outer View owns rotate/color/fade; the inner touchable just
          // fills it so the tap target doesn't shrink mid-animation.
          <Animated.View
            style={[
              styles.followBadge,
              {
                opacity: followBadgeOpacity,
                backgroundColor: followBadgeColor.interpolate({ inputRange: [0, 1], outputRange: [ON_DARK, '#000000'] }),
                transform: [{ rotate: followBadgeRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }],
              },
            ]}
          >
            <TouchableOpacity
              style={styles.followBadgeTouchable}
              // The badge is drawn at 14pt; pad its touch area to 44×44. Less
              // slop upward so taps on the avatar above still open the profile.
              hitSlop={FOLLOW_BADGE_HIT_SLOP}
              activeOpacity={0.8}
              disabled={!!engagement?.following}
              accessibilityRole="button"
              accessibilityLabel={`Follow ${creator}`}
              onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await onFollow(); }}
              testID={`follow-btn-${testIdBase}`}
            >
              <Feather
                name={showCheck ? 'check' : 'plus'}
                size={11}
                color={showCheck ? ON_DARK : '#000000'}
              />
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>

      <View style={styles.likeWrap} pointerEvents="box-none">
        <Animated.View
          pointerEvents="none"
          style={[
            styles.likeRing,
            {
              opacity: likeRing.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
              transform: [{ scale: likeRing.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }],
            },
          ]}
        />
        <EngagementButton
          icon="heart"
          solidIcon="heart"
          iconSize={26}
          count={formatCount(engagement?.likes ?? 0)}
          value={engagement?.likes ?? 0}
          active={engagement?.liked ?? false}
          activeColor="#EF4444"
          inactiveColor={ON_DARK}
          accessibilityLabel={`${engagement?.liked ? 'Unlike' : 'Like'}, ${engagement?.likes ?? 0} likes`}
          accessibilityState={{ checked: engagement?.liked ?? false }}
          scaleAnim={heartScale}
          style={styles.actionContent}
          // "Light" tier per the haptics tokens in lib/haptics.ts — unchanged
          // from earlier polish rounds. Fires synchronously here, in the
          // same tick EngagementButton's tapSpring kicks off (both happen
          // before `onLike` is awaited), so the haptic and the icon's
          // squash-overshoot-settle spring read as one moment.
          onPress={async () => { hapticLight(); await onLike(); }}
          tapSpring
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          testID={`like-btn-${testIdBase}`}
        />
      </View>

      <TouchableOpacity
        style={[styles.btn, commentHit.boostStyle]}
        onLayout={commentHit.onLayout}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
        onPress={onOpenComments}
        accessibilityRole="button"
        accessibilityLabel={`Comments, ${commentsCount}`}
      >
        <FontAwesome name="commenting" size={26} color={ON_DARK} style={styles.iconShadow} />
        <Text style={styles.count}>{formatCount(commentsCount)}</Text>
      </TouchableOpacity>

      <EngagementButton
        icon="repeat"
        solidIcon="retweet"
        iconSize={26}
        count={formatCount(engagement?.reposts ?? 0)}
        active={engagement?.reposted ?? false}
        activeColor={accentColor}
        inactiveColor={ON_DARK}
        accessibilityLabel={`${engagement?.reposted ? 'Undo repost' : 'Repost'}, ${engagement?.reposts ?? 0} reposts`}
        accessibilityState={{ checked: engagement?.reposted ?? false }}
        style={styles.actionContent}
        rotateAnim={repostSpin}
        scaleAnim={repostScale}
        onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await onRepost(); }}
        hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
        testID={`repost-btn-${testIdBase}`}
      />

      <EngagementButton
        icon="bookmark"
        solidIcon="bookmark"
        iconSize={26}
        count={formatCount(engagement?.saves ?? saves)}
        value={engagement?.saves ?? saves}
        active={engagement?.saved ?? false}
        activeColor={GOLD}
        inactiveColor={ON_DARK}
        accessibilityLabel={`${engagement?.saved ? 'Unsave' : 'Save'}, ${engagement?.saves ?? saves} saves`}
        accessibilityState={{ checked: engagement?.saved ?? false }}
        style={styles.actionContent}
        translateYAnim={saveDrop}
        scaleAnim={saveScale}
        onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await onSave(); }}
        hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
        testID={`save-btn-${testIdBase}`}
      />

      <TouchableOpacity
        style={[styles.btn, shareHit.boostStyle]}
        onLayout={shareHit.onLayout}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Share post"
        onPress={onShare}
      >
        <FontAwesome name="share" size={26} color={ON_DARK} style={styles.iconShadow} />
        <Text style={styles.count}>{formatCount(shares)}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const FOLLOW_BADGE_HIT_SLOP = { top: 6, bottom: 24, left: 15, right: 15 } as const;

const styles = StyleSheet.create({
  // Corrected pass, smaller than even the pre-#129 numbers per the owner's
  // explicit direction (SMALLER and TIGHTER than before, so the video
  // stands out): 38pt avatar, 26pt icon glyphs, 12pt rhythm between items,
  // 8pt right inset. (PR #133.)
  rail: {
    position: 'absolute', right: 10, width: 38, alignItems: 'center', gap: 14,
  },
  // marginBottom bumped 2 -> 6 (self-audit find #1): the follow badge now
  // hangs 13.5pt below the avatar's own bottom edge (see followBadge's own
  // math below), which only left ~2.5pt of clearance to the heart button
  // beneath it at the rail's default 14pt gap — tight enough to read as
  // crowded. This adds breathing room without moving the avatar itself.
  avatarWrap: { alignItems: 'center', marginBottom: 6 },
  avatar: {
    width: 38, height: 38, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: ON_DARK,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4,
  },
  // fontSize bumped FS.xs (11) -> FS.sm (self-audit find #2): two-letter
  // initials read small and cramped centered in the 38pt circle at 11pt.
  avatarText: { fontSize: FS.sm, fontFamily: FONT.bold, color: ON_DARK },
  // 16pt, black-on-white (not the seller's own accent color, which could
  // wash out or clash against any given video), positioned BELOW the ring
  // (TikTok-style) rather than on top of it.
  //
  // The math (avatar 38pt, LiveHostRing's ringGap 1.5 / ringWidth 2 above):
  //   ring outer radius  = avatar/2 + ringGap + ringWidth = 19 + 1.5 + 2 = 22.5
  //   ring outer bottom  = avatar center-y (19) + 22.5 = 41.5
  //   badge center-y     = ring outer bottom + 2         = 43.5
  //   badge top          = badge center-y - badge/2 (8)  = 35.5
  //   badge bottom       = badge center-y + badge/2 (8)  = 51.5
  //   `bottom` offset from the avatar's own bottom (38)  = -(51.5 - 38) = -13.5
  // avatarWrap centers its children (alignItems: 'center'), which is what
  // centers this horizontally too since no left/right is set.
  followBadge: {
    position: 'absolute', bottom: -13.5, width: 16, height: 16, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#000',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.35, shadowRadius: 3, elevation: 3,
  },
  followBadgeTouchable: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  // `minWidth` (not a fixed `width`) here — unlike `actionContent` below,
  // which sizes the *inner* content view EngagementButton wraps, this style
  // lands directly on the outer TouchableOpacity that useHitAreaBoost also
  // sizes, and a *fixed* width on that same box would take priority over —
  // and suppress — the boost's own `minWidth`. `minWidth: 38` still renders
  // exactly as wide as the old fixed `width: 38` did (content here is never
  // wider than 38 at this column's icon/count sizes), so this is a no-op
  // until the boost widens it further.
  btn: { minWidth: 38, alignItems: 'center', gap: 3 },
  actionContent: { width: 38, alignItems: 'center', gap: 3 },
  likeWrap: { width: 38, alignItems: 'center', justifyContent: 'center' },
  likeRing: {
    position: 'absolute', top: 2, width: 34, height: 34, borderRadius: RADII.pill,
    borderWidth: 2, borderColor: '#EF4444',
  },
  // 12pt semibold, pure white, one shared shadow — identical to
  // EngagementButton's own `count` style (components/EngagementButton.tsx)
  // so like/repost/save (EngagementButton-driven) and comment/share (plain,
  // below) read as one consistent row instead of some counts looking
  // brighter than others depending on how much of the legibility scrim
  // happens to fall behind that particular icon.
  //
  // TikTok two-layer shadow pass (still-washed-out round — see this same
  // block's comment in EngagementButton.tsx's `count`/`iconShadow` for the
  // full reasoning): web gets a tight-plus-wide stacked `textShadow`, native
  // keeps the single strongest shadow RN's Text props can express. Kept in
  // sync with EngagementButton.tsx's matching styles, per that file's own
  // convention.
  count: Platform.select({
    web: {
      fontSize: 12, lineHeight: 15, fontFamily: FONT.semibold, color: ON_DARK, ...TABULAR_NUMS,
      textShadow: '0px 1px 1px rgba(0,0,0,0.9), 0px 1px 6px rgba(0,0,0,0.55)',
    } as object,
    default: {
      fontSize: 12, lineHeight: 15, fontFamily: FONT.semibold, color: ON_DARK, ...TABULAR_NUMS,
      textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
    },
  }),
  // Stronger drop shadow (was 0.5/radius 2, then 0.45/radius 4, then
  // 0.7/radius 6) applied to the rail's two plain icons (comment, share —
  // the EngagementButton-driven icons get the matching `iconShadow` style
  // inside EngagementButton.tsx itself, kept identical to this one), tuned
  // against a bright/high-key clip (Atelier Noire's runway floor, live
  // Replit preview at 390x844) where the previous shadow still washed out
  // for thinner-stroke glyphs (repost/save/share) even though it read fine
  // on bold ones (heart, comment). (PR #122, strengthened for feed
  // legibility round, strengthened again in the urgent rail-fixes pass
  // (#324), strengthened again here with a real two-layer shadow on web.)
  iconShadow: Platform.select({
    web: {
      textShadow: '0px 1px 2px rgba(0,0,0,0.9), 0px 2px 10px rgba(0,0,0,0.6)',
    } as object,
    default: {
      textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
    },
  }),
});
