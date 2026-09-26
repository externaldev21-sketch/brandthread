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
import { Animated, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
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
  creator, hostId, avatarColor, initials, accentColor,
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
          <LiveHostRing hostId={hostId} size={38} showTag={!!engagement?.following}>
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          </LiveHostRing>
        </TouchableOpacity>
        {!engagement?.following && (
          <EngagementButton
            icon="plus"
            iconSize={9}
            active={false}
            accessibilityLabel={`Follow ${creator}`}
            style={[styles.followBadge, { backgroundColor: accentColor }]}
            onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await onFollow(); }}
            testID={`follow-btn-${testIdBase}`}
          />
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
        iconSize={26}
        count={formatCount(engagement?.saves ?? saves)}
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
        <FontAwesome name="share" size={26} color={ON_DARK} style={styles.iconShadow} />
        <Text style={styles.count}>{formatCount(shares)}</Text>
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
    position: 'absolute', right: 8, width: 38, alignItems: 'center', gap: 12,
  },
  avatarWrap: { alignItems: 'center', marginBottom: 2 },
  avatar: {
    width: 38, height: 38, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: ON_DARK,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4,
  },
  avatarText: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  followBadge: {
    position: 'absolute', bottom: -6, width: 16, height: 16, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#000',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.35, shadowRadius: 3, elevation: 3,
  },
  btn: { width: 38, alignItems: 'center', gap: 2 },
  actionContent: { width: 38, alignItems: 'center', gap: 2 },
  likeWrap: { width: 38, alignItems: 'center', justifyContent: 'center' },
  likeRing: {
    position: 'absolute', top: 2, width: 34, height: 34, borderRadius: RADII.pill,
    borderWidth: 2, borderColor: '#EF4444',
  },
  count: {
    fontSize: 11, lineHeight: 13, fontFamily: FONT.semibold, color: ON_DARK, ...TABULAR_NUMS,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  // Same shadow as `count` above, applied to the rail's two plain icons
  // (comment, share — the EngagementButton-driven icons get the matching
  // `iconShadow` style inside EngagementButton.tsx itself). Without it,
  // comment and share's outline-ish glyph strokes wash out against bright
  // footage even at full white/opacity 1. (PR #122.)
  iconShadow: {
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
});
