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

export interface RepostFriend {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

// This block's own reserved height (see `root`/`rootWithRepost` below) —
// exported so callers that need to keep some *other* overlay clear of this
// whole stack (not just its own bottom edge) can compute that without
// hand-copying these numbers. See feed.tsx's ScrubProgressBar bubble, which
// used to hardcode its own clearance and drifted out of sync with this
// block, letting the drag-time bubble render behind the sound/mute pill.
export const CAPTION_BLOCK_HEIGHT = 56;
export const CAPTION_BLOCK_HEIGHT_WITH_REPOST = 92;

export function CaptionBlock({
  creator, verified, caption, sound, soundOn, onToggleSound,
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
  /** Reports this block's real rendered height — bigger than the
   *  `CAPTION_BLOCK_HEIGHT`/`_WITH_REPOST` *minimums* whenever a 2-line
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
  // visual footprint — see useHitAreaBoost's doc comment. `soundHit` and
  // `repostHit` apply to controls with a painted pill background, so their
  // boost lands on an outer, unstyled wrapper around the unchanged visual
  // pill rather than on the pill itself (growing padding on the pill's own
  // style would visibly enlarge the pill).
  const repostHit = useHitAreaBoost();
  const creatorHit = useHitAreaBoost();
  const captionHit = useHitAreaBoost();
  const soundHit = useHitAreaBoost();
  return (
    <Animated.View
      style={[styles.root, hasRepostIdentity && styles.rootWithRepost, style]}
      pointerEvents="box-none"
      onLayout={handleLayout}
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
        style={creatorHit.boostStyle}
        onLayout={creatorHit.onLayout}
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
        style={captionHit.boostStyle}
        onLayout={captionHit.onLayout}
        onPress={() => caption.length > 86 && onToggleCaptionExpanded()}
        activeOpacity={caption.length > 86 ? 0.7 : 1}
        accessibilityRole={caption.length > 86 ? 'button' : 'text'}
        accessibilityLabel={caption.length > 86 ? (captionExpanded ? 'Collapse caption' : 'Expand caption') : undefined}
        hitSlop={{ top: 4, bottom: 4 }}
      >
        <Text style={styles.caption} numberOfLines={captionExpanded ? undefined : 2}>
          <CaptionSpans text={caption} />
          {caption.length > 86 && (
            <Text style={styles.moreText}>{captionExpanded ? '  less' : '  more'}</Text>
          )}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={soundHit.boostStyle}
        onLayout={soundHit.onLayout}
        onPress={onToggleSound}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={soundOn ? 'Mute sound' : 'Unmute sound'}
        accessibilityState={{ checked: soundOn }}
      >
        <View style={styles.soundRow}>
          <Feather name="music" size={12} color={`${ON_DARK}E6`} style={styles.iconTextShadow} />
          <Text style={styles.soundText} numberOfLines={1} ellipsizeMode="tail">{sound}</Text>
        </View>
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
    position: 'absolute', left: 16, right: 84, bottom: 26, minHeight: CAPTION_BLOCK_HEIGHT,
    justifyContent: 'flex-end',
  },
  rootWithRepost: { minHeight: CAPTION_BLOCK_HEIGHT_WITH_REPOST },
  // 8px gap above the creator name (or repost row) below it — see the
  // module comment's `topSlot` note.
  topSlotWrap: { marginBottom: 8 },
  repostIdentity: {
    alignSelf: 'flex-start', maxWidth: '100%', minHeight: 32, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(8,8,10,0.78)', borderRadius: 8,
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
  // Shared legibility shadow for every text overlay in this block (name,
  // caption, sound) plus the verified badge glyph — strong enough to hold
  // up against a bright/high-key clip (e.g. Maison Vela's silver dress),
  // where the old, lighter shadow washed out to nearly nothing.
  creatorName: {
    fontSize: 16, fontFamily: FONT.semibold, color: ON_DARK, flexShrink: 1, letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  sponsoredLabel: {
    fontSize: 11, fontFamily: FONT.semibold, color: ON_DARK, letterSpacing: 0.2,
    borderWidth: 1, borderColor: ON_DARK, borderRadius: RADII.pill, paddingHorizontal: 7, paddingVertical: 1,
    overflow: 'hidden', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  caption: {
    fontSize: 14, fontFamily: FONT.medium, color: `${ON_DARK}F2`, marginBottom: 8,
    lineHeight: 19, letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  moreText: { fontFamily: FONT.bold, color: ON_DARK },
  // Same shadow, for icon glyphs (Feather renders as a text font, so
  // textShadow applies) — used by the verified badge above.
  iconTextShadow: {
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  soundRow: {
    height: 24, flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 9, borderRadius: RADII.pill,
    backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  soundText: {
    fontSize: 12, fontFamily: FONT.medium, color: `${ON_DARK}E6`, flexShrink: 1,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
});
