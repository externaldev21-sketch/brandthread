/**
 * Brandthread DM conversations — with safety features:
 *   • Block enforcement: blocked users cannot create conversations or send messages
 *   • Content moderation: harmful content (harassment, spam/scam, explicit, hate) is rejected
 *   • Follow-based message requests: buyer↔buyer DMs from non-followers land in Requests
 *   • Accept / decline: recipients can accept (moves to inbox) or decline (deletes conversation)
 *
 * POST   /api/conversations                — create or reopen existing
 * GET    /api/conversations                — list my conversations
 * GET    /api/conversations/:id           — get single conversation
 * GET    /api/conversations/:id/messages  — paginated messages
 * POST   /api/conversations/:id/messages  — send message (moderated + block-gated)
 * PUT    /api/conversations/:id/messages/:messageId/reactions   — set my reaction (upsert)
 * DELETE /api/conversations/:id/messages/:messageId/reactions   — remove my reaction
 * PATCH  /api/conversations/:id/read      — mark read
 * PATCH  /api/conversations/:id/accept    — accept a message request
 * DELETE /api/conversations/:id           — decline / delete conversation
 */
import { Router } from "express";
import {
  db, conversations, conversationParticipants, messages, messageReactions, blocks, follows, users,
  products, orders, posts,
} from "@workspace/db";
import { eq, and, desc, inArray, sql, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { moderateMessage } from "../lib/contentModerator";
import { blockRelation, publishingRestriction } from "../lib/safety";
import { publishNotification } from "./notifications-feed";
import { getSellerVacationStatus } from "../lib/sellerAvailability";
import { parsePagination, setPaginationHeaders } from "../lib/pagination";

const router = Router();
router.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function isFollowedBy(followerId: string, targetId: string): Promise<boolean> {
  const [row] = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, targetId)))
    .limit(1);
  return !!row;
}

function getAttachmentPreview(attachment: unknown): string | undefined {
  if (!attachment || typeof attachment !== "object") return undefined;
  const title = (attachment as { title?: unknown }).title;
  return typeof title === "string" && title.trim() ? title.trim() : "Attachment";
}

function getMessagePreview(body: string | null | undefined, attachment: unknown, attachments?: unknown): string | undefined {
  const attachmentPreview = getAttachmentPreview(attachment)
    ?? (Array.isArray(attachments) ? getAttachmentPreview(attachments[0]) : undefined);
  if (attachmentPreview) return attachmentPreview;
  return body?.trim() || undefined;
}

