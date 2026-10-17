/**
 * Buyer Threads Home feed — bottom-left info block.
 *
 * Repost identity (only when it's true) → name + verified check → 2-line
 * caption with a "more" expand. No sound line: the sound lives on the
 * rail's spinning disc, like TikTok. The caller pins `bottom` to one fixed
 * anchor above the progress line and the block grows upward from it, so it
 * sits in the same place on every post (video or slideshow) and never
 * measures itself to position anything. Tight TikTok rhythm (Mobbin,
 * 390x844): 16/20 name, 4pt, 14/18 caption.
 *
 * `topSlot` (resting-pill redesign): the Shop tag pill (components/
 * buyer-feed/ShopSideTab.tsx's `ShopTagPill`) renders here again — back at
 * the top of this stack, directly above the creator name, left-aligned
 * with it, ~8px gap below — instead of floating as its own screen-edge
 * sibling. Generic (`ReactNode`, not shop-specific) so this block doesn't
 * need to know anything about Shop tags itself; feed.tsx composes the pill
 * and passes it in.
 */
import React from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { useHitAreaBoost } from '@/hooks/useHitAreaBoost';
import { CaptionSpans } from '@/components/social/CaptionText';
import { captionNeedsMore, clampCaption } from './captionClamp';

export interface RepostFriend {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

// Starting estimate of this block's height (Shop pill or repost row + name +
// 2 caption lines) for the feed's scrub-time bubble until `onHeightChange`
// reports the real one. Only that drag bubble uses it — nothing about the
// caption's or the rail's position does.
export const CAPTION_BLOCK_HEIGHT_WITH_REPOST = 92;

export function CaptionBlock({
  creator, verified, caption,
  friendReposts, hasRepostIdentity, repostLabel, onOpenRepostIdentity,
  captionExpanded, onToggleCaptionExpanded,
  onOpenCreator,
  style,
  onHeightChange,
  topSlot,
  sponsored,
}: {
  creator: string;
  verified: boolean;
  caption: string;
  friendReposts: RepostFriend[];
  hasRepostIdentity: boolean;
  repostLabel: string;
  onOpenRepostIdentity: () => void;
  captionExpanded: boolean;
  onToggleCaptionExpanded: () => void;
  onOpenCreator: () => void;
  style?: any;
  /** Reports this block's real rendered height — bigger than the
   *  `CAPTION_BLOCK_HEIGHT_WITH_REPOST` estimate whenever a 2-line
   *  caption, a repost row, or just different font metrics push it taller.
   *  Callers that need to keep some other overlay clear of the whole stack
   *  (the feed's scrub-bubble; see ScrubProgressBar in feed.tsx) should use
   *  this measured height, not the nominal constants, to actually guarantee
   *  no overlap. */
  onHeightChange?: (height: number) => void;
  /** Rendered as the first item of this stack, above the creator name, with
   *  an 8px gap below it — see the module comment above. `undefined` when
   *  this post has no tagged product (no leftover gap in that case). */
  topSlot?: React.ReactNode;
  /** Paid promotion (admin-approved boost) served in For You: shows the "Sponsored" label beside the brand name. */
  sponsored?: boolean;
}) {
  const handleLayout = onHeightChange
    ? (e: LayoutChangeEvent) => onHeightChange(e.nativeEvent.layout.height)
    : undefined;
  // Pads each control's real tap area up to 44x44 without changing its
  // visual footprint — see useHitAreaBoost's doc comment. `repostHit`
  // applies to a control with a painted pill background, so its boost lands
  // on an outer, unstyled wrapper around the unchanged visual pill rather
  // than on the pill itself (growing padding on the pill's own style would
  // visibly enlarge the pill).
  const repostHit = useHitAreaBoost();
  // Name and caption use hitSlop, not useHitAreaBoost: the boost measures
  // the row after first layout and then re-lays it out (and centred it),
  // which read as the caption jumping on every new post.
  const needsMore = captionNeedsMore(caption);
  return (
    <Animated.View
      style={[styles.root, style]}
      pointerEvents="box-none"
      onLayout={handleLayout}
      testID="caption-block"
    >
      {!!topSlot && <View style={styles.topSlotWrap}>{topSlot}</View>}
      {hasRepostIdentity && (
        <TouchableOpacity
          style={repostHit.boostStyle}
          onLayout={repostHit.onLayout}
          activeOpacity={friendReposts.length > 0 ? 0.8 : 1}
          disabled={friendReposts.length === 0}
          onPress={onOpenRepostIdentity}
          accessibilityRole={friendReposts.length > 0 ? 'button' : 'text'}
          accessibilityLabel={repostLabel}
        >
          <View style={styles.repostIdentity}>
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
          </View>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.leftAligned}
        hitSlop={{ top: 11, bottom: 6 }}
        activeOpacity={0.8}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenCreator(); }}
        accessibilityRole="button"
        accessibilityLabel={`View ${creator}'s profile`}
      >
        <View style={styles.creatorRow}>
          <Text style={styles.creatorName} numberOfLines={1}>{creator}</Text>
          {/* White, not the usual brand blue — blue nearly disappears
              against bright/light footage (e.g. the Maison Vela demo
              clip's silver dress). The same text shadow as the rest of
              this block keeps it legible on light and dark video alike. */}
          {verified && <Feather name="check-circle" size={14} color={ON_DARK} style={[styles.iconTextShadow, { marginLeft: 4 }]} />}
          {sponsored && <Text style={styles.sponsoredLabel} accessibilityLabel="Sponsored">Sponsored</Text>}
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.leftAligned}
        onPress={() => needsMore && onToggleCaptionExpanded()}
        activeOpacity={needsMore ? 0.7 : 1}
        accessibilityRole={needsMore ? 'button' : 'text'}
        accessibilityLabel={needsMore ? (captionExpanded ? 'Collapse caption' : 'Expand caption') : undefined}
        hitSlop={{ top: 4, bottom: 4 }}
      >
        {/* Collapsed: the text is cut to fit 2 lines *before* rendering so
            "… more" always lands at the end of line 2 instead of being
            clipped away with the overflow. */}
        <Text style={styles.caption} numberOfLines={captionExpanded || !needsMore ? undefined : 2} testID="caption-text">
          <CaptionSpans text={captionExpanded || !needsMore ? caption : clampCaption(caption)} />
          {needsMore && (captionExpanded
            ? <Text style={styles.moreText}>{'  less'}</Text>
            : <Text style={styles.moreText} testID="caption-more">{'… more'}</Text>)}
        </Text>
      </TouchableOpacity>

    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Vertical rhythm: Shop pill -> 8pt -> name row (20pt line) -> 4pt ->
  // caption (18pt lines), then the caller's CAPTION_BOTTOM_GAP to the
  // progress line (app/(tabs)/feed.tsx). No minHeight: the block's bottom is
  // the anchor and it only grows up.
  root: {
    position: 'absolute', left: 12, right: 80, bottom: 26,
    justifyContent: 'flex-end',
  },
  // 8px gap above the creator name (or repost row) below it — see the
  // module comment's `topSlot` note.
  topSlotWrap: { marginBottom: 8 },
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
  creatorRow: { minHeight: 22, marginBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Shared legibility shadow for every text overlay in this block (name,
  // caption, sound) plus the verified badge glyph — strong enough to hold
  // up against a bright/high-key clip (e.g. Maison Vela's silver dress),
  // where the old, lighter shadow washed out to nearly nothing.
  creatorName: {
    fontSize: 16, lineHeight: 20, fontFamily: FONT.semibold, color: ON_DARK, flexShrink: 1, letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  sponsoredLabel: {
    fontSize: 11, fontFamily: FONT.semibold, color: ON_DARK, letterSpacing: 0.2,
    borderWidth: 1, borderColor: ON_DARK, borderRadius: RADII.pill, paddingHorizontal: 7, paddingVertical: 1,
    overflow: 'hidden', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  caption: {
    fontSize: 14, fontFamily: FONT.medium, color: `${ON_DARK}F2`,
    lineHeight: 18, letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  moreText: { fontFamily: FONT.bold, color: ON_DARK },
  leftAligned: { alignSelf: 'stretch', alignItems: 'flex-start' },
  // Same shadow, for icon glyphs (Feather renders as a text font, so
  // textShadow applies) — used by the verified badge above.
  iconTextShadow: {
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
});
