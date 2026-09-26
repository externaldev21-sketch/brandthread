/**
 * Buyer Threads Home feed — bottom-left info block.
 *
 * Repost identity (when present) → @handle + verified badge → 2-line
 * caption with a "more" expand → sound line. Sized and positioned per
 * Mobbin's TikTok For You references gathered for this rebuild: username
 * ~17pt bold, caption ~14.5pt/2 lines with a bold "more", a small
 * pill-shaped sound row below — see the PR description for the full
 * measurement list.
 *
 * The shop tag used to be a `shopPill` slot at the top of this stack; it's
 * now the screen-edge ShopSideTab rendered as its own sibling in feed.tsx
 * (see app/(tabs)/feed.tsx), so this stack starts straight at the
 * repost/creator row with no leftover gap where the pill used to sit.
 */
import React from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';

export interface RepostFriend {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

export function CaptionBlock({
  creator, verified, caption, sound, soundOn, onToggleSound,
  friendReposts, hasRepostIdentity, repostLabel, onOpenRepostIdentity,
  captionExpanded, onToggleCaptionExpanded,
  onOpenCreator,
  style,
}: {
  creator: string;
  verified: boolean;
  caption: string;
  sound: string;
  soundOn: boolean;
  onToggleSound: () => void;
  friendReposts: RepostFriend[];
  hasRepostIdentity: boolean;
  repostLabel: string;
  onOpenRepostIdentity: () => void;
  captionExpanded: boolean;
  onToggleCaptionExpanded: () => void;
  onOpenCreator: () => void;
  style?: any;
}) {
  return (
    <Animated.View
      style={[styles.root, hasRepostIdentity && styles.rootWithRepost, style]}
      pointerEvents="box-none"
    >
      {hasRepostIdentity && (
        <TouchableOpacity
          style={styles.repostIdentity}
          activeOpacity={friendReposts.length > 0 ? 0.8 : 1}
          disabled={friendReposts.length === 0}
          onPress={onOpenRepostIdentity}
          accessibilityRole={friendReposts.length > 0 ? 'button' : 'text'}
          accessibilityLabel={repostLabel}
        >
          <View style={styles.repostAvatarStack}>
            {friendReposts.slice(0, 3).map((friend, index) => (
              <View
                key={friend.userId}
                style={[styles.repostAvatar, { marginLeft: index === 0 ? 0 : -7, zIndex: 3 - index }]}
              >
                {friend.avatarUrl ? (
                  <CachedImage source={{ uri: friend.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.repostAvatarFallback]}>
                    <Text style={styles.repostAvatarInitials}>
                      {friend.displayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
            ))}
            {friendReposts.length === 0 && (
              <View style={[styles.repostAvatar, styles.repostAvatarFallback]}>
                <Feather name="user" size={13} color={ON_DARK} />
              </View>
            )}
          </View>
          <Text style={styles.repostIdentityText} numberOfLines={1}>{repostLabel}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenCreator(); }}
        accessibilityRole="button"
        accessibilityLabel={`View ${creator}'s profile`}
      >
        <View style={styles.creatorRow}>
          <Text style={styles.creatorName} numberOfLines={1}>{creator}</Text>
          {verified && <Feather name="check-circle" size={13} color="#4FA8FF" style={{ marginLeft: 4 }} />}
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => caption.length > 86 && onToggleCaptionExpanded()}
        activeOpacity={caption.length > 86 ? 0.7 : 1}
        accessibilityRole={caption.length > 86 ? 'button' : 'text'}
        accessibilityLabel={caption.length > 86 ? (captionExpanded ? 'Collapse caption' : 'Expand caption') : undefined}
        hitSlop={{ top: 4, bottom: 4 }}
      >
        <Text style={styles.caption} numberOfLines={captionExpanded ? undefined : 2}>
          {caption}
          {caption.length > 86 && (
            <Text style={styles.moreText}>{captionExpanded ? '  less' : '  more'}</Text>
          )}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.soundRow}
        onPress={onToggleSound}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={soundOn ? 'Mute sound' : 'Unmute sound'}
        accessibilityState={{ checked: soundOn }}
      >
        <Feather name={soundOn ? 'volume-2' : 'volume-x'} size={12} color={`${ON_DARK}CC`} />
        <Text style={styles.soundText} numberOfLines={1}>{sound}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // One consistent vertical rhythm, set as explicit per-step margins (not a
  // uniform `gap`, since each step needs its own value): creator name row ->
  // 6pt -> caption -> 8pt -> sound line -> (the caller's own gap to the
  // progress bar, see RAIL_BOTTOM_GAP/CAPTION_BOTTOM_GAP in
  // app/(tabs)/feed.tsx). The shop tag no longer starts this stack (it's
  // the screen-edge ShopSideTab now) — minHeight shrunk by its old 44pt-tall
  // pill + 12pt gap (56pt) accordingly, so there's no leftover reserved
  // space where it used to sit.
  root: {
    position: 'absolute', left: 16, right: 84, bottom: 26, minHeight: 56,
    justifyContent: 'flex-end',
  },
  rootWithRepost: { minHeight: 92 },
  repostIdentity: {
    alignSelf: 'flex-start', maxWidth: '100%', minHeight: 32, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(8,8,10,0.78)', borderRadius: 7,
    paddingHorizontal: 7, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  repostAvatarStack: { minWidth: 22, height: 22, flexDirection: 'row', alignItems: 'center' },
  repostAvatar: {
    width: 22, height: 22, borderRadius: RADII.pill, overflow: 'hidden',
    borderWidth: 1.5, borderColor: ON_DARK,
  },
  repostAvatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#35353A' },
  repostAvatarInitials: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.xs },
  repostIdentityText: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: 12, flexShrink: 1 },
  creatorRow: { minHeight: 30, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 7 },
  creatorName: {
    fontSize: FS.base + 3, fontFamily: FONT.bold, color: ON_DARK, flexShrink: 1, letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  caption: {
    fontSize: 14.5, fontFamily: FONT.medium, color: ON_DARK, marginBottom: 8,
    lineHeight: 20.5, letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  moreText: { fontFamily: FONT.bold, color: ON_DARK },
  soundRow: {
    height: 24, flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 9, borderRadius: RADII.pill,
    backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  soundText: { fontSize: FS.xs, fontFamily: FONT.medium, color: `${ON_DARK}D9`, flexShrink: 1 },
});