function buildConversationView(
  conv: typeof conversations.$inferSelect,
  parts: (typeof conversationParticipants.$inferSelect)[],
  myUserId: string,
  lastMessagePreview?: string,
) {
  const me = parts.find((p) => p.userId === myUserId);
  return {
    id:   conv.id,
    type: conv.type,
    participants: parts.map((p) => ({
      userId:      p.userId,
      name:        p.name,
      handle:      p.handle,
      initials:    p.initials,
      color:       p.color,
      accountType: p.accountType,
    })),
    lastMessage:        lastMessagePreview ?? conv.lastMessage ?? undefined,
    lastMessageTs:      conv.lastMessageAt
      ? new Date(conv.lastMessageAt).getTime()
      : undefined,
    unreadCount:        me?.unreadCount        ?? 0,
    isFriendshipActive: true,
    isArchived:         false,
    // Use the DB column — true only for follow-based pending requests
    isRequest:          conv.isRequest,
    requestedBy:        conv.requestedBy       ?? undefined,
    contextOrderId:     conv.contextOrderId    ?? undefined,
    contextOrderNumber: conv.contextOrderNumber ?? undefined,
    contextOrderStatus: conv.contextOrderStatus ?? undefined,
    contextProductId:   conv.contextProductId  ?? undefined,
    contextProductName: conv.contextProductName ?? undefined,
    contextSellerName:  conv.contextSellerName  ?? undefined,
    updatedAt: conv.updatedAt?.toISOString() ?? conv.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

// Small fixed reaction bar — no free-form emoji picker.
const REACTION_TYPES = ["like", "love", "haha", "wow", "sad", "fire"] as const;
type ReactionType = (typeof REACTION_TYPES)[number];

type ReactionView = {
  userId: string;
  userName: string;
  reactionType: string;
  createdAt: string;
};

function adaptMessage(m: typeof messages.$inferSelect, reactions: ReactionView[] = []) {
  return {
    id:             m.id,
    conversationId: m.conversationId,
    fromId:         m.senderId,
    fromName:       m.senderName,
    fromInitials:   m.senderInitials,
    fromColor:      m.senderColor,
    // Moderator-removed messages keep their place in the thread without content.
    text:           m.moderationStatus === "removed" ? "" : m.body,
    removedByModeration: m.moderationStatus === "removed",
    attachment:     m.moderationStatus === "removed" ? undefined : (m.attachment as any) ?? undefined,
    attachments:    m.moderationStatus === "removed" ? [] : (m.attachments as any[]) ?? [],
    replyToId:      m.replyToId ?? undefined,
    replyPreview:   undefined,
    reactions,
    status:         m.status,
    deliveredAt:    m.deliveredAt?.toISOString() ?? undefined,
    readAt:         m.readAt?.toISOString() ?? undefined,
    deletedAt:      m.deletedAt?.toISOString() ?? undefined,
    ts:             new Date(m.createdAt!).getTime(),
    deletedForMe:   false,
  };
}

// Fetches reactions for a set of messages and groups them, resolving display
// names from the conversation's participant roster (reactions never leave the
// conversation, so this avoids an extra join against `users`).
async function loadReactionsByMessage(
  messageIds: string[],
  parts: (typeof conversationParticipants.$inferSelect)[],
): Promise<Map<string, ReactionView[]>> {
  const byMessage = new Map<string, ReactionView[]>();
  if (messageIds.length === 0) return byMessage;
  const nameByUserId = new Map(parts.map((p) => [p.userId, p.name]));
  const rows = await db.select().from(messageReactions)
    .where(inArray(messageReactions.messageId, messageIds));
  for (const row of rows) {
    const view: ReactionView = {
      userId:       row.userId,
      userName:     nameByUserId.get(row.userId) ?? "",
      reactionType: row.reactionType,
      createdAt:    row.createdAt?.toISOString() ?? new Date().toISOString(),
    };
    if (!byMessage.has(row.messageId)) byMessage.set(row.messageId, []);
    byMessage.get(row.messageId)!.push(view);
  }
  return byMessage;
}

// ─── GET /api/conversations ───────────────────────────────────────────────────
// Query params: ?limit=&offset= (default 100, capped at MAX_PAGE_LIMIT). An
// inbox is unbounded over time, so the id lookup itself is ordered + paged
// before any per-conversation detail is fetched — avoids loading every
// conversation a long-lived account has ever had on every inbox open.
router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const page = parsePagination(req.query, { limit: 100 });
  if (!page.success) return res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" });
  const { limit, offset } = page.data;

  const myParts = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .where(eq(conversationParticipants.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit)
    .offset(offset);

  if (myParts.length === 0) { setPaginationHeaders(res, page.data, 0); return res.json([]); }

  const convIds = myParts.map((p) => p.conversationId);
  setPaginationHeaders(res, page.data, convIds.length);

  const [convs, allParts, allMessages] = await Promise.all([
    db.select().from(conversations)
      .where(inArray(conversations.id, convIds))
      .orderBy(desc(conversations.updatedAt)),
    db.select().from(conversationParticipants)
      .where(inArray(conversationParticipants.conversationId, convIds)),
    db.selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      body: messages.body,
      attachment: messages.attachment,
       attachments: messages.attachments,
    })
      .from(messages)
      .where(inArray(messages.conversationId, convIds))
      .orderBy(messages.conversationId, desc(messages.createdAt)),
  ]);

  const partsByConv = new Map<string, typeof allParts>();
  for (const p of allParts) {
    if (!partsByConv.has(p.conversationId)) partsByConv.set(p.conversationId, []);
    partsByConv.get(p.conversationId)!.push(p);
  }

  const previewByConversation = new Map<string, string>();
  for (const message of allMessages) {
    if (previewByConversation.has(message.conversationId)) continue;
    const preview = getMessagePreview(message.body, message.attachment, message.attachments);
    if (preview) previewByConversation.set(message.conversationId, preview);
  }

  return res.json(convs.map((c) => buildConversationView(
    c,
    partsByConv.get(c.id) ?? [],
    userId,
    previewByConversation.get(c.id),
  )));
});

