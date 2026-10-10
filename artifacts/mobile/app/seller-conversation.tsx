/**
 * Seller 1:1 chat thread. Dev's direction: identical to the buyer thread,
 * so this route renders the same shared screen
 * (components/chat/ConversationThread.tsx) as the seller variant — only the
 * seller's own data (buyer, orders, own store, seller preview threads and
 * request actions) is swapped in.
 */
import React from 'react';

import { ConversationThread } from '@/components/chat/ConversationThread';

export default function SellerConversationScreen() {
  return <ConversationThread variant="seller" />;
}
<<<<<<< HEAD
=======

// ─── Request-mode bottom panel ─────────────────────────────────────────────────
// Seller-side mirror of app/buyer-conversation.tsx's RequestActionPanel —
// same three-way row (Block / Delete / Accept, Accept the sole filled/
// primary action), only reachable by the RECIPIENT of a pending request.
function SellerRequestActionPanel({
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
      testID="seller-conversation-request-panel"
    >
      <Text style={[rs.title, { color: theme.text }]}>{name} wants to send you a message</Text>
      <Text style={[rs.subline, { color: theme.muted }]}>
        Accepting lets them see when you’ve read their messages and message you freely.
      </Text>
      <View style={rs.actionsRow}>
        <PressableScale
          style={rs.actionBtn}
          onPress={onBlock}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Block ${name}`}
          testID="seller-conversation-request-block"
        >
          <Text style={[rs.actionText, { color: theme.error }]}>Block</Text>
        </PressableScale>
        <PressableScale
          style={rs.actionBtn}
          onPress={onDelete}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Delete request from ${name}`}
          testID="seller-conversation-request-delete"
        >
          <Text style={[rs.actionText, { color: theme.text }]}>Delete</Text>
        </PressableScale>
        <PressableScale
          style={[rs.actionBtn, { backgroundColor: theme.accent }]}
          onPress={onAccept}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Accept message request from ${name}`}
          testID="seller-conversation-request-accept"
        >
          {loading ? (
            <ActivityIndicator color={theme.onAccent} size="small" />
          ) : (
            <Text style={[rs.actionText, { color: theme.onAccent }]}>Accept</Text>
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
  actionText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const BG = theme.background;
  const CARD = theme.card;
  const BORDER = theme.border;
  const BORDER_ACTIVE = theme.accent;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SUBTLE = theme.subtle;
  const RED = theme.error;
  const ON_DARK = theme.onAccent;
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    // Left group (back + avatar + name) stays left; the icon group is
    // pushed to the far right edge — not centered/adjacent to the name.
    justifyContent: 'space-between',
    backgroundColor: BG,
    // Right edge padding is set inline (needs insets.right) — see the
    // header's own JSX. Mobbin: Instagram DM header
    // (mobbin.com/screens/db4e29c8-e47e-47ce-8f01-b7a98376c6e7) — the icon
    // group is hard-right-aligned to the edge, evenly spaced, 16pt inset
    // from the screen edge.
    paddingLeft: SP.md, paddingBottom: SP.sm,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  // flex: 1 + minWidth: 0 all the way down this chain (leftGroup ->
  // centerRow -> center -> name) is what actually lets the name truncate
  // instead of overlapping the call/video/context icons for a long name —
  // flexShrink alone isn't enough on React Native Web, where a flex item's
  // default min-width is its own content width ("auto"), not 0, so it never
  // shrinks below that no matter how little room justifyContent: 'space-
  // between' leaves it (confirmed live: "Torres" overlapping the phone
  // glyph with 3 action icons + the overflow menu in the icon group).
  headerLeftGroup: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  headerIconGroup: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  headerBack: { marginRight: SP.sm },
  headerAvatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', marginRight: SP.sm,
  },
  headerAvatarInitials: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  // The actual flex/minWidth constraint has to live here, on a plain View —
  // see the JSX's own comment on why it can't live on the PressableScale
  // (headerCenterRow) that wraps the avatar+name row.
  headerCenterWrap: { flex: 1, minWidth: 0 },
  headerCenterRow: { flexDirection: 'row', alignItems: 'center' },
  headerCenter: { flex: 1, minWidth: 0 },
  headerName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, flexShrink: 1, minWidth: 0 },
  headerHandle: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 1 },

  // Request-mode profile header (avatar / name / @handle / "View profile") —
  // same shape as app/buyer-conversation.tsx's identical styles, RECIPIENT
  // view only (see the JSX's own comment).
  requestProfileHeader: { alignItems: 'center', paddingVertical: SP.lg, paddingHorizontal: SP.lg, gap: 4 },
  requestProfileAvatar: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: SP.sm,
  },
  requestProfileAvatarInitials: { fontSize: FS.xl, fontFamily: FONT.bold, color: '#FFFFFF' },
  requestProfileName: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  requestProfileHandle: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginBottom: SP.sm },
  requestProfilePill: {
    height: 34, paddingHorizontal: SP.md, borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  requestProfilePillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },

  // "Sent as a request" indicator — the SENDER's own view of a pending
  // request thread (see the JSX's own comment).
  sentRequestBanner: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    marginHorizontal: SP.md, marginBottom: SP.xs, paddingVertical: SP.sm, paddingHorizontal: SP.md,
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
  },
  sentRequestBannerText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 16 },

  orderCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: SP.md, marginVertical: SP.sm, padding: SP.sm,
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER,
  },
  orderNumber: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  orderProduct: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 2 },
  orderBadge: {
    backgroundColor: PURPLE_DIM, borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
  },
  orderBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE },

  listContent: { paddingVertical: SP.sm, paddingBottom: SP.md },
  dateWrap: { alignItems: 'center', marginVertical: SP.md },
  datePill: {
    backgroundColor: CARD, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
  },
  dateText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  msgOuter: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: SP.md, marginBottom: SP.xs,
  },
  msgAvatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    marginRight: SP.sm, marginBottom: 2,
  },
  msgAvatarInitials: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  // Reserves the avatar's own width+gap for a bubble that isn't the last in
  // its group, so every bubble in a run still lines up on the same left
  // edge — matches app/buyer-conversation.tsx's msgAvatarSpacer.
  msgAvatarSpacer: { width: 32, marginRight: SP.sm },
  bubble: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SP.md },
  msgText: { fontSize: FS.base, fontFamily: FONT.regular, color: FG, marginTop: 4 },
  // Quoted reply snippet — same shape as app/buyer-conversation.tsx.
  replyQuote: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 4,
  },
  replyQuoteText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
    gap: 3,
  },
  bubbleTime: { fontSize: 11, fontFamily: FONT.regular },
  receiptChecks: { flexDirection: 'row', marginLeft: 2 },
  // Reaction pill row (item 68) — same treatment as buyer-conversation.tsx.
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.sm, borderWidth: 1,
  },
  reactionCount: { fontSize: 11, fontFamily: FONT.semibold },
  // Seen receipt (Instagram DM "Seen just now" reference) — small muted
  // text under the sender's own last message.
  seenReceipt: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    alignSelf: 'flex-end',
    marginTop: 3,
    marginRight: 2,
  },

  attachCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: BG, borderRadius: RADIUS.md,
    padding: SP.sm, marginBottom: 2,
    borderWidth: 1, borderColor: BORDER,
  },
  attachTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  attachSubtitle: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 1 },

  // Product/order chat cards (item 70/71) moved to the standalone
  // ChatAttachmentCard component (components/chat/ChatAttachmentCard.tsx) —
  // no bubble, no border, own the tap target. See renderItem's product/
  // order branch.

  pendingAttachRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: SP.md, marginBottom: SP.xs,
    padding: SP.sm,
    backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER_ACTIVE,
  },
  pendingAttachTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  pendingAttachSub: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 1 },

  // Attach trigger left of the pill — solid white circle, black glyph.
  cameraCircleBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
  },
  // Inside-the-pill controls (attach picker, mic, Thread Cash coin).
  accBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  voiceBarWrap: {
    paddingHorizontal: SP.md, paddingTop: SP.sm, backgroundColor: BG,
  },

  // Attach picker sheet
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm, paddingHorizontal: SP.md,
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: BORDER,
    borderRadius: 2, alignSelf: 'center', marginBottom: SP.md,
  },
  sheetTitle: {
    fontSize: FS.lg, fontFamily: FONT.semibold, color: FG,
    marginBottom: SP.md,
  },
  sheetOption: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SP.md, gap: SP.sm,
  },
  sheetOptionIcon: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetOptionLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  sheetOptionDesc: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 2 },

  // Product picker sheet
  productSheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm, paddingHorizontal: SP.md,
    maxHeight: '70%',
  },
  productSheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SP.sm,
  },
  productRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  productIcon: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center', justifyContent: 'center',
    marginRight: SP.sm,
  },
  productName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  productPrice: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: SP.xxl },
  emptyText: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, marginTop: SP.sm, textAlign: 'center', paddingHorizontal: SP.lg },

  // Buyer context panel (item 144)
  buyerContextSheetWrap: {
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm, paddingHorizontal: SP.md,
    overflow: 'hidden',
  },
  buyerContextHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: SP.sm },
  buyerContextSubtitle: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: -SP.sm + 2 },
  buyerContextOrderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SP.sm, marginBottom: SP.xs,
    borderRadius: RADIUS.md,
  },
  // Compact icon circle + badge row for a buyer-context list row (smaller
  // than components/chat/ChatAttachmentCard.tsx's 56×56 — that one fills a
  // full-width chat card, this is one row in a scrollable list).
  orderMsgCardIconCircle: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: CARD,
  },
  orderMsgCardBadgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  buyerContextOrderMeta: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  buyerContextOrderTotal: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginLeft: SP.xs },
  buyerContextRetry: {
    marginTop: SP.sm, paddingVertical: SP.xs, paddingHorizontal: SP.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: BORDER,
  },
  buyerContextRetryText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE },
  buyerContextCartNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
    marginTop: SP.md, marginBottom: SP.lg,
    paddingTop: SP.md, borderTopWidth: 1, borderTopColor: BORDER,
  },
  buyerContextCartNoteText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, lineHeight: 17 },

  // ── Call + media styles ──────────────────────────────────────────────────────
  headerCallBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  recordingBtn:  { backgroundColor: 'rgba(255,59,48,0.12)', borderRadius: RADIUS.pill },

  // Photo grid
  photoGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: RADIUS.md, overflow: 'hidden' },
  photoCell:       { width: '48%', aspectRatio: 1, overflow: 'hidden', borderRadius: RADIUS.sm, position: 'relative' },
  photoCellSingle: { width: '100%', aspectRatio: 4 / 3 },
  photoImg:        { width: '100%', height: '100%' },
  photoMore:       { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  photoMoreText:   { color: '#fff', fontSize: FS.lg, fontFamily: FONT.bold },

  // Video thumb
  videoThumb:       { borderRadius: RADIUS.md, overflow: 'hidden', width: 200, height: 130, position: 'relative' },
  videoThumbImg:    { width: '100%', height: '100%' },
  videoPlayOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  videoDurBadge:    { position: 'absolute', bottom: SP.xs, right: SP.xs, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.sm, paddingHorizontal: SP.xs, paddingVertical: 2 },
  videoDurText:     { color: '#fff', fontSize: FS.xs, fontFamily: FONT.medium },

  // Voice player
  voiceRow:          { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs, minWidth: 160 },
  voicePlayBtn:      { width: 28, height: 28, borderRadius: 14, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  voicePlayBtnActive:{ backgroundColor: RED },
  voiceWave:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  voiceBar:          { width: 3, backgroundColor: PURPLE_DIM, borderRadius: 2 },
  voiceDur:          { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  });
};
>>>>>>> origin/approved-pr-796
