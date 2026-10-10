/**
 * Buyer 1:1 chat thread. The screen itself lives in
 * components/chat/ConversationThread.tsx, shared with the seller side
 * (app/seller-conversation.tsx) so both sides of a DM look and behave the
 * same; this route renders it unchanged as the buyer variant.
 */
import React from 'react';

import { ConversationThread } from '@/components/chat/ConversationThread';

export default function BuyerConversationScreen() {
  return <ConversationThread variant="buyer" />;
}
<<<<<<< HEAD
=======

// ─── Presence line ────────────────────────────────────────────────────────────

function statusLineFor(participant: ConversationParticipant | null): string | null {
  if (!participant) return null;
  if (participant.isOnline) return 'online';
  if (participant.lastSeenAt) {
    const ts = new Date(participant.lastSeenAt).getTime();
    if (!Number.isNaN(ts)) return `last seen ${timeAgo(ts)} ago`;
  }
  return null;
}

// ─── Double-tap heart burst ───────────────────────────────────────────────────

function LikeBurst({ x, y, color, onDone }: { x: number; y: number; color: string; onDone: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 650, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onDone();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scale = progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.3, 1] });
  const opacity = progress.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -30] });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={{ position: 'absolute', left: x - 24, top: y - 24, opacity, transform: [{ scale }, { translateY }] }}>
        <Feather name="heart" size={48} color={color} />
      </Animated.View>
    </View>
  );
}