// ─── POST /api/conversations ──────────────────────────────────────────────────
router.post("/", rateLimit("messaging"), async (req, res) => {
  const myUserId = (req as any).clerkUserId as string;
  const {
    type,
    participant,
    myInfo,
    contextOrderId, contextOrderNumber, contextOrderStatus,
    contextProductId, contextProductName, contextSellerName,
  } = req.body as {
    type: string;
    participant: { userId: string; name: string; handle: string; initials: string; color: string; accountType: string };
    myInfo?: { name: string; handle: string; initials: string; color: string; accountType: string };
    contextOrderId?: string;
    contextOrderNumber?: string;
    contextOrderStatus?: string;
    contextProductId?: string;
    contextProductName?: string;
    contextSellerName?: string;
  };

  if (!participant?.userId) return res.status(400).json({ error: "participant.userId required" });

  // ── Block check (both directions) ─────────────────────────────────────────
  const relation = await blockRelation(myUserId, participant.userId);
  if (relation === "blocked_by_me") {
    return res.status(403).json({ error: "You blocked this account. Unblock them to send a message.", code: "BLOCKED_BY_ME" });
  }
  if (relation !== "none") {
    return res.status(403).json({ error: "Unable to start this conversation.", code: "BLOCKED" });
  }

  const [recipient] = await db
    .select({ accountType: users.accountType })
    .from(users)
    .where(eq(users.clerkId, participant.userId))
    .limit(1);
  if (recipient?.accountType === "seller") {
    const vacation = await getSellerVacationStatus(participant.userId);
    if (vacation.active) {
      return res.status(409).json({
        error: vacation.message,
        code: "SELLER_ON_VACATION",
        vacationUntil: vacation.until?.toISOString() ?? null,
      });
    }
  }

  // ── DM privacy: honour recipient's "who can message me" preference ────────
  if (type === "buyer_to_buyer") {
    const [recipientUser] = await db
      .select({ dmPrivacy: users.dmPrivacy })
      .from(users)
      .where(eq(users.clerkId, participant.userId))
      .limit(1);

    if (recipientUser?.dmPrivacy === "followers_only") {
      // Sender must be someone the recipient follows — otherwise refuse outright.
      const recipientFollowsSender = await isFollowedBy(participant.userId, myUserId);
      if (!recipientFollowsSender) {
        return res.status(403).json({
          error:  "This user only accepts messages from people they follow.",
          code:   "DM_RESTRICTED",
        });
      }
    }
  }

  // ── Dedupe: find existing conversation between these two users ────────────
  const [myParts, theirParts] = await Promise.all([
    db.select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, myUserId)),
    db.select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, participant.userId)),
  ]);

  const mySet = new Set(myParts.map((p) => p.conversationId));
  const shared = theirParts.filter((p) => mySet.has(p.conversationId)).map((p) => p.conversationId);

  if (shared.length > 0) {
    const whereClause = contextOrderId
      ? and(inArray(conversations.id, shared), eq(conversations.type, type), eq(conversations.contextOrderId, contextOrderId))
      : and(inArray(conversations.id, shared), eq(conversations.type, type), sql`${conversations.contextOrderId} IS NULL`);

    const existing = await db.select().from(conversations).where(whereClause).limit(1);

    if (existing.length > 0) {
      const parts = await db.select().from(conversationParticipants)
        .where(eq(conversationParticipants.conversationId, existing[0].id));
      return res.json(buildConversationView(existing[0], parts, myUserId));
    }
  }

  // ── Determine if this is a follow-based message request (buyer↔buyer) ─────
  // A DM from A→B is a request if B does NOT follow A.
  let isRequest = false;
  if (type === "buyer_to_buyer") {
    const recipientFollowsSender = await isFollowedBy(participant.userId, myUserId);
    isRequest = !recipientFollowsSender;
  }

  // ── Create new conversation ───────────────────────────────────────────────
  const [conv] = await db.insert(conversations).values({
    type,
    isRequest,
    requestedBy:        isRequest ? myUserId : null,
    contextOrderId:     contextOrderId    ?? null,
    contextOrderNumber: contextOrderNumber ?? null,
    contextOrderStatus: contextOrderStatus ?? null,
    contextProductId:   contextProductId   ?? null,
    contextProductName: contextProductName ?? null,
    contextSellerName:  contextSellerName  ?? null,
  }).returning();

  await db.insert(conversationParticipants).values([
    {
      conversationId: conv.id,
      userId:      myUserId,
      name:        myInfo?.name        ?? "",
      handle:      myInfo?.handle      ?? "",
      initials:    myInfo?.initials    ?? "",
      color:       myInfo?.color       ?? "#8B5CF6",
      accountType: myInfo?.accountType ?? "buyer",
    },
    {
      conversationId: conv.id,
      userId:      participant.userId,
      name:        participant.name,
      handle:      participant.handle,
      initials:    participant.initials,
      color:       participant.color,
      accountType: participant.accountType,
    },
  ]);

  const parts = await db.select().from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conv.id));

  return res.status(201).json(buildConversationView(conv, parts, myUserId));
});

