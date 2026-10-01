/**
 * One message in the community group chat — the DM bubble look (avatar on the
 * last bubble of a run, swipe-right to reply, long-press for the reaction
 * overlay) plus what a group needs: sender name + role pills above the first
 * bubble of a run, and tappable reaction-count chips underneath.
 */
import React, { memo, useCallback, useRef } from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { SwipeToReplyBubble } from '@/components/chat/SwipeToReplyBubble';
import { ReactionGlyph } from '@/components/chat/ReactionBar';
import type { ReactionOverlayAnchor } from '@/components/chat/ReactionOverlay';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { EMOJI_FONT_STACK } from '@/lib/appleEmoji';
import { DEFAULT_AVATAR_COLOR } from '@/lib/avatarColors';
import { formatTime, groupCornerRadii } from '@/lib/chatGrouping';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { COMMUNITY_REACTIONS } from '@/lib/communities/types';
import { reactionChips, type DisplayMessage } from '@/lib/communities/chatMerge';
import type { ReactionType } from '@/services/socialTypes';

const AVATAR_SIZE = 28;
const AVATAR_GAP = SP.sm;
const BUBBLE_MAX = Dimensions.get('window').width * 0.75;
/** Photo area inside a bubble: bubble max minus its 12pt side padding. */
const MEDIA_MAX = Math.min(BUBBLE_MAX, 280) - 24;
const GRID_GAP = 3;

export interface CommunityMessageRowProps {
  msg: DisplayMessage;
  isOwn: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  myId: string | null;
  onReply: (msg: DisplayMessage) => void;
  onOpenMenu: (msg: DisplayMessage, anchor: ReactionOverlayAnchor | null) => void;
  onToggleReaction: (msg: DisplayMessage, type: string) => void;
  onOpenPhoto: (url: string) => void;
  onRetry: (clientId: string) => void;
  onRemovePending: (clientId: string) => void;
}

/** Bubble surface shared by the row and the reaction overlay's raised clone. */
export function communityBubbleStyle(theme: AppThemePreset, isOwn: boolean) {
  return {
    backgroundColor: isOwn ? theme.accent : theme.cardElevated,
    // The monochrome theme's received bubble is black on black — a hairline keeps its edge.
    borderWidth: isOwn ? 0 : StyleSheet.hairlineWidth,
    borderColor: theme.border,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 12,
    paddingVertical: SP.sm,
  } as const;
}

export function communityBubbleTextStyle(theme: AppThemePreset, isOwn: boolean) {
  return { color: isOwn ? theme.onAccent : theme.text };
}

