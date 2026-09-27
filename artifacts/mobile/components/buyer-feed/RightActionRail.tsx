/**
 * Buyer Threads Home feed — right action rail.
 *
 * avatar+follow badge, like, comment, repost, save, share, and a spinning
 * sound disc (TikTok's music-disc affordance) — solid white icons with a
 * subtle drop shadow, evenly spaced, real counts underneath. Positioned off
 * the same `bottomClearance` the caption block and tab bar use, so it never
 * overlaps the tab bar at any viewport.
 *
 * Sizing/placement (38pt avatar/action-column width) ported from dev PR
 * #133 ("shrink feed rail/caption below pre-#129 sizes — smaller,
 * tighter"), which supersedes PR #129's own 34pt/44pt pass and the earlier
 * PR #88 sizing this rail originally shipped with. Icons are 28pt — the
 * app-wide "action rail" size (icon-consistency pass) — up from that PR's
 * 26pt; the 38pt column comfortably clears it, so no layout changed. Icon
 * drop shadows are from PR #122 (rail icon shadows) — see `iconShadow`
 * below and `EngagementButton`'s own `iconShadow` style, applied to every
 * EngagementButton-driven icon here (like/repost/save/follow).
 */
import React from 'react';
import { Animated, Image, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { EngagementButton } from '@/components/EngagementButton';
import { formatCount } from '@/lib/engagementUtils';
import { FONT, FS, GOLD, ON_DARK } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { LiveHostRing } from '@/components/live/LiveAvatarRing';

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
  style, testIdBase,
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
}) {
  return (
    <Animated.View style={[styles.rail, style]}>
      <View style={styles.avatarWrap}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenCreator(); }}
          accessibilityRole="button"
          accessibilityLabel={`View ${creator}'s profile`}
        >
          {/* ringGap 1.5 (was the component's own default, 3) — that
              default was the "dark gap between the photo and the ring"
              the owner flagged; the ring now hugs the avatar with only a
              1.5pt gap, plus ringWidth 2. */}
          <LiveHostRing hostId={hostId} size={38} showTag={!!engagement?.following} ringGap={1.5} ringWidth={2}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
          </LiveHostRing>
        </TouchableOpacity>
        {!engagement?.following && (
          // Plain TouchableOpacity, not EngagementButton — EngagementButton
          // applies the `style` prop passed to it to its *inner* content
          // view, not the outer touchable wrapper, so a positioning style
          // like this one landed on a zero-size outer box and only
          // happened to look roughly right by flow-layout coincidence.
          // That's what let it drift onto the ring/initials; this needs
          // exact placement (see the math in the PR description), so it's
          // a plain absolutely-positioned button instead.
          <TouchableOpacity
            style={styles.followBadge}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Follow ${creator}`}
            onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await onFollow(); }}
            testID={`follow-btn-${testIdBase}`}
          >
            <Feather name="plus" size={11} color="#000000" />
          </TouchableOpacity>
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
          iconSize={28}
          count={(engagement?.likes ?? 0) > 0 ? formatCount(engagement?.likes ?? 0) : undefined}
          active={engagement?.liked ?? false}
          activeColor="#EF4444"
          inactiveColor={ON_DARK}
          accessibilityLabel={`${engagement?.liked ? 'Unlike' : 'Like'}, ${formatCount(engagement?.likes ?? 0)} likes`}
          accessibilityState={{ checked: engagement?.liked ?? false }}
          scaleAnim={heartScale}
          style={styles.actionContent}
          onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await onLike(); }}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          testID={`like-btn-${testIdBase}`}
        />
      </View>

      <TouchableOpacity
        style={styles.btn}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
        onPress={onOpenComments}
        accessibilityRole="button"
        accessibilityLabel={`Comments, ${formatCount(commentsCount)}`}
      >
        <FontAwesome name="commenting" size={28} color={ON_DARK} style={styles.iconShadow} />
        {commentsCount > 0 && <Text style={styles.count}>{formatCount(commentsCount)}</Text>}
      </TouchableOpacity>

      <EngagementButton
        icon="repeat"
        solidIcon="retweet"
        iconSize={28}
        count={(engagement?.reposts ?? 0) > 0 ? formatCount(engagement?.reposts ?? 0) : undefined}
        active={engagement?.reposted ?? false}
        activeColor={accentColor}
        inactiveColor={ON_DARK}
        accessibilityLabel={`${engagement?.reposted ? 'Undo repost' : 'Repost'}, ${formatCount(engagement?.reposts ?? 0)} reposts`}
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
        iconSize={28}
        count={(engagement?.saves ?? saves) > 0 ? formatCount(engagement?.saves ?? saves) : undefined}
        active={engagement?.saved ?? false}
        activeColor={GOLD}
        inactiveColor={ON_DARK}
        accessibilityLabel={`${engagement?.saved ? 'Unsave' : 'Save'}, ${formatCount(engagement?.saves ?? saves)} saves`}
        accessibilityState={{ checked: engagement?.saved ?? false }}
        style={styles.actionContent}
        translateYAnim={saveDrop}
        scaleAnim={saveScale}
        onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await onSave(); }}
        hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
        testID={`save-btn-${testIdBase}`}
      />

      <TouchableOpacity
        style={styles.btn}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Share post"
        onPress={onShare}
      >
        <FontAwesome name="share" size={28} color={ON_DARK} style={styles.iconShadow} />
        {shares > 0 && <Text style={styles.count}>{formatCount(shares)}</Text>}
      </TouchableOpacity>
    </Animated.View>
  );
}

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
    alignItems: 'center', justifyContent: 'center', backgroundColor: ON_DARK,
    borderWidth: 1.5, borderColor: '#000',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.35, shadowRadius: 3, elevation: 3,
  },
  btn: { width: 38, alignItems: 'center', gap: 3 },
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
  count: {
    fontSize: 12, lineHeight: 15, fontFamily: FONT.semibold, color: ON_DARK, ...TABULAR_NUMS,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  // Stronger drop shadow (was 0.5/radius 2) applied to the rail's two plain
  // icons (comment, share — the EngagementButton-driven icons get the
  // matching `iconShadow` style inside EngagementButton.tsx itself), tuned
  // against a bright/high-key clip (e.g. Maison Vela's silver dress) where
  // the previous, lighter shadow washed out to nearly nothing. (PR #122,
  // strengthened for feed legibility round.)
  iconShadow: {
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4,
  },
});