// ─── GET /api/conversations/:id ───────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [isMember] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);

  if (!isMember) return res.status(404).json({ error: "Conversation not found" });

  const [[conv], parts] = await Promise.all([
    db.select().from(conversations).where(eq(conversations.id, id)),
    db.select().from(conversationParticipants).where(eq(conversationParticipants.conversationId, id)),
  ]);

  if (!conv) return res.status(404).json({ error: "Conversation not found" });
  const counterpart = parts.find((p) => p.userId !== userId);
  const relation = counterpart ? await blockRelation(userId, counterpart.userId) : "none";
  return res.json({
    ...buildConversationView(conv, parts, userId),
    messaging: {
      // The composer is replaced with an unblock prompt / unavailable notice.
      blockedByMe: relation === "blocked_by_me" || relation === "mutual",
      unavailable: relation === "blocked_me" || relation === "mutual",
    },
  });
});

// ─── GET /api/conversations/:id/messages ─────────────────────────────────────
router.get("/:id/messages", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const limit = Math.min(parseInt(String(req.query.limit ?? 50), 10), 100);
  const before = req.query.before as string | undefined;

  const [isMember] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);

  if (!isMember) return res.status(403).json({ error: "Not a participant" });

  const whereClause = before
    ? and(eq(messages.conversationId, id), sql`${messages.createdAt} < ${new Date(before)}`)
    : eq(messages.conversationId, id);

  const msgs = await db.select().from(messages)
    .where(whereClause)
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  const parts = await db.select().from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, id));
  const reactionsByMessage = await loadReactionsByMessage(msgs.map((m) => m.id), parts);

  return res.json(msgs.reverse().map((m) => adaptMessage(m, reactionsByMessage.get(m.id) ?? [])));
});