// ─── Request-mode bottom panel ─────────────────────────────────────────────────
// Replaces the composer while `conv.isRequest` is true (see isRequestMode in
// the screen above). Instagram reference: mobbin.com/screens/db4e29c8-e47e-
// 47ce-8f01-b7a98376c6e7 (Instagram chat) — a sheet-style panel that sits
// above the home indicator with the explainer copy and a three-way row
// (Block / Delete / Accept), Accept as the sole filled/primary action.
function RequestActionPanel({
  name, bottomInset, loading, onAccept, onDelete, onBlock,
}: {
  name: string;
  bottomInset: number;
  loading: boolean;
  onAccept: () => void;
  onDelete: () => void;
  onBlock: () => void;
}) {
  const { theme } = useAppTheme();
  const rs = requestPanelStyles;
  return (
    <View
      style={[rs.wrap, { borderTopColor: theme.border, backgroundColor: theme.surface, paddingBottom: Math.max(bottomInset, SP.md) }]}
      testID="conversation-request-panel"
    >
      <Text style={[rs.title, { color: theme.text }]}>{name} wants to send you a message</Text>
      <Text style={[rs.subline, { color: theme.muted }]}>
        Accepting lets them see when you’ve read their messages and message you freely.
      </Text>
      <View style={rs.actionsRow}>
        <PressableScale
          rippleEnabled={false}
          style={rs.actionBtn}
          onPress={onBlock}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Block ${name}`}
          testID="conversation-request-block"
        >
          <Text style={[rs.actionText, { color: theme.error }]}>Block</Text>
        </PressableScale>
        <PressableScale
          rippleEnabled={false}
          style={rs.actionBtn}
          onPress={onDelete}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Delete request from ${name}`}
          testID="conversation-request-delete"
        >
          <Text style={[rs.actionText, { color: theme.text }]}>Delete</Text>
        </PressableScale>
        <PressableScale
          rippleEnabled={false}
          style={[rs.actionBtn, rs.acceptBtn, { backgroundColor: theme.accent }]}
          onPress={onAccept}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Accept message request from ${name}`}
          testID="conversation-request-accept"
        >
          {loading ? (
            <ActivityIndicator color={theme.onAccent} size="small" />
          ) : (
            <Text style={[rs.actionText, rs.acceptText, { color: theme.onAccent }]}>Accept</Text>
          )}
        </PressableScale>
      </View>
    </View>
  );
}

const requestPanelStyles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    gap: SP.xs,
  },
  title: { fontFamily: FONT.semibold, fontSize: FS.sm, textAlign: 'center' },
  subline: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 16, textAlign: 'center', marginBottom: SP.sm },
  actionsRow: { flexDirection: 'row', gap: SP.sm },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {},
  actionText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  acceptText: {},
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },

  // Floating glass header
  headerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    // Left group (back + avatar + name) stays left; the icon group is
    // pushed to the far right edge — not centered/adjacent to the name.
    // Mobbin: Instagram DM header
    // (mobbin.com/screens/db4e29c8-e47e-47ce-8f01-b7a98376c6e7) — the icon
    // group is hard-right-aligned to the edge, evenly spaced, 16pt inset
    // from the screen edge (paddingRight is set inline: SP.md + insets.right).
    justifyContent: 'space-between',
    backgroundColor: theme.background,
    paddingLeft: SP.xs,
    paddingBottom: SP.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
    zIndex: 5,
  },
  // flex: 1 + minWidth: 0 all the way down this chain (leftGroup -> center
  // -> textCol -> nameRow -> name) is what actually lets a long name
  // truncate instead of overlapping the call/video/options icons —
  // flexShrink alone isn't enough on React Native Web, where a flex item's
  // default min-width is its own content width ("auto"), not 0, so it never
  // shrinks below that. Same overlap app/seller-conversation.tsx's header
  // had (confirmed live there for a long name against 3 icons + overflow),
  // fixed the same way here for parity.
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: SP.sm,
  },
  headerIconGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  roundBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The actual flex/minWidth constraint has to live on headerCenterWrap (a
  // plain View) — see the JSX's own comment on why it can't live on
  // headerCenter, which is a PressableScale.
  headerCenterWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  headerTextCol: {
    // No alignItems here (default stretch): headerNameRow needs to actually
    // stretch to this column's now-bounded width (flex: 1 below) for
    // headerName's numberOfLines/flexShrink truncation to engage at all —
    // 'center' left this column sized to its own unconstrained content, so
    // it never got narrower than the name itself regardless of the row's
    // available space.
    flex: 1,
    minWidth: 0,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  headerName: {
    fontSize: 16,
    fontFamily: FONT.semibold,
    color: theme.text,
    letterSpacing: -0.2,
    flexShrink: 1,
    minWidth: 0,
  },
  headerAiBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerAiTag: {
    borderRadius: RADIUS.xs,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 4,
  },
  headerAiTagText: {
    fontSize: 11,
    fontFamily: FONT.bold,
  },
  headerStatusLine: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: theme.success,
    marginTop: 1,
  },
  headerAvatarWrap: { position: 'relative' },
  headerAvatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarOfficial: { borderWidth: 1 },
  headerAvatarInitials: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },
  // Request-mode profile header (avatar / name / @handle / "View profile")
  requestProfileHeader: {
    alignItems: 'center',
    paddingVertical: SP.lg,
    paddingHorizontal: SP.lg,
    gap: 4,
  },
  requestProfileAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: SP.sm,
  },
  requestProfileAvatarImage: { width: 88, height: 88 },
  requestProfileAvatarInitials: { fontSize: FS.xl, fontFamily: FONT.bold, color: '#FFFFFF' },
  requestProfileName: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text },
  requestProfileHandle: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginBottom: SP.sm },
  requestProfilePill: {
    height: 34,
    paddingHorizontal: SP.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestProfilePillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text },
  headerAvatarOnlineDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: theme.success,
    borderWidth: 2,
    borderColor: theme.background,
  },

  // Order context card
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
    padding: SP.sm,
    backgroundColor: theme.cardGlass,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
  },
  orderCardNumber: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  orderCardProduct: {
    fontSize: FS.meta,
    fontFamily: FONT.medium,
    color: theme.muted,
    marginTop: 2,
  },
  orderStatusBadge: {
    backgroundColor: theme.accentDim,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  orderStatusText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: theme.accent,
  },

  // Disabled banner
  disabledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: `${theme.warning}1F`,
    borderBottomWidth: 1,
    borderBottomColor: `${theme.warning}4D`,
  },
  disabledBannerText: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.warning,
    marginLeft: SP.sm,
  },

  // Messages
  listContent: {
    paddingVertical: SP.sm,
    paddingBottom: SP.md,
  },

  // Date separator — plain small gray centered text, no pill (IG-style).
  dateSeparatorWrap: {
    alignItems: 'center',
    marginVertical: SP.lg,
  },
  dateSeparatorText: {
    fontSize: 12,
    fontFamily: FONT.medium,
    color: theme.muted,
  },

  // Unread divider
  unreadDividerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginVertical: SP.md,
    paddingHorizontal: SP.lg,
  },
  unreadDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.error,
    opacity: 0.4,
  },
  unreadDividerText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: theme.error,
  },

  // Message row
  msgOuter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SP.md,
    marginBottom: 3,
  },
  msgAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: AVATAR_GAP,
    marginBottom: 2,
  },
  msgAvatarOfficial: { borderWidth: 1 },
  msgAvatarSpacer: {
    width: AVATAR_SIZE,
    marginRight: AVATAR_GAP,
  },
  msgAvatarInitials: {
    fontSize: 11,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },

  // Bubble — 12x8pt padding, 18pt corner radius (Mobbin iMessage/Luma refs).
  bubble: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: 12,
    paddingVertical: SP.sm,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
    gap: 3,
  },
  bubbleTime: {
    fontSize: 11,
    fontFamily: FONT.regular,
  },
  receiptIcon: {
    marginLeft: 2,
  },
  receiptChecks: {
    flexDirection: 'row',
    marginLeft: 2,
  },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  retryText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },

  // Attachment
  attachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 240,
    backgroundColor: theme.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
    padding: SP.sm,
    marginBottom: SP.xs,
  },
  // Product/order chat cards (item 70/71) moved to the standalone
  // ChatAttachmentCard component (components/chat/ChatAttachmentCard.tsx) —
  // no bubble, no border, own the tap target. See renderItem's product/
  // order branch.
  storyReplyCard: {
    alignItems: 'center',
    marginBottom: SP.xs,
  },
  storyReplyThumb: {
    width: 72,
    height: 108,
    borderRadius: RADIUS.md,
    backgroundColor: theme.cardElevated,
    overflow: 'hidden',
  },
  storyReplyLabel: {
    marginTop: 4,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
  },
  // A standalone agent info/deep-link card — full width, coin/icon-in-a-
  // circle, bold title, subtitle, chevron. Same row shape as the Thread Cash
  // payment card below.
  agentCardOuter: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth,
    padding: SP.sm, width: '100%', maxWidth: BUBBLE_MAX, alignSelf: 'flex-start',
  },
  agentCardIconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  // Quick replies: standalone chips below the last bubble, on the same
  // left edge as every incoming bubble/card — never inside a bubble.
  quickReplyOuterRow: {
    paddingLeft: BUBBLE_COLUMN_LEFT,
  },
  quickReplyScrollContent: {
    flexDirection: 'row',
    paddingRight: SP.md,
  },
  quickReplyChipWrap: {
    marginRight: SP.xs,
  },
  attachTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  attachSubtitle: {
    fontSize: FS.meta,
    fontFamily: FONT.medium,
    color: theme.muted,
    marginTop: 1,
  },
  selectedAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: theme.card,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  selectedAttachmentLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: theme.accent,
  },
  selectedAttachmentTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.text,
    marginTop: 1,
  },

  // Message text — 15pt per spec; emoji font stack biases toward Apple's own
  // emoji glyphs on web instead of the OS-default Noto/Segoe blobs.
  msgText: {
    fontSize: 15,
    fontFamily: FONT.regular,
    lineHeight: 21,
    ...(Platform.OS === 'web' ? { fontFamily: `${FONT.regular}, ${EMOJI_FONT_STACK}` } : null),
  },

  // Quoted reply snippet
  replyQuote: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 4,
  },
  replyQuoteText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },

  // Reactions
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
    marginTop: 4,
  },
  // Seen receipt (Instagram DM "Seen just now" reference) — small muted
  // text under the sender's own last message, right-aligned to match its
  // own bubble alignment.
  seenReceipt: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: theme.muted,
    alignSelf: 'flex-end',
    marginTop: 3,
    marginRight: 2,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: theme.card,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: SP.xs,
    paddingVertical: 2,
  },
  reactionCount: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },

  // Reply bar
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: theme.card,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  replyFromName: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: theme.accent,
  },
  replyPreviewText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginTop: 1,
  },
  replyClose: {
    fontSize: FS.md,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginLeft: SP.sm,
  },

  // Input row
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
  },
  // Attach trigger left of the pill — solid white circle, black glyph.
  attachCircleBtn: {
    width: COMPOSER_ATTACH_SIZE,
    height: COMPOSER_ATTACH_SIZE,
    borderRadius: COMPOSER_ATTACH_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  // Inside-the-pill controls (mic, gallery, Thread Cash coin).
  threadCashCoinBtn: {
    width: COMPOSER_CONTROL,
    height: COMPOSER_CONTROL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerIconBtn: {
    width: COMPOSER_CONTROL,
    height: COMPOSER_CONTROL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBarWrap: {
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    backgroundColor: theme.background,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  productPicker: {
    maxHeight: '78%',
    backgroundColor: theme.background,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1,
    borderColor: theme.border,
    paddingBottom: SP.xl,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  pickerTitle: {
    fontSize: FS.lg,
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  pickerSubtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginTop: 2,
  },
  attachmentTabs: {
    flexDirection: 'row',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
  },
  attachmentTabCell: { flex: 1, minWidth: 0 },
  attachmentTab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    paddingVertical: SP.sm,
    paddingHorizontal: SP.md,
    borderRadius: RADIUS.md,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
  },
  attachmentTabActive: {
    backgroundColor: theme.accentDim,
    borderColor: theme.accent,
  },
  attachmentTabText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: theme.muted,
  },
  attachmentTabTextActive: {
    color: theme.accent,
  },
  pickerLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 150,
    gap: SP.sm,
  },
  pickerEmptyText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.muted,
  },
  productList: {
    padding: SP.md,
    gap: SP.sm,
  },
  productOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SP.md,
    backgroundColor: theme.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
  },
  productThumb: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.sm,
    backgroundColor: theme.cardElevated,
  },
  productThumbPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.sm,
    backgroundColor: theme.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productOptionName: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  productOptionMeta: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginTop: 3,
  },

  // Reaction / actions sheet
  reactionSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: theme.card, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg,
    paddingHorizontal: SP.md, paddingTop: SP.sm,
  },
  sheetDivider: {
    height: 1,
    backgroundColor: theme.border,
    marginVertical: SP.sm,
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: SP.sm,
  },
  sheetActionText: {
    fontSize: FS.base,
    fontFamily: FONT.medium,
    color: theme.text,
  },

  // Media sheet
  mediaSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: theme.card, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg,
    paddingHorizontal: SP.md, paddingTop: SP.sm,
  },
  mediaSheetHandle: { width: 36, height: 4, backgroundColor: theme.border, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  mediaSheetTitle:  { fontSize: FS.lg, fontFamily: FONT.semibold, color: theme.text, marginBottom: SP.md },
  mediaSheetOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.md, gap: SP.sm },
  mediaSheetIcon:   { width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: theme.accentDim, alignItems: 'center', justifyContent: 'center' },
  mediaSheetLabel:  { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  mediaSheetDesc:   { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.muted, marginTop: 2 },

  // Photo grid
  photoGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: RADIUS.md, overflow: 'hidden' },
  photoCell:      { width: '48%', aspectRatio: 1, overflow: 'hidden', borderRadius: RADIUS.sm, position: 'relative' },
  photoCellSingle:{ width: '100%', aspectRatio: 4 / 3 },
  photoImg:       { width: '100%', height: '100%' },
  photoMore:      { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  photoMoreText:  { color: '#fff', fontSize: FS.lg, fontFamily: FONT.bold },

  // Video thumb
  videoThumb:       { borderRadius: RADIUS.md, overflow: 'hidden', width: 200, height: 130, position: 'relative' },
  videoThumbImg:    { width: '100%', height: '100%' },
  videoPlayOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  videoDurBadge:    { position: 'absolute', bottom: SP.xs, right: SP.xs, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.sm, paddingHorizontal: SP.xs, paddingVertical: 2 },
  videoDurText:     { color: '#fff', fontSize: FS.xs, fontFamily: FONT.medium },

  // Voice player
  voiceRow:         { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs, minWidth: 160 },
  voicePlayBtn:     { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  voicePlayBtnActive: { backgroundColor: theme.error },
  voiceWave:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  voiceBar:         { width: 3, backgroundColor: theme.accentDim, borderRadius: 2 },
  voiceDur:         { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },

  // Disabled input
  disabledInputRow: {
    justifyContent: 'center',
  },
  disabledInputText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.subtle,
    textAlign: 'center',
  },
  });
};
>>>>>>> origin/approved-pr-796
