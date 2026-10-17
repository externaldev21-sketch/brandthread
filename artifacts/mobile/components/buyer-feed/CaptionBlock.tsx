import * as Haptics from 'expo-haptics';
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
import { Animated, LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';

import { Feather } from '@expo/vector-icons';

import { Icon } from '@/components/ui/Icon';

import { CachedImage } from '@/components/CachedImage';

import { FONT, FS, ON_DARK } from '@/lib/theme';

import { RADII } from '@/constants/radii';

import { TranslationLink, useCaptionTranslation } from '@/components/translation/CaptionTranslation';

import { useHitAreaBoost } from '@/hooks/useHitAreaBoost';

import { CaptionSpans } from '@/components/social/CaptionText';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';

import { crispPx } from '@/lib/crispPixel';

import { SoundMarquee } from '@/components/buyer-feed/SoundMarquee';
import type { PostProductMention } from '@/lib/captionMentions';

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
// Captions show 2 lines; longer ones get "more"/"less" (TikTok, Mobbin watch-1/2).
// ~43 characters fill one line of this block on a 390pt phone.
import { CAPTION_LINES, captionNeedsMore } from './captionLayout';
export { captionNeedsMore } from './captionLayout';
export const CAPTION_BLOCK_HEIGHT_WITH_REPOST = 92;

/**
 * Two-line caption with an explicit, always-visible "… more" control.
 * A hidden copy of the full caption is laid out at the real width and
 * font scale (onTextLayout); when it needs more than 2 lines, line 1 and
 * the rest are drawn separately — the rest truncated to one line beside a
 * separate "more" button, so truncation can never clip the control. The
 * caption text itself is not a touch target (product links stay tappable).
 * Before the first layout, a character heuristic decides overflow.
 */
export function CollapsibleCaption({ text, productMentions, onProductMention, expanded, onToggle, onLayout }: {
  text: string;
  productMentions?: PostProductMention[];
  onProductMention?: (mention: PostProductMention) => void;
  expanded: boolean;
  onToggle: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const [lines, setLines] = React.useState<string[] | null>(null);
  React.useEffect(() => { setLines(null); }, [text]);
  const overflow = lines ? lines.length > CAPTION_LINES : captionNeedsMore(text);
  const first = lines && lines.length > CAPTION_LINES ? lines[0] : null;
  const rest = first != null ? text.slice(first.length) : null;
  const spans = (t: string) => <CaptionSpans text={t} productMentions={productMentions} onProductMention={onProductMention} />;
  const toggle = (label: string) => (
    <Text onPress={onToggle} style={styles.moreText} suppressHighlighting accessibilityRole="button"
      accessibilityLabel={expanded ? 'Collapse caption' : 'Expand caption'} testID="caption-more">{label}</Text>
  );
  return (
    <View style={styles.captionWrap} testID="caption-text" onLayout={onLayout}>
      <View style={styles.captionMeasure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.caption} onTextLayout={(e) => setLines(e.nativeEvent.lines.map(l => l.text))}
          testID="caption-measure">{text}</Text>
      </View>
      {!overflow ? (
        <Text style={styles.caption}>{spans(text)}</Text>
      ) : expanded ? (
        <Text style={styles.caption}>{spans(text)} {toggle('less')}</Text>
      ) : first != null && rest != null ? (
        <>
          <Text style={[styles.caption, styles.captionLine]} numberOfLines={1}>{spans(first)}</Text>
          <View style={styles.captionLastRow}>
            <Text style={[styles.caption, styles.captionLine, styles.captionRest]} numberOfLines={1} ellipsizeMode="tail">{spans(rest)}</Text>
            {toggle('more')}
          </View>
        </>
      ) : (
        <View style={styles.captionLastRow}>
          <Text style={[styles.caption, styles.captionLine, styles.captionRest]} numberOfLines={CAPTION_LINES} ellipsizeMode="tail">{spans(text)}</Text>
          {toggle('more')}
        </View>
      )}
    </View>
  );
}

export function CaptionBlock({
  creator, verified, caption, sound, soundOn, onToggleSound, remixCredit,
  friendReposts, selfRepost, hasRepostIdentity, repostLabel, onOpenRepostIdentity,
  captionExpanded, onToggleCaptionExpanded,
  onOpenCreator,
  onPressInCreator,
  style,
  onHeightChange,
  onCaptionBottomOffsetChange,
  topSlot,
  belowCaptionSlot,
  sponsored,
  soundActive = false,
  reduceMotion = false,
  postLabel,
  productMentions,
  onProductMention,
  official,
  credit,
  location,
}: {
  /** Tagged place, shown as a pill above the creator name (Mobbin watch-1/2). */
  location?: string;
  creator: string;
  verified: boolean;
  caption: string;
  sound: string;
  soundOn: boolean;
  /** "Remix of @handle" — credits the original video under the creator name. */
  remixCredit?: string | null;
  onToggleSound: () => void;
  friendReposts: RepostFriend[];
  /** The viewer's own identity is safe; other avatars remain friend-authorized. */
  selfRepost?: { avatarUri?: string; name?: string };
  hasRepostIdentity: boolean;
  repostLabel: string;
  onOpenRepostIdentity: () => void;
  captionExpanded: boolean;
  onToggleCaptionExpanded: () => void;
  onOpenCreator: () => void;
  style?: StyleProp<ViewStyle>;
  /** Press-in on the creator name: warm the profile it opens. */
  onPressInCreator?: () => void;
  /** Reports this block's real rendered height — bigger than the
   *  `CAPTION_BLOCK_HEIGHT`/`_WITH_REPOST` *minimums* whenever a 3-line
   *  caption, a repost row, or just different font metrics push it taller.
   *  Callers that need to keep some other overlay clear of the whole stack
   *  (the feed's scrub-bubble; see ScrubProgressBar in feed.tsx) should use
   *  this measured height, not the nominal constants, to actually guarantee
   *  no overlap. */
  onHeightChange?: (height: number) => void;
  /** Measured distance from the caption text's last line to this block's bottom. */
  onCaptionBottomOffsetChange?: (offset: number) => void;
  /** Rendered as the first item of this stack, above the creator name, with
   *  an 8px gap below it — see the module comment above. `undefined` when
   *  this post has no tagged product (no leftover gap in that case). */
  topSlot?: React.ReactNode;
  /** Rendered right under the caption (a Thread's poll, components/social/PollCard). */
  belowCaptionSlot?: React.ReactNode;
  /** Paid promotion (admin-approved boost) served in For You: shows the "Sponsored" label beside the brand name. */
  sponsored?: boolean;
  /** This page is the one playing: a sound label too long to fit scrolls. */
  soundActive?: boolean;
  reduceMotion?: boolean;
  /** Seller label shown on its own line between the name and the caption (e.g. "Behind the scenes"). */
  postLabel?: string;
  /** Caption labels linked to products; tapping one calls `onProductMention`. */
  productMentions?: PostProductMention[];
  onProductMention?: (mention: PostProductMention) => void;
  /** The official @brandthread account: shows the "Official" badge beside the name. */
  official?: boolean;
  /** Creator credit line under the caption ("Video: @handle"); tappable when `onPress` is set. */
  credit?: { label: string; onPress?: () => void };
}) {
  const [blockWidth, setBlockWidth] = React.useState(0);
  const [blockHeight, setBlockHeight] = React.useState(0);
  const [captionLayout, setCaptionLayout] = React.useState<{ y: number; height: number } | null>(null);
  React.useEffect(() => {
    if (captionLayout && blockHeight > 0) {
      onCaptionBottomOffsetChange?.(Math.max(0, blockHeight - captionLayout.y - captionLayout.height));
    }
  }, [blockHeight, captionLayout, onCaptionBottomOffsetChange]);
  const handleLayout = (e: LayoutChangeEvent) => {
    setBlockWidth(e.nativeEvent.layout.width);
    setBlockHeight(e.nativeEvent.layout.height);
    onHeightChange?.(e.nativeEvent.layout.height);
  };
  // Pads each control's real tap area up to 44x44 without changing its
  // visual footprint — see useHitAreaBoost's doc comment. `soundHit` and
  // `repostHit` apply to controls with a painted pill background, so their
  // boost lands on an outer, unstyled wrapper around the unchanged visual
  // pill rather than on the pill itself (growing padding on the pill's own
  // style would visibly enlarge the pill).
  const repostHit = useHitAreaBoost();
  const creatorHit = useHitAreaBoost();
  const soundHit = useHitAreaBoost();
  const translation = useCaptionTranslation(caption);
  const repostPeople: RepostFriend[] = selfRepost
    ? [{ userId: 'viewer', displayName: selfRepost.name ?? 'You', avatarUrl: selfRepost.avatarUri }, ...friendReposts]
    : friendReposts;
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
              {repostPeople.slice(0, 3).map((friend, index) => (
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
              {repostPeople.length === 0 && (
                <View style={[styles.repostAvatar, styles.repostAvatarFallback]}>
                  <Icon name="repeat" size={12} color={ON_DARK} />
                </View>
              )}
            </View>
            <Text style={styles.repostIdentityText} numberOfLines={1}>{repostLabel}</Text>
          </View>
        </TouchableOpacity>
      )}

      {!!location && (
        <View style={styles.locationPill} testID="caption-location" accessibilityLabel={`Location: ${location}`}>
          <Icon name="map-pin" size={12} color={ON_DARK} />
          <Text style={styles.locationText} numberOfLines={1}>{location}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[creatorHit.boostStyle, styles.leftAligned]}
        onLayout={creatorHit.onLayout}
        activeOpacity={0.8}
        onPress={() => {  onOpenCreator(); }}
        onPressIn={onPressInCreator}
        accessibilityRole="button"
        accessibilityLabel={`View ${creator}'s profile`}
      >
        <View style={styles.creatorRow}>
          <Text style={styles.creatorName} numberOfLines={1}>{creator}</Text>
          {/* White, not the usual brand blue — blue nearly disappears
              against bright/light footage (e.g. the Maison Vela demo
              clip's silver dress). The same text shadow as the rest of
              this block keeps it legible on light and dark video alike. */}
          {verified && <VerifiedBadge onMedia style={[styles.iconTextShadow, { marginLeft: 4 }]} />}
          {official && <Text style={styles.sponsoredLabel} accessibilityLabel="Official Brandthread account" testID="caption-official-badge">Official</Text>}
          {sponsored && <Text style={styles.sponsoredLabel} accessibilityLabel="Sponsored">Sponsored</Text>}
        </View>
      </TouchableOpacity>
      {remixCredit ? (
        <View style={styles.remixRow}>
          <Icon name="layers" size={12} color={ON_DARK} style={styles.iconTextShadow} />
          <Text style={styles.soundText} numberOfLines={1}>{remixCredit}</Text>
        </View>
      ) : null}

      {!!postLabel && (
        <Text style={styles.postLabel} numberOfLines={1} testID="post-label">{postLabel}</Text>
      )}

      <CollapsibleCaption
        text={translation.text}
        productMentions={translation.text === caption ? productMentions : []}
        onProductMention={onProductMention}
        expanded={captionExpanded}
        onToggle={onToggleCaptionExpanded}
        onLayout={e => {
          const { y, height } = e.nativeEvent.layout;
          setCaptionLayout(old => old?.y === y && old.height === height ? old : { y, height });
        }}
      />

      <TranslationLink translation={translation} style={styles.translationLink} />
      {!!belowCaptionSlot && <View style={styles.belowCaptionWrap}>{belowCaptionSlot}</View>}
      {credit ? (
        <TouchableOpacity
          onPress={credit.onPress}
          disabled={!credit.onPress}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6 }}
          accessibilityRole={credit.onPress ? 'link' : 'text'}
          accessibilityLabel={credit.onPress ? `${credit.label}. Opens their profile` : credit.label}
          testID="caption-credit"
        >
          <Text style={[styles.credit, credit.onPress && styles.creditLink]} numberOfLines={1}>{credit.label}</Text>
        </TouchableOpacity>
      ) : null}

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
          <Icon name="music" size={12} color={`${ON_DARK}E6`} style={styles.iconTextShadow} />
          <SoundMarquee
            text={sound}
            active={soundActive}
            reduceMotion={reduceMotion}
            textStyle={styles.soundText}
            // Pill padding (9 + 9), the note glyph (12) and its gap (6).
            maxWidth={Math.max(0, blockWidth - 36)}
          />
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
  //
  // maxWidth 75% (less-AI pass, V3): the stack never runs under the right
  // action rail, whatever the screen width.
  root: {
    position: 'absolute', left: 16, right: 84, maxWidth: '75%', bottom: 26, minHeight: CAPTION_BLOCK_HEIGHT,
    justifyContent: 'flex-end',
  },
  // useHitAreaBoost centers a boosted control's content (alignItems:
  // 'center'); on the full-width name/caption rows that pulled the creator
  // name and a short caption to the middle of the stack on web. These rows
  // must stay left-aligned like the rest of the stack.
  leftAligned: { alignItems: 'stretch' },
  rootWithRepost: { minHeight: CAPTION_BLOCK_HEIGHT_WITH_REPOST },
  // 8px gap above the creator name (or repost row) below it — see the
  // module comment's `topSlot` note.
  topSlotWrap: { marginBottom: 8 },
  belowCaptionWrap: { marginBottom: 10 },
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
    borderWidth: crispPx(1.5), borderColor: ON_DARK,
  },
  repostAvatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#35353A' },
  repostAvatarInitials: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.xs },
  repostIdentityText: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: 12, flexShrink: 1 },
  // alignSelf: 'stretch' — useHitAreaBoost centres its child when it pads a
  // short tap target, which centred the name and let a long one spill past
  // both screen edges; stretching keeps it left-aligned and ellipsized.
  creatorRow: { alignSelf: 'stretch', minHeight: 30, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 7 },
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
  // Text-only label line (TikTok's "Paid partnership" pattern): same colour and
  // shadow as the caption, smaller, semibold.
  postLabel: {
    fontSize: 12, fontFamily: FONT.semibold, color: `${ON_DARK}E6`, marginTop: -2, marginBottom: 4, letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  caption: {
    fontSize: 15, fontFamily: FONT.medium, color: `${ON_DARK}F2`, marginBottom: 0,
    lineHeight: 19, letterSpacing: 0.1,
    // ~38 characters a line at 14pt — a comfortable reading measure.
    maxWidth: 280,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  moreText: { fontFamily: FONT.bold, fontSize: 15, lineHeight: 19, color: ON_DARK, marginLeft: 4,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  captionWrap: { alignSelf: 'stretch', maxWidth: 280, marginBottom: 8 },
  captionMeasure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0, marginBottom: 0 },
  captionLine: { marginBottom: 0 },
  captionLastRow: { flexDirection: 'row', alignItems: 'flex-end' },
  captionRest: { flexShrink: 1 },
  translationLink: {
    alignSelf: 'flex-start', marginTop: -4, marginBottom: 8, color: ON_DARK,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  credit: {
    fontSize: 12.5, fontFamily: FONT.medium, color: `${ON_DARK}CC`, marginTop: -2, marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  creditLink: { fontFamily: FONT.semibold, color: ON_DARK },
  // Same shadow, for icon glyphs (Feather renders as a text font, so
  // textShadow applies) — used by the verified badge above.
  iconTextShadow: {
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  locationPill: {
    alignSelf: 'flex-start', maxWidth: '100%', height: 26, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, borderRadius: RADII.chip, backgroundColor: 'rgba(0,0,0,0.35)',
  },
  locationText: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: 12, flexShrink: 1 },
  remixRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: -2, marginBottom: 6 },
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