// ─── POST /api/conversations/:id/messages ────────────────────────────────────
router.post("/:id/messages", rateLimit("messaging"), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params as { id: string };
  const { text, attachment, attachments, replyToId } = req.body as {
    text: string;
    attachment?: any;
    attachments?: any[];
    replyToId?: string;
  };
  if (attachments !== undefined && !Array.isArray(attachments)) {
    return res.status(400).json({ error: "attachments must be an array." });
  }
  const attachmentItems = attachments ?? (attachment != null ? [attachment] : []);
  if (attachmentItems.length > 5) {
    return res.status(400).json({ error: "A message can include up to 5 attachments." });
  }
  const primaryAttachment = attachment ?? attachmentItems[0];

  // Require either text or an attachment
  if (!text?.trim() && attachmentItems.length === 0) return res.status(400).json({ error: "text or attachment required" });

  // ── Content moderation ───────────────────────────────────────────────────
  // Casual profanity passes freely; only genuinely harmful content is blocked.
  const modResult = text?.trim() ? moderateMessage(text) : { blocked: false };
  if (modResult.blocked) {
    return res.status(422).json({
      error:    modResult.reason ?? "Message was flagged by safety filters.",
      category: modResult.category,
      code:     "MODERATED",
    });
  }

  const restriction = await publishingRestriction(userId);
  if (restriction) return res.status(restriction.status).json(restriction.body);

  // ── Sender membership ────────────────────────────────────────────────────
  const [sender] = await db.select().from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);

  if (!sender) return res.status(403).json({ error: "Not a participant" });

  // ── Block check: any other participant has blocked this sender ────────────
  const otherParts = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), sql`user_id != ${userId}`));

  const otherIds = otherParts.map((p) => p.userId);
  if (otherIds.length > 0) {
    // Check if sender is blocked by any recipient
    const blockRows = await db
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(and(inArray(blocks.blockerId, otherIds), eq(blocks.blockedId, userId)))
      .limit(1);

    if (blockRows.length > 0) {
      return res.status(403).json({ error: "Unable to send message.", code: "BLOCKED" });
    }

    // The sender blocked a recipient: they must unblock before messaging.
    const myBlockRows = await db
      .select({ blockedId: blocks.blockedId })
      .from(blocks)
      .where(and(eq(blocks.blockerId, userId), inArray(blocks.blockedId, otherIds)))
      .limit(1);
    if (myBlockRows.length > 0) {
      return res.status(403).json({ error: "You blocked this account. Unblock them to send a message.", code: "BLOCKED_BY_ME" });
    }

    if (sender.accountType !== "seller") {
      const sellerRecipients = await db
        .select({ clerkId: users.clerkId })
        .from(users)
        .where(and(inArray(users.clerkId, otherIds), eq(users.accountType, "seller")));
      for (const recipient of sellerRecipients) {
        const vacation = await getSellerVacationStatus(recipient.clerkId);
        if (vacation.active) {
          return res.status(409).json({
            error: vacation.message,
            code: "SELLER_ON_VACATION",
            vacationUntil: vacation.until?.toISOString() ?? null,
          });
        }
      }
    }
  }

  // ── Attachment validation ────────────────────────────────────────────────
  for (const item of attachmentItems) {
    const type = (item as { type?: unknown } | null)?.type;
    if (typeof type !== "string" || !["product", "order", "post", "profile"].includes(type)) {
      return res.status(400).json({ error: "Invalid attachment type." });
    }
  }

  if (primaryAttachment != null) {
    const att = primaryAttachment as {
      type?: string;
      title?: string;
      subtitle?: string;
      meta?: { productId?: string; orderId?: string; postId?: string };
    };
    const allowedTypes = ["product", "order", "post", "profile"];
    if (!att.type || !allowedTypes.includes(att.type)) {
      return res.status(400).json({ error: "Invalid attachment type." });
    }

    if (att.type === "product") {
      // productId is required; the product must be active and owned either by the sender
      // (seller attaching their own product) or by another participant in the conversation
      // (buyer attaching the seller's product they are asking about).
      const pid = att.meta?.productId;
      if (!pid) return res.status(400).json({ error: "Attachment product requires meta.productId." });
      const [product] = await db
        .select({ id: products.id, ownerId: products.ownerId, status: products.status })
        .from(products)
        .where(eq(products.id, pid))
        .limit(1);
      if (!product) return res.status(400).json({ error: "Attached product not found." });
      if (product.status !== "active") return res.status(400).json({ error: "Only active products can be attached." });
      // Allow if sender owns the product OR the product belongs to another participant
      if (product.ownerId !== userId) {
        const [conversation] = await db
          .select({ type: conversations.type })
          .from(conversations)
          .where(eq(conversations.id, id))
          .limit(1);
        const isSellerConversation = conversation?.type === "buyer_to_seller"
          || conversation?.type === "buyer_to_seller_product"
          || conversation?.type === "buyer_to_seller_order";
        const isParticipantProduct = otherIds.includes(product.ownerId);
        if (!isSellerConversation || !isParticipantProduct) {
          return res.status(403).json({ error: "You can only attach products from this conversation's seller." });
        }
      }
    }

    if (att.type === "order") {
      // For order attachments, orderId must match the conversation's contextOrderId
      // and the conversation must belong to the sender
      const [conv] = await db
        .select({ contextOrderId: conversations.contextOrderId })
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1);
      const orderId = att.meta?.orderId ?? conv?.contextOrderId ?? null;
      if (!orderId) return res.status(400).json({ error: "No order linked to this conversation." });
      const [order] = await db
        .select({ id: orders.id, ownerId: orders.ownerId })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      if (!order) return res.status(400).json({ error: "Attached order not found." });
      if (order.ownerId !== userId) return res.status(403).json({ error: "You can only attach your own orders." });
      // Normalize meta to include the validated orderId
      (att as any).meta = { ...((att as any).meta ?? {}), orderId };
    }

    if (att.type === "post") {
      const postId = att.meta?.postId;
      if (!postId) return res.status(400).json({ error: "Attachment post requires meta.postId." });
      const [post] = await db
        .select({ id: posts.id, userId: posts.userId })
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1);
      if (!post) return res.status(400).json({ error: "Attached post not found." });
      if (post.userId !== userId) {
        const [conversation] = await db
          .select({ type: conversations.type })
          .from(conversations)
          .where(eq(conversations.id, id))
          .limit(1);
        const isSellerConversation = conversation?.type === "buyer_to_seller"
          || conversation?.type === "buyer_to_seller_product"
          || conversation?.type === "buyer_to_seller_order";
        if (!isSellerConversation || !otherIds.includes(post.userId)) {
          return res.status(403).json({ error: "You can only attach posts from this conversation's seller." });
        }
      }
      (att as any).meta = { ...((att as any).meta ?? {}), postId };
    }
  }

  const bodyText = text?.trim() ?? "";
  const previewText = getMessagePreview(bodyText, primaryAttachment, attachmentItems) ?? "Attachment";

  const [msg] = await db.insert(messages).values({
    conversationId: id,
    senderId:       userId,
    senderName:     sender.name,
    senderInitials: sender.initials,
    senderColor:    sender.color,
    body:           bodyText,
    attachment:     primaryAttachment ?? null,
    attachments:    attachmentItems,
    replyToId:      replyToId ?? null,
    status:         "sent",
    deliveredAt:    new Date(),
  }).returning();

  // Update conversation preview + increment other participants' unread
  await Promise.all([
    db.update(conversations)
      .set({ lastMessage: previewText.slice(0, 100), lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, id)),
    db.update(conversationParticipants)
      .set({ unreadCount: sql`unread_count + 1` })
      .where(and(eq(conversationParticipants.conversationId, id), sql`user_id != ${userId}`)),
  ]);

  // Notify each recipient of the new message (non-critical, fire-and-forget)
  if (otherIds.length > 0) {
    (async () => {
      try {
        const [conv] = await db.select({ type: conversations.type })
          .from(conversations).where(eq(conversations.id, id)).limit(1);
        // Map conversation type to the notification type the mobile client expects
        const notifType = conv?.type === "buyer_to_buyer" ? "new_friend_message" : "new_order_message";
        for (const recipientId of otherIds) {
          await publishNotification({
            userId:        recipientId,
            category:      "messages",
            type:          notifType,
            title:         `New message from ${sender.name || "someone"}`,
            body:          previewText.slice(0, 100),
            actorName:     sender.name,
            actorHandle:   sender.handle,
            actorInitials: sender.initials,
            actorColor:    sender.color,
            targetId:      id,
            targetType:    "conversation",
          });
        }
      } catch { /* non-critical */ }
    })();
  }

  return res.status(201).json(adaptMessage(msg));
});