function CommunityMessageRowImpl({
  msg, isOwn, isFirstInGroup, isLastInGroup, myId,
  onReply, onOpenMenu, onToggleReaction, onOpenPhoto, onRetry, onRemovePending,
}: CommunityMessageRowProps) {
  const { theme } = useAppTheme();
  const s = getStyles(theme);
  const bubbleRef = useRef<View>(null);
  const pending = msg.pendingStatus;
  const chips = reactionChips(msg.reactions, myId, COMMUNITY_REACTIONS);
  const photos = msg.attachments.filter((a) => a.type === 'image');
  const textColor = isOwn ? theme.onAccent : theme.text;
  const subColor = isOwn ? `${theme.onAccent}B0` : theme.muted;

  const openMenu = useCallback(() => {
    if (pending) return;
    const node = bubbleRef.current;
    if (!node) { onOpenMenu(msg, null); return; }
    node.measureInWindow((x, y, width, height) => onOpenMenu(msg, { x, y, width, height }));
  }, [msg, onOpenMenu, pending]);

  const isSeller = msg.fromAccountType === 'seller';
  const roleLabel = msg.fromMemberRole === 'owner' ? 'Owner' : msg.fromMemberRole === 'admin' ? 'Admin' : null;

  return (
    <View style={[s.outer, { justifyContent: isOwn ? 'flex-end' : 'flex-start', marginTop: isFirstInGroup ? 12 : 2 }]}>
      {!isOwn && (
        isLastInGroup ? (
          msg.fromAvatarUrl ? (
            <CachedImage source={{ uri: msg.fromAvatarUrl }} style={s.avatar} recyclingKey={msg.fromId} accessibilityLabel={`${msg.fromName}'s avatar`} />
          ) : (
            <View style={[s.avatar, s.avatarFallback, { backgroundColor: msg.fromColor || DEFAULT_AVATAR_COLOR }]} accessibilityLabel={`${msg.fromName}'s avatar`}>
              <Text style={s.avatarInitials}>{msg.fromInitials}</Text>
            </View>
          )
        ) : <View style={s.avatarSpacer} />
      )}

      <View style={[s.column, { alignItems: isOwn ? 'flex-end' : 'flex-start' }]}>
        {!isOwn && isFirstInGroup && (
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1}>{msg.fromName}</Text>
            {roleLabel && (
              <View style={[s.pill, s.pillRole]}><Text style={[s.pillText, { color: theme.text }]}>{roleLabel}</Text></View>
            )}
            {isSeller && (
              <View style={s.pill}><Text style={s.pillText}>Seller</Text></View>
            )}
          </View>
        )}

        <View ref={bubbleRef} collapsable={false}>
          <SwipeToReplyBubble
            testID={`community-bubble-swipe-${msg.id}`}
            disabled={!!pending}
            iconColor={theme.muted}
            iconBg={theme.cardElevated}
            onReply={() => onReply(msg)}
          >
            <PressableScale
              rippleEnabled={false}
              bounce={false}
              noMinHeight
              activeOpacity={0.9}
              testID={`community-bubble-${msg.id}`}
              onLongPress={openMenu}
              delayLongPress={280}
              accessibilityRole={photos.length ? 'none' : 'button'}
              accessibilityLabel={isOwn ? 'Your message' : `Message from ${msg.fromName}`}
              accessibilityHint="Touch and hold for more actions, or swipe right to reply"
              style={[
                communityBubbleStyle(theme, isOwn),
                groupCornerRadii(isOwn, isFirstInGroup, isLastInGroup, RADIUS.lg),
                pending === 'sending' && { opacity: 0.7 },
              ]}
            >
              {msg.replyToId ? (
                <View style={[s.quote, { borderLeftColor: isOwn ? theme.onAccent : theme.muted }]} {...({ dataSet: { fit: 'preview' } } as object)}>
                  {msg.replyToAuthorName ? (
                    <Text style={[s.quoteName, { color: isOwn ? theme.onAccent : theme.text }]} numberOfLines={1}>{msg.replyToAuthorName}</Text>
                  ) : null}
                  <Text style={[s.quoteText, { color: subColor }]} numberOfLines={1}>{msg.replyPreview ?? 'Message'}</Text>
                </View>
              ) : null}

              {photos.length > 0 && (
                <PhotoGrid
                  urls={photos.map((p) => p.url)}
                  sizes={photos.length === 1 ? { w: photos[0].width, h: photos[0].height } : undefined}
                  onOpen={onOpenPhoto}
                  onLongPress={openMenu}
                  hasText={!!msg.text}
                  bg={isOwn ? theme.accentDim : theme.card}
                />
              )}

              {msg.text ? <Text style={[s.text, { color: textColor }]}>{msg.text}</Text> : null}

              {(isLastInGroup || pending) && (
                <View style={s.meta}>
                  <Text style={[s.time, { color: subColor }]}>{formatTime(msg.ts)}</Text>
                  {pending === 'sending' && <Feather name="clock" size={11} color={subColor} />}
                </View>
              )}
            </PressableScale>
          </SwipeToReplyBubble>
        </View>

        {pending === 'failed' && (
          <View style={s.failedRow}>
            <PressableScale
              rippleEnabled={false}
              noMinHeight
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              onPress={() => msg.clientId && onRetry(msg.clientId)}
              style={s.failedAction}
              accessibilityRole="button"
              accessibilityLabel="Retry sending"
              testID={`community-retry-${msg.clientId}`}
            >
              <Feather name="alert-circle" size={12} color={theme.error} />
              <Text style={[s.failedText, { color: theme.error }]}>Couldn’t send. Tap to retry</Text>
            </PressableScale>
            <PressableScale
              rippleEnabled={false}
              noMinHeight
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={() => msg.clientId && onRemovePending(msg.clientId)}
              accessibilityRole="button"
              accessibilityLabel="Discard message"
              testID={`community-discard-${msg.clientId}`}
            >
              <Text style={[s.failedText, { color: theme.muted }]}>Discard</Text>
            </PressableScale>
          </View>
        )}

        {chips.length > 0 && (
          <View style={s.reactionsRow}>
            {chips.map((c) => (
              <PressableScale
                key={c.type}
                rippleEnabled={false}
                bounce={false}
                noMinHeight
                style={[
                  s.chip,
                  { backgroundColor: c.mine ? theme.accentDim : theme.card, borderColor: c.mine ? theme.accent : theme.border },
                ]}
                onPress={() => onToggleReaction(msg, c.type)}
                onLongPress={openMenu}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${c.type} reaction, ${c.count}${c.mine ? ', you reacted' : ''}`}
                testID={`community-reaction-chip-${msg.id}-${c.type}`}
              >
                <ReactionGlyph type={c.type as ReactionType} size={12} />
                <Text style={[s.chipCount, { color: c.mine ? theme.text : theme.muted }]}>{c.count}</Text>
              </PressableScale>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function PhotoGrid({
  urls, sizes, onOpen, onLongPress, hasText, bg,
}: {
  urls: string[];
  sizes?: { w?: number; h?: number };
  onOpen: (url: string) => void;
  onLongPress: () => void;
  hasText: boolean;
  bg: string;
}) {
  const single = urls.length === 1;
  const cell = (MEDIA_MAX - GRID_GAP) / 2;
  // A single photo keeps its own aspect ratio (clamped so it never gets tall or sliver-thin).
  const ratio = sizes?.w && sizes?.h ? Math.min(Math.max(sizes.w / sizes.h, 0.75), 1.6) : 1;
  return (
    <View style={[{ width: MEDIA_MAX, flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }, hasText && { marginBottom: SP.sm - 2 }]}>
      {urls.map((url, i) => (
        <PressableScale
          key={`${url}-${i}`}
          rippleEnabled={false}
          bounce={false}
          noMinHeight
          activeOpacity={0.85}
          onPress={() => onOpen(url)}
          onLongPress={onLongPress}
          delayLongPress={280}
          accessibilityRole="imagebutton"
          accessibilityLabel="Open photo"
          testID="community-photo"
          style={{
            width: single ? MEDIA_MAX : cell,
            height: single ? MEDIA_MAX / ratio : cell,
            borderRadius: RADIUS.md - 2,
            overflow: 'hidden',
            backgroundColor: bg,
          }}
        >
          <CachedImage source={{ uri: url }} style={StyleSheet.absoluteFill} recyclingKey={url} />
        </PressableScale>
      ))}
    </View>
  );
}

export const CommunityMessageRow = memo(CommunityMessageRowImpl);

// Styles are shared by every row, so build them once per theme object.
const styleCache = new WeakMap<AppThemePreset, ReturnType<typeof makeStyles>>();
function getStyles(theme: AppThemePreset) {
  let cached = styleCache.get(theme);
  if (!cached) { cached = makeStyles(theme); styleCache.set(theme, cached); }
  return cached;
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  outer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: SP.md, marginBottom: 3 },
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, marginRight: AVATAR_GAP, marginBottom: 2 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarSpacer: { width: AVATAR_SIZE, marginRight: AVATAR_GAP },
  avatarInitials: { fontSize: 11, fontFamily: FONT.bold, color: theme.text },
  column: { maxWidth: BUBBLE_MAX, flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, marginLeft: 4, maxWidth: BUBBLE_MAX },
  name: { flexShrink: 1, fontSize: FS.meta, fontFamily: FONT.semibold, color: theme.muted },
  pill: {
    paddingHorizontal: 12, paddingVertical: 1, borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  pillRole: { backgroundColor: theme.accentDim },
  pillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.muted },
  quote: { borderLeftWidth: 2, paddingLeft: 8, marginBottom: 6, maxWidth: BUBBLE_MAX - 24, overflow: 'hidden' },
  quoteName: { fontSize: FS.xs, fontFamily: FONT.semibold },
  quoteText: { fontSize: FS.xs, fontFamily: FONT.regular },
  text: {
    fontSize: 15, fontFamily: FONT.regular, lineHeight: 21,
    ...(Platform.OS === 'web' ? { fontFamily: `${FONT.regular}, ${EMOJI_FONT_STACK}` } : null),
  },
  meta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 4, gap: 4 },
  time: { fontSize: 10, fontFamily: FONT.regular },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: 6, alignSelf: 'flex-end' },
  failedAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  failedText: { fontSize: FS.xs, fontFamily: FONT.regular },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs, marginTop: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 3,
  },
  chipCount: { fontSize: FS.xs, fontFamily: FONT.semibold },
});
