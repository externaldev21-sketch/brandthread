/**
 * Buyer Threads Home feed — right action rail.
 *
 * avatar+follow badge, like, comment, repost, save, share, and a spinning
 * sound disc (TikTok's music-disc affordance) — solid white icons with a
 * subtle drop shadow, evenly spaced, real counts underneath. Positioned off
 * the same `bottomClearance` the caption block and tab bar use, so it never
 * overlaps the tab bar at any viewport.
 *
 * Icon size (~24-25pt) and vertical rhythm (~19pt gaps between action items)
 * match this repo's existing rail, cross-checked against Mobbin's TikTok For
 * You screens gathered for this rebuild (avatar ~44-48pt with a small
 * bottom-anchored follow badge, action icons visually ~28pt including their
 * label, evenly spaced down the right edge) — see the PR description.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { EngagementButton } from '@/components/EngagementButton';
import { formatCount } from '@/lib/engagementUtils';
import { FONT, GOLD, ON_DARK } from '@/lib/theme';
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
  soundOn, onToggleSound,
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
  soundOn: boolean;
  onToggleSound: () => void;
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
  const discSpin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (soundOn) {
      discSpin.setValue(0);
      loop = Animated.loop(
        Animated.timing(discSpin, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true }),
      );
      loop.start();
    }
    return () => { loop?.stop(); };
  }, [soundOn, discSpin]);

  return (
    <Animated.View style={[styles.rail, style]}>
      <View style={styles.avatarWrap}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenCreator(); }}
          accessibilityRole="button"
          accessibilityLabel={`View ${creator}'s profile`}
        >
          <LiveHostRing hostId={hostId} size={44} showTag={!!engagement?.following}>
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          </LiveHostRing>
        </TouchableOpacity>
        {!engagement?.following && (
          <EngagementButton
            icon="plus"
            iconSize={11}
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
          iconSize={25}
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
        <FontAwesome name="commenting" size={24} color={ON_DARK} />
        <Text style={styles.count}>{formatCount(commentsCount)}</Text>
      </TouchableOpacity>

      <EngagementButton
        icon="repeat"
        solidIcon="retweet"
        iconSize={25}
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
        iconSize={24}
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
        <FontAwesome name="share" size={24} color={ON_DARK} />
        <Text style={styles.count}>{formatCount(shares)}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.discBtn}
        activeOpacity={0.75}
        onPress={onToggleSound}
        hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={soundOn ? 'Mute sound' : 'Unmute sound'}
        accessibilityState={{ checked: soundOn }}
        testID={`sound-disc-${testIdBase}`}
      >
        <Animated.View
          style={[
            styles.disc,
            { transform: [{ rotate: discSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] },
          ]}
        >
          <View style={styles.discCenter} />
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: 'absolute', right: 10, width: 52, alignItems: 'center', gap: 19,
  },
  avatarWrap: { alignItems: 'center', marginBottom: 3 },
  avatar: {
    width: 44, height: 44, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: ON_DARK,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4,
  },
  avatarText: { fontSize: 13, fontFamily: FONT.bold, color: ON_DARK },
  followBadge: {
    position: 'absolute', bottom: -8, width: 20, height: 20, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#000',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.35, shadowRadius: 3, elevation: 3,
  },
  btn: { width: 48, alignItems: 'center', gap: 3 },
  actionContent: { width: 48, alignItems: 'center', gap: 3 },
  likeWrap: { width: 48, alignItems: 'center', justifyContent: 'center' },
  likeRing: {
    position: 'absolute', top: 4, width: 34, height: 34, borderRadius: RADII.pill,
    borderWidth: 2, borderColor: '#EF4444',
  },
  count: {
    fontSize: 11, lineHeight: 13, fontFamily: FONT.bold, color: ON_DARK,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  // Spinning sound disc — a small vinyl-record affordance under the share
  // button, TikTok's music-disc pattern, doubling as the sound on/off toggle.
  discBtn: { width: 48, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#171717',
    borderWidth: 2, borderColor: ON_DARK, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  discCenter: { width: 8, height: 8, borderRadius: 4, backgroundColor: ON_DARK },
});