// ─── PUT /api/conversations/:id/messages/:messageId/reactions ────────────────
// Upserts the caller's reaction on a message — a user has at most one active
// reaction per message; re-reacting replaces it.
router.put("/:id/messages/:messageId/reactions", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id, messageId } = req.params;
  const { reactionType } = req.body as { reactionType?: string };

  if (!reactionType || !REACTION_TYPES.includes(reactionType as ReactionType)) {
    return res.status(400).json({ error: `reactionType must be one of: ${REACTION_TYPES.join(", ")}` });
  }

  const [membership] = await db.select().from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);
  if (!membership) return res.status(403).json({ error: "Not a participant" });

  const [message] = await db.select().from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, id)))
    .limit(1);
  if (!message) return res.status(404).json({ error: "Message not found" });

  const [reaction] = await db.insert(messageReactions)
    .values({ messageId, userId, reactionType })
    .onConflictDoUpdate({
      target: [messageReactions.messageId, messageReactions.userId],
      set: { reactionType, createdAt: new Date() },
    })
    .returning();

  // Notify the message's sender (never yourself) — fire-and-forget.
  if (message.senderId !== userId) {
    (async () => {
      try {
        await publishNotification({
          userId:        message.senderId,
          category:      "messages",
          type:          "message_reaction",
          title:         `${membership.name || "Someone"} reacted to your message`,
          body:          message.moderationStatus === "removed" ? undefined : message.body?.slice(0, 100),
          actorName:     membership.name,
          actorHandle:   membership.handle,
          actorInitials: membership.initials,
          actorColor:    membership.color,
          targetId:      id,
          targetType:    "conversation",
        });
      } catch { /* non-critical */ }
    })();
  }

  return res.status(200).json({
    userId:       reaction.userId,
    userName:     membership.name,
    reactionType: reaction.reactionType,
    createdAt:    reaction.createdAt?.toISOString() ?? new Date().toISOString(),
  });
});

// ─── DELETE /api/conversations/:id/messages/:messageId/reactions ─────────────
router.delete("/:id/messages/:messageId/reactions", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id, messageId } = req.params;

  const [isMember] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);
  if (!isMember) return res.status(403).json({ error: "Not a participant" });

  const [message] = await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, id)))
    .limit(1);
  if (!message) return res.status(404).json({ error: "Message not found" });

  await db.delete(messageReactions)
    .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId)));

  return res.json({ ok: true });
});

// ─── PATCH /api/conversations/:id/read ───────────────────────────────────────
router.patch("/:id/read", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [isMember] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);
  if (!isMember) return res.status(404).json({ error: "Conversation not found" });

  const readAt = new Date();
  await Promise.all([
    db.update(conversationParticipants)
      .set({ unreadCount: 0, lastReadAt: readAt })
      .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId))),
    db.update(messages)
      .set({ status: "read", readAt })
      .where(and(eq(messages.conversationId, id), sql`${messages.senderId} != ${userId}`, sql`${messages.readAt} IS NULL`)),
  ]);

  return res.json({ ok: true });
});

// ─── PATCH /api/conversations/:id/accept — accept a message request ───────────
// Only the recipient (non-requester participant) may accept.
router.patch("/:id/accept", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [isMember] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);

  if (!isMember) return res.status(404).json({ error: "Conversation not found" });

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  // Only the recipient (not the requester) can accept
  if (conv.requestedBy === userId) {
    return res.status(403).json({ error: "Only the recipient can accept a message request." });
  }

  await db.update(conversations)
    .set({ isRequest: false, requestedBy: null, updatedAt: new Date() })
    .where(eq(conversations.id, id));

  const parts = await db.select().from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, id));
  const [updated] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);

  return res.json(buildConversationView(updated, parts, userId));
});

// ─── POST /api/conversations/upload-media ────────────────────────────────────
// Accept a base64-encoded image/video/audio and store it in object storage.
// Returns { url } — a publicly-accessible URL for use in message attachments.
//
// mimeType and extension are attacker-controlled input: the extension is
// never taken from the request (it previously allowed arbitrary characters,
// including "/", into the generated object key) and the content-type is
// restricted to a fixed allowlist of media types this feature supports.
const UPLOAD_MEDIA_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
};
const UPLOAD_MEDIA_BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

router.post("/upload-media", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { data, mimeType = "image/jpeg" } = req.body ?? {};

  const BUCKET_ID = (process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "").trim();
  if (!BUCKET_ID) {
    return res.status(503).json({ error: "Object storage not configured" });
  }

  if (!data || typeof data !== "string") {
    return res.status(400).json({ error: "data (base64) is required" });
  }

  // Strip data-URL prefix if present
  let base64 = data;
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/.exec(data);
  if (dataUrlMatch) base64 = dataUrlMatch[2];

  // 80 MB safety cap (base64 is ~4/3 × raw size)
  if (base64.length > 80 * 1024 * 1024) {
    return res.status(413).json({ error: "File too large (max ~60 MB)" });
  }
  if (!UPLOAD_MEDIA_BASE64_RE.test(base64)) {
    return res.status(400).json({ error: "data must be base64-encoded" });
  }

  const normalizedMimeType = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  const ext = UPLOAD_MEDIA_MIME_EXTENSIONS[normalizedMimeType];
  if (!ext) {
    return res.status(400).json({
      error: `mimeType must be one of: ${Object.keys(UPLOAD_MEDIA_MIME_EXTENSIONS).join(", ")}`,
    });
  }

  const { randomUUID } = await import("crypto");
  const filename = `messaging/${userId}/${randomUUID()}.${ext}`;

  try {
    const { objectStorageClient } = await import("../lib/objectStorage");
    const buffer = Buffer.from(base64, "base64");
    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file   = bucket.file(filename);
    await file.save(buffer, { contentType: normalizedMimeType, resumable: false });
    await file.makePublic();
    const url = `https://storage.googleapis.com/${BUCKET_ID}/${filename}`;
    return res.json({ url });
  } catch (err: any) {
    req.log.error({ err, userId }, "Failed to upload conversation media");
    return res.status(500).json({ error: "Upload failed" });
  }
});

// ─── DELETE /api/conversations/:id — decline / delete conversation ────────────
router.delete("/:id", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [isMember] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);

  if (!isMember) return res.status(404).json({ error: "Conversation not found" });

  // Hard-delete: cascade removes participants + messages
  await db.delete(conversations).where(eq(conversations.id, id));
  return res.json({ ok: true });
});

export default router;
